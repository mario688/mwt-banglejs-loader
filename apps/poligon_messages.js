// poligon_messages.js — Chat history screen for Bangle.js 2 (176×176)
//
// Protocol:  { t: 'chat', sender: 'Alice', message: 'Hello!', createdAt: <ms> }
// Navigation: { t: 'nav', screen: 'messages' }
//
// Controls (when screen is active, via Bangle.setUI("updown")):
//   Swipe up / down → scroll through messages
//   Tap / BTN1      → go back to game screen

// ── Layout constants ──────────────────────────────────────────────────────────
//
// Ciemne tlo + zielone akcenty, zeby ekran pasowal do reszty HUD-a. Kolory
// dobrane z osemki barw ekranu 3-bitowego, wiec nic sie nie dithuje.
var PAD = 5; // margines boczny
var HEADER_H = 22; // pasek tytulu (bez wypelnienia, tylko tekst + linia)
var SENDER_H = 8; // "6x8" x1
var MSG_H = 16; // "6x8" x2
var MAX_MSG_LINES = 2;
var ROW_GAP = 6; // odstep miedzy wiadomosciami
var ROW_H = SENDER_H + 2 + MSG_H * MAX_MSG_LINES + ROW_GAP; // = 48
var MAX_MSGS = 30;
var TEXT_X = PAD + 2;
var TEXT_W = 176 - TEXT_X - 14; // 14 px z prawej zostaje na strzalki scrolla
var ARROW_X = 176 - 9;

// ── Polish diacritics → ASCII lookup for E.decodeUTF8 ────────────────────────
var _plLookup = {
  0x0105: "a",
  0x0104: "A", // ą Ą
  0x0107: "c",
  0x0106: "C", // ć Ć
  0x0119: "e",
  0x0118: "E", // ę Ę
  0x0142: "l",
  0x0141: "L", // ł Ł
  0x0144: "n",
  0x0143: "N", // ń Ń
  0x00f3: "o",
  0x00d3: "O", // ó Ó
  0x015b: "s",
  0x015a: "S", // ś Ś
  0x017a: "z",
  0x0179: "Z", // ź Ź
  0x017c: "z",
  0x017b: "Z", // ż Ż
};

function _sanitize(s) {
  if (typeof s !== "string") return "";
  try {
    s = E.decodeUTF8(s, _plLookup, "?");
  } catch (e) {}
  return s;
}

// ── State ─────────────────────────────────────────────────────────────────────
var _msgs = []; // [{ sender, text, ts }] sorted ascending by ts
var _offset = 0; // 0 = latest; +N = scrolled N rows toward older

function _visibleRows() {
  return Math.floor((g.getHeight() - HEADER_H) / ROW_H);
}

// ── Public API ────────────────────────────────────────────────────────────────

exports.addMessage = function (msg) {
  var rawTs = msg.createdAt;
  var ts;
  if (typeof rawTs === "number" && !isNaN(rawTs)) {
    ts = rawTs;
  } else if (typeof rawTs === "string") {
    ts = Date.parse(rawTs);
    if (isNaN(ts)) ts = Date.now();
  } else {
    ts = Date.now();
  }

  _msgs.push({
    sender: _sanitize(msg.sender != null ? String(msg.sender) : "?"),
    text: _sanitize(msg.message != null ? String(msg.message) : ""),
    ts: ts,
  });
  // No sort — trust arrival order (server sends chronologically).
  // sort() caused order bugs when timestamps were equal or NaN.
  if (_msgs.length > MAX_MSGS) _msgs.splice(0, _msgs.length - MAX_MSGS);
  _offset = 0;
};

exports.scrollUp = function () {
  var maxOffset = Math.max(0, _msgs.length - _visibleRows());
  if (_offset < maxOffset) {
    _offset++;
    exports.draw();
  }
};

exports.scrollDown = function () {
  if (_offset > 0) {
    _offset--;
    exports.draw();
  }
};

exports.scrollToBottom = function () {
  _offset = 0;
  exports.draw();
};

// ── Draw ──────────────────────────────────────────────────────────────────────

// Naroznik ramki HUD — dwie kreski, jak na tlach pozostalych ekranow.
function corner(x, y, dx, dy) {
  g.drawLine(x, y, x + dx * 9, y);
  g.drawLine(x, y, x, y + dy * 9);
}

exports.draw = function () {
  var W = g.getWidth();
  var H = g.getHeight();
  var rows = _visibleRows();

  // Czarne tlo, zielone akcenty — spojnie z HUD-em i bez ditheringu.
  //
  // UWAGA na kolejnosc: clear(1) NAJPIERW resetuje kolory do motywu zegarka,
  // dopiero potem czysci. Ustawienie tla przed nim jest wyrzucane i ekran
  // wychodzi bialy (a wtedy biala tresc wiadomosci znika). Dlatego kolor
  // ustawiamy PO clear i jawnie zamalowujemy caly ekran.
  g.clear(1);
  g.setBgColor(0, 0, 0);
  g.clearRect(0, 0, W - 1, H - 1);

  // ── Ramka HUD ─────────────────────────────────────────────────
  g.setColor(0, 1, 0);
  corner(PAD, PAD, 1, 1);
  corner(W - 1 - PAD, PAD, -1, 1);
  corner(PAD, H - 1 - PAD, 1, -1);
  corner(W - 1 - PAD, H - 1 - PAD, -1, -1);

  // ── Naglowek: tytul + licznik pozycji ─────────────────────────
  g.setFont("6x8", 2);
  g.setFontAlign(-1, -1);
  g.drawString("MSG", TEXT_X, PAD + 3);

  if (_msgs.length > 0) {
    var shown = Math.min(rows, _msgs.length - _offset);
    var last = _msgs.length - _offset;
    g.setFont("6x8", 1);
    g.setFontAlign(1, -1);
    g.drawString(last - shown + 1 + "-" + last + "/" + _msgs.length, W - TEXT_X, PAD + 7);
  }
  g.drawLine(TEXT_X, HEADER_H, W - TEXT_X, HEADER_H);

  // ── Brak wiadomosci ───────────────────────────────────────────
  if (_msgs.length === 0) {
    g.setFont("6x8", 1);
    g.setFontAlign(0, 0);
    g.drawString("BRAK WIADOMOSCI", W / 2, H / 2);
    Bangle.setLCDPower(1);
    return;
  }

  // ── Widoczne okno ─────────────────────────────────────────────
  var startIdx = _msgs.length - rows - _offset;
  if (startIdx < 0) startIdx = 0;
  var endIdx = Math.min(startIdx + rows, _msgs.length);

  // ── Strzalki scrolla ──────────────────────────────────────────
  if (startIdx > 0) {
    var ay = HEADER_H + 9;
    g.fillPoly([ARROW_X, ay - 5, ARROW_X - 5, ay + 3, ARROW_X + 5, ay + 3]);
  }
  if (_offset > 0) {
    var by = H - PAD - 6;
    g.fillPoly([ARROW_X, by + 5, ARROW_X - 5, by - 3, ARROW_X + 5, by - 3]);
  }

  // ── Wiadomosci ────────────────────────────────────────────────
  var y = HEADER_H + 6;
  for (var i = startIdx; i < endIdx; i++) {
    var m = _msgs[i];

    // nadawca — zielony, maly
    g.setColor(0, 1, 0);
    g.setFont("6x8", 1);
    g.setFontAlign(-1, -1);
    g.drawString(m.sender, TEXT_X, y);

    // tresc — biala, wieksza, lamana do 2 linii
    g.setColor(1, 1, 1);
    g.setFont("6x8", 2);
    var lines = g.wrapString(m.text, TEXT_W);
    for (var li = 0; li < Math.min(lines.length, MAX_MSG_LINES); li++) {
      var line = lines[li];
      // "..." na koncu ostatniej widocznej linii, gdy tresc jest dluzsza
      if (li === MAX_MSG_LINES - 1 && lines.length > MAX_MSG_LINES) {
        line = line.substring(0, line.length - 2) + "..";
      }
      g.drawString(line, TEXT_X, y + SENDER_H + 2 + li * MSG_H);
    }

    y += ROW_H;

    // separator — krotka zielona kreska, lzejsza niz linia przez caly ekran
    if (i < endIdx - 1) {
      g.setColor(0, 1, 0);
      g.drawLine(TEXT_X, y - ROW_GAP / 2, TEXT_X + 40, y - ROW_GAP / 2);
    }
  }

  Bangle.setLCDPower(1);
};
