/* poligon_qr.js
 * Ekran parowania: QR z payloadem dla apki mobilnej + adres MAC pod spodem.
 *
 * Format payloadu (parser: safeParseDevicePayload() w apce mobilnej,
 * src/components/FastConnectDeviceModal/FastConnectDeviceModal.tsx):
 *
 *     v;roleIndex;publicId;deviceId
 *
 * np. "1;2;CC1D4FB8E998;CC:1D:4F:B8:E9:98"
 *
 * Parser tnie po ";" i wymaga min. 4 czesci; deviceId to wszystko od 4. czesci
 * w gore (moze zawierac srednik), wiec v/role/publicId nie moga miec sredników.
 *
 * Layout (176x176): tytul / QR / MAC wysrodkowane jako jeden blok.
 * Skala QR jest calkowita (ostre moduly) i ograniczona SZEROKOSCIA ekranu,
 * wiec na napisy zostaje dokladnie tyle, ile nie zjadl kod. Przy 25 modulach
 * wychodzi 1+8+2+[150]+2+12+1 = 176 px co do piksela.
 *
 * Fonty sa bitmapowe, bo tylko takie sa ostre - Vector jest rasteryzowany
 * w locie i przy tych rozmiarach postrzepiony. Bangle.js 2 ma do wyboru
 * 4x6, 6x8, 6x15 i 12x20 (plus skalowanie osobno w osiach, np. "4x6:2x2"),
 * wiec wysokosci sa skokowe - miedzy 8 a 12 px nie ma nic.
 */

var UI = require("poligon_ui.js");

var PAYLOAD_VERSION = 1; // parser odrzuca wszystko != 1
// Indeksy rol z apki mobilnej (src/constants/connectingDeviceType.ts):
// 0=GEARBOX, 1=CAMERA, 2=WRISTBAND, 3=CAMERA_GEARBOX
var ROLE_WRISTBAND = 2;

var MARGIN = 1; // przerwa przy krawedziach ekranu
var GAP = 2; // odstep QR <-> tekst (minimalna quiet zone)
var BOLD = true; // pogrubienie przez podwojny drawString

var TITLE_FONT = "6x8"; // 6x8 px na znak
var TITLE_H = 8;

// 4x6 powiekszony 2x w obu osiach = 8x12 px na znak. Skalowanie w obu osiach
// (a nie "4x6:1x2") zachowuje proporcje znaku - inaczej wyglada rozciagniety.
var MAC_FONT = "4x6:2x2";
var MAC_FONT_NARROW = "4x6:1x2"; // awaryjnie dla dluzszych payloadow
var MAC_H = 12;

function encodeURIComponentLite(s) {
  // prosty encoder (w razie gdybyś chciał URL/deeplink)
  return s.replace(/%/g, "%25").replace(/ /g, "%20").replace(/:/g, "%3A");
}

// Espruino nie ma wariantow bold, wiec pogrubiamy rysujac napis dwa razy
// z przesunieciem o 1 px. Koszt: jeden dodatkowy drawString.
function drawBold(str, x, y) {
  g.drawString(str, x, y);
  if (BOLD) g.drawString(str, x + 1, y);
}

// Ustawia font, a gdy napis nie miesci sie na ekranie - wezszy wariant
// o tej samej wysokosci, zeby layout sie nie rozjechal.
function setFitFont(str, maxW, primary, narrow) {
  g.setFont(primary);
  if (!narrow) return;
  if (g.stringWidth(str) + (BOLD ? 1 : 0) > maxW) g.setFont(narrow);
}

// Apka mobilna laczy sie przez react-native-ble-plx, ktore na Androidzie
// oddaje deviceId prosto do BluetoothAdapter.getRemoteDevice() - a to
// wymaga MAC-a WIELKIMI literami. NRF.getAddress() zwraca male, wiec
// normalizujemy. Efekt uboczny: w foncie 4x6 znikaja male "b" i "d",
// ktore przy tym rozmiarze wygladaly jak odbite lustrzanie B i D.
function normalizeMac(mac) {
  return String(mac).toUpperCase();
}

exports.makePayload = function (mac, role) {
  var m = normalizeMac(mac);
  // publicId musi byc niepusty i bez srednika. MAC bez dwukropkow jest
  // stabilny i unikalny per zegarek, wiec nie generujemy UUID-a na urzadzeniu
  // (apka mobilna wstawia tam uuidv4(), ale nigdzie go potem nie uzywa
  // poza nazwa pliku przy zapisie obrazka QR).
  return (
    PAYLOAD_VERSION +
    ";" +
    (role === undefined ? ROLE_WRISTBAND : role) +
    ";" +
    m.replace(/:/g, "") +
    ";" +
    m
  );
};

exports.draw = function (opts) {
  opts = opts || {};
  var mac = normalizeMac(opts.mac || NRF.getAddress());
  var payload = opts.payload || exports.makePayload(mac, opts.role);
  var title = opts.title === undefined ? "SCAN TO PAIR." : opts.title;

  var W = g.getWidth();
  var H = g.getHeight();

  // Czysty bialy kanwas niezaleznie od motywu zegarka - g.clear(1) resetuje
  // kolory do theme, wiec forceBW() musi isc PO nim, a nie przed.
  UI.clearScreen(true);
  UI.forceBW();
  g.clearRect(0, 0, W - 1, H - 1);

  var bmp = require("libqr").getImage(payload);
  var m = g.imageMetrics(bmp);

  var above = title ? TITLE_H + GAP : 0;
  var below = mac ? MAC_H + GAP : 0;

  var availW = W - 2 * MARGIN;
  var availH = H - 2 * MARGIN - above - below;

  var sw = Math.floor(availW / m.width);
  var sh = Math.floor(availH / m.height);
  var scale = sw < sh ? sw : sh;
  if (scale < 1) scale = 1;

  var qrW = m.width * scale;
  var qrH = m.height * scale;
  var x = (W - qrW) >> 1;
  var y = ((H - (qrH + above + below)) >> 1) + above;

  g.setFontAlign(0, -1);

  if (title) {
    setFitFont(title, availW, TITLE_FONT, null);
    drawBold(title, W >> 1, y - GAP - TITLE_H);
  }

  g.drawImage(bmp, x, y, { scale: scale });

  if (mac) {
    setFitFont(mac, availW, MAC_FONT, MAC_FONT_NARROW);
    drawBold(mac, W >> 1, y + qrH + GAP);
  }

  try {
    Bangle.setLCDPower(1);
  } catch (e) {}
};
