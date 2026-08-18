/* Poligon — instalator Bangle.js przez Web Bluetooth
 *
 * Port algorytmu z scripts/dev.js na przegladarke. Rozmawia z zegarkiem przez
 * Nordic UART Service — ten sam transport, ktorego uzywa oficjalny App Loader
 * i Espruino Web IDE.
 *
 * Zapis plikow jest CHUNKOWANY (1 kB binarnie na instrukcje). Caly plik w
 * jednym literale nie miesci sie w RAM-ie interpretera — obrazek 62 kB to
 * ~83 000 znakow base64 i konczy sie "OUT OF MEMORY".
 */

// ── Nordic UART Service ───────────────────────────────────────────────────────
const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // przegladarka -> zegarek
const NUS_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // zegarek -> przegladarka

const STORAGE_CHUNK = 1024; // bajtow binarnych na jedno Storage.write()

// Bajtow na jeden zapis BLE. 20 dziala zawsze, ale jest wolne — wiekszy pakiet
// skraca pelna instalacje z ~7 minut do ~1. Faktyczna wartosc ustalana jest po
// polaczeniu przez negotiatePacket(), z realnym testem przelotu danych.
let PACKET = 20;
const PACKET_SIZES = [160, 80, 20];

// ── Stan ──────────────────────────────────────────────────────────────────────
let manifest = null;
let device = null;
let txChar = null;
let rxBuf = "";
let flowPaused = false; // Espruino wysyla XOFF/XON gdy bufor wejsciowy sie zapycha

// ── Elementy ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  connect: $("connect"),
  install: $("install"),
  force: $("force"),
  status: $("status"),
  progress: $("progress"),
  bar: $("bar"),
  build: $("build"),
  filelist: $("filelist"),
  log: $("log"),
  unsupported: $("unsupported"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " kB");

function log(line) {
  els.log.textContent += line + "\n";
  els.log.scrollTop = els.log.scrollHeight;
}

function status(text, kind) {
  els.status.textContent = text;
  els.status.className = "status" + (kind ? " " + kind : "");
}

function progress(done, total) {
  els.progress.hidden = false;
  els.bar.style.width = total ? Math.round((done / total) * 100) + "%" : "0";
}

// ── Manifest ──────────────────────────────────────────────────────────────────
async function loadManifest() {
  const res = await fetch("manifest.json?" + Date.now());
  if (!res.ok) throw new Error("Nie mogę pobrać manifest.json (" + res.status + ")");
  manifest = await res.json();

  els.build.textContent = `${manifest.name} ${manifest.version} · ${manifest.commit}`;
  els.filelist.innerHTML = "";
  for (const f of manifest.files) {
    const li = document.createElement("li");
    li.id = "f-" + f.name;
    li.innerHTML = `<span>${f.name}</span><span>${fmt(f.size)}</span>`;
    els.filelist.appendChild(li);
  }
  log(`Manifest: ${manifest.files.length} plików, ${fmt(manifest.totalSize)}`);
}

async function fetchFile(f) {
  const res = await fetch(f.url + "?" + manifest.commit);
  if (!res.ok) throw new Error("Nie mogę pobrać " + f.name);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Transport ─────────────────────────────────────────────────────────────────
function onNotify(event) {
  const v = event.target.value;
  let s = "";
  for (let i = 0; i < v.byteLength; i++) {
    const b = v.getUint8(i);
    if (b === 0x13) {
      flowPaused = true; // XOFF
      continue;
    }
    if (b === 0x11) {
      flowPaused = false; // XON
      continue;
    }
    s += String.fromCharCode(b);
  }
  rxBuf += s;
  // Bufor kasujemy na starcie kazdej fazy; przy echo(0) zegarek odsyla tylko
  // potwierdzenia i linie PLGN, wiec nie urosnie. Limit to bezpiecznik.
  if (rxBuf.length > 400000) rxBuf = rxBuf.slice(-100000);
}

async function connect() {
  status("Wybierz zegarek w oknie przeglądarki…");
  device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "Bangle.js" }],
    optionalServices: [NUS],
  });

  device.addEventListener("gattserverdisconnected", () => {
    status("Zegarek rozłączony.", "err");
    els.install.disabled = true;
    els.connect.disabled = false;
    txChar = null;
  });

  status("Łączę…");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS);
  txChar = await service.getCharacteristic(NUS_TX);
  const rxChar = await service.getCharacteristic(NUS_RX);
  await rxChar.startNotifications();
  rxChar.addEventListener("characteristicvaluechanged", onNotify);

  log("Połączono: " + (device.name || device.id));

  status("Sprawdzam przepustowość…");
  rxBuf = "";
  await send("\x03echo(0);\n");
  await sleep(200);
  await negotiatePacket();

  status("Połączono z " + (device.name || "zegarkiem") + ".", "ok");
  els.connect.disabled = true;
  els.install.disabled = false;
}

/* Zapis Z POTWIERDZENIEM (writeValue), nie writeValueWithoutResponse.
 *
 * To nie jest drobiazg: wariant "withoutResponse" konczy sie w chwili
 * wrzucenia pakietu do kolejki systemu, a nie dostarczenia go na zegarek —
 * czyli await niczego nie spowalnia i 70 pakietow jednej linii leci ciagiem.
 * Bufor wejsciowy Espruino (256 B) przepelnia sie w srodku linii, base64
 * dochodzi ucieta i instrukcja nigdy sie nie wykonuje.
 *
 * writeValue czeka na potwierdzenie warstwy lacza, wiec leci najwyzej jeden
 * pakiet na interwal polaczenia — interpreter zawsze zdazy oprozniac bufor.
 * Tak samo robi UART.js z Espruino Web IDE.
 */
/* BEZ ponawiania zapisu.
 *
 * Nieudany writeValue nie mowi nam, czy dane doszly na zegarek, czy nie.
 * Ponowienie "na wszelki wypadek" moze zdublowac bajty w strumieniu — a to
 * nie jest zgubiony pakiet, tylko CICHE uszkodzenie pliku: powtorzony fragment
 * kodu, ktory potrafi sie nawet poprawnie sparsowac. Lepiej przerwac cala
 * instalacje z czytelnym bledem, niz zostawic zegarek z polamana aplikacja.
 */
async function writePacket(bytes) {
  try {
    await txChar.writeValue(bytes);
  } catch (e) {
    throw new Error(
      "Przerwana transmisja do zegarka (" +
        (e && e.message ? e.message : e) +
        "). Nic nie zostało uszkodzone — połącz ponownie i powtórz instalację.",
    );
  }
}

/** Wysyla tekst do REPL-a; onSent(bajty) do paska postepu. */
async function send(text, onSent) {
  const enc = new TextEncoder();
  let packets = 0;
  for (let i = 0; i < text.length; i += PACKET) {
    while (flowPaused) await sleep(5);
    const part = text.slice(i, i + PACKET);
    await writePacket(enc.encode(part));
    if (onSent) onSent(part.length);
    // oddaj sterowanie, zeby doszly notyfikacje (w tym XON/XOFF)
    if (++packets % 8 === 0) await sleep(0);
  }
}

const DEVICE_ERR = /(Uncaught [^\r\n]+|OUT OF MEMORY|Storage is full|ERROR:[^\r\n]+)/;

/** Czeka, az w strumieniu z zegarka pojawi sie marker. Blad z zegarka
 *  przerywa czekanie od razu, zamiast czekac do konca timeoutu. */
async function waitFor(marker, timeoutMs, from) {
  const start = from || 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tail = rxBuf.slice(start);
    if (tail.includes(marker)) return true;
    const err = tail.match(DEVICE_ERR);
    if (err) throw new Error("Zegarek zgłosił: " + err[1].trim());
    await sleep(15);
  }
  const tail = rxBuf.slice(-160).replace(/\s+/g, " ").trim();
  throw new Error(
    "Zegarek nie odpowiedział w czasie (" + marker + ")" + (tail ? ". Ostatnio odebrano: " + tail : ""),
  );
}

/** Wysyla instrukcje POJEDYNCZO i po kazdej czeka na potwierdzenie.
 *
 *  Bez tego zegarek gubi dane: podczas Storage.write() zapisuje do flasha
 *  i NIE oprozniaja wtedy bufora wejsciowego BLE, a przegladarka wysyla dalej
 *  pelna predkoscia. Bufor sie przepelnia, linia dochodzi ucieta i program
 *  nigdy nie dobiega do konca. Espruino CLI (scripts/dev.js) tego nie ma,
 *  bo samo reguluje tempo — w przegladarce musimy zrobic to sami.
 */
/** Dobiera najwiekszy rozmiar pakietu, ktory REALNIE dochodzi do zegarka.
 *
 *  Nie ufamy temu, ze writeValue sie powiodl — sprawdzamy, czy zegarek odeslal
 *  potwierdzenie po linii dluzszej niz jeden pakiet. Jesli cokolwiek zgubi po
 *  drodze, marker nie wroci i schodzimy nizej. Ostatecznosc to 20 B, ktore
 *  dziala na kazdym polaczeniu.
 */
async function negotiatePacket() {
  const filler = "/*" + "-".repeat(600) + "*/"; // komentarz — zegarek nic nie robi
  for (const size of PACKET_SIZES) {
    PACKET = size;
    const tag = "PKT" + size + "|";
    const from = rxBuf.length;
    try {
      await send(filler + 'print("' + tag + '");\n');
      await waitFor(tag, 5000, from);
      log("Pakiet BLE: " + size + " B");
      return;
    } catch (e) {
      log("pakiet " + size + " B nie przechodzi — próbuję mniejszy");
    }
  }
  PACKET = 20;
  log("Pakiet BLE: 20 B (tryb awaryjny)");
}

async function execLines(lines, onSent) {
  for (let i = 0; i < lines.length; i++) {
    const tag = "PLGA" + i + "|";
    const from = rxBuf.length;
    await send(lines[i] + 'print("' + tag + '");\n', onSent);
    await waitFor(tag, 25000, from);
  }
}

// ── Budowanie programu (1:1 z scripts/dev.js) ────────────────────────────────
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Zwraca liste instrukcji zapisujacych plik — po jednej na kawalek 1 kB. */
function writeLines(name, bytes) {
  const n = JSON.stringify(name);
  if (!bytes.length) return [`S.write(${n},"");`];
  const out = [];
  for (let off = 0; off < bytes.length; off += STORAGE_CHUNK) {
    const part = bytes.subarray(off, Math.min(off + STORAGE_CHUNK, bytes.length));
    const data = b64(part);
    out.push(
      off === 0
        ? `S.write(${n},atob("${data}"),0,${bytes.length});`
        : `S.write(${n},atob("${data}"),${off});`,
    );
  }
  return out;
}

const PRELUDE = [
  "\x03echo(0);", // Ctrl-C przerywa to, co leci; echo(0) tnie ruch zwrotny
  "try{Bluetooth.setConsole(1);}catch(e){}",
  'var S=require("Storage");',
];

const VERIFY_FN =
  "var _v=function(n){var d=S.read(n),c=0;" +
  "if(d){try{c=E.CRC32(d);}catch(e){}}" +
  'print("PLGN|"+n+"|"+(d?d.length:0)+"|"+c);};';

function verifyLines(names) {
  return [VERIFY_FN].concat(names.map((n) => `_v(${JSON.stringify(n)});`));
}

function parseReported(text) {
  const got = {};
  const re = /PLGN\|([^|\r\n]+)\|(\d+)\|(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] === "END") continue;
    got[m[1]] = { size: parseInt(m[2], 10), crc: parseInt(m[3], 10) >>> 0 };
  }
  return got;
}

// ── Instalacja ────────────────────────────────────────────────────────────────
async function install() {
  els.install.disabled = true;
  els.connect.disabled = true;
  for (const f of manifest.files) $("f-" + f.name).className = "";

  try {
    // 1) co juz jest na zegarku
    let toSend = manifest.files;
    if (!els.force.checked) {
      status("Sprawdzam, co jest już na zegarku…");
      rxBuf = "";
      // CRC z 60 kB obrazka liczy sie zauwazalnie — stad hojny timeout w execLines
      await execLines(PRELUDE.concat(verifyLines(manifest.files.map((f) => f.name))));
      const have = parseReported(rxBuf);

      toSend = manifest.files.filter((f) => {
        const h = have[f.name];
        const same = h && h.size === f.size && h.crc === f.crc;
        if (same) {
          $("f-" + f.name).className = "skip";
          log(`pomijam ${f.name} (bez zmian)`);
        }
        return !same;
      });
    }

    if (!toSend.length) {
      progress(1, 1);
      status("Zegarek ma już aktualną wersję — nic do wgrania.", "ok");
      els.connect.disabled = true;
      els.install.disabled = false;
      return;
    }

    // 2) pobierz pliki i zbuduj program
    status(`Pobieram ${toSend.length} plik(ów)…`);
    const blobs = [];
    for (const f of toSend) blobs.push({ f, bytes: await fetchFile(f) });

    // 3) wyslij i zweryfikuj; nieudane pliki wgraj drugi raz w calosci
    //    (powtarzamy CALY plik, nigdy pojedyncze bajty — patrz writePacket)
    let pending = blobs;
    let failed = [];

    for (let pass = 1; pass <= 2 && pending.length; pass++) {
      if (pass === 2) {
        log(`ponawiam ${pending.length} plik(ów), które się nie zweryfikowały`);
      }

      const lines = PRELUDE.slice();
      for (const b of pending) lines.push.apply(lines, writeLines(b.f.name, b.bytes));
      lines.push(VERIFY_FN);
      for (const b of pending) lines.push(`_v(${JSON.stringify(b.f.name)});`);
      lines.push("echo(1);");

      const total = lines.reduce((a, l) => a + l.length + 16, 0);
      let sent = 0;
      rxBuf = "";
      const t0 = Date.now();
      await execLines(lines, (n) => {
        sent += n;
        progress(sent, total);
        const pct = Math.min(100, Math.round((sent / total) * 100));
        const kbs = sent / 1024 / Math.max(0.001, (Date.now() - t0) / 1000);
        status(`Wgrywam… ${pct}%  (${kbs.toFixed(1)} kB/s)`);
      });

      status("Weryfikuję…");
      const have = parseReported(rxBuf);

      failed = [];
      for (const b of pending) {
        const h = have[b.f.name];
        const li = $("f-" + b.f.name);
        if (h && h.size === b.f.size && h.crc === b.f.crc) {
          li.className = "done";
          log(`✓ ${b.f.name} ${h.size} B`);
        } else {
          li.className = "";
          failed.push(b);
          log(
            h
              ? `✗ ${b.f.name} — na zegarku ${h.size} B / crc ${h.crc}, oczekiwano ${b.f.size} / ${b.f.crc}`
              : `✗ ${b.f.name} — brak potwierdzenia z zegarka`,
          );
        }
      }

      if (/OUT OF MEMORY|LOW_MEMORY/.test(rxBuf)) {
        log("⚠ zegarek zgłosił brak pamięci w trakcie wgrywania");
      }
      pending = failed;
    }

    const ok = blobs.length - failed.length;
    if (!failed.length) {
      status(`Gotowe — wgrano i zweryfikowano ${ok}/${blobs.length}. Uruchom Poligon na zegarku.`, "ok");
    } else {
      // Nie wolno tego przemilczec: aplikacja z uszkodzonym plikiem nie wstanie.
      status(
        `NIE WGRANO POPRAWNIE: ${failed.map((b) => b.f.name).join(", ")}. ` +
          `Zegarek ma teraz niekompletną aplikację — powtórz instalację.`,
        "err",
      );
    }
  } catch (e) {
    console.error(e);
    log("BŁĄD: " + (e && e.message ? e.message : e));
    status(e && e.message ? e.message : String(e), "err");
  } finally {
    els.install.disabled = false;
    els.connect.disabled = !!txChar;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
(async function main() {
  if (!navigator.bluetooth) {
    els.unsupported.hidden = false;
    status("Web Bluetooth niedostępne w tej przeglądarce.", "err");
  } else {
    els.connect.disabled = false;
  }

  try {
    await loadManifest();
  } catch (e) {
    status(e.message, "err");
    els.build.textContent = "błąd";
    return;
  }

  els.connect.addEventListener("click", () =>
    connect().catch((e) => {
      // odrzucenie okna wyboru urzadzenia to nie blad
      if (e && e.name === "NotFoundError") return status("Nie wybrano urządzenia.");
      log("BŁĄD: " + e.message);
      status(e.message, "err");
    }),
  );
  els.install.addEventListener("click", install);
})();
