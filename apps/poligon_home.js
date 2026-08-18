/* poligon_home.js
 * Produkcyjny ekran glowny: tlo home_2.img + godzina i data pod nia.
 *
 * Tlo to obrazek 176x176, 8 bpp (naglowek b0 b0 08), czyli dokladnie ekran
 * Bangle.js 2. Wyswietlacz jest 3-bitowy, wiec Espruino przemapuje palete
 * Web Safe na 8 dostepnych kolorow - obrazek bedzie ubozszy niz oryginal.
 *
 * Ekran odswieza sie raz na minute, w partii rownej gornemu paskowi
 * (setClipRect), zeby nie przerysowywac calego tla co tick.
 */

var S = require("Storage");

var BG_FILE = "home_10.img";

// Storage.read() zwraca string mapowany w pamieci read-only, wiec te ~30 KB
// NIE zajmuje RAM-u. Czytamy raz przy ladowaniu modulu - wczytanie tego do
// zwyklej zmiennej co draw() rozwalilo by pamiec zegarka.
var bg = S.read(BG_FILE);

var TIME_FONT = "12x20:2"; // 24x40 px na znak -> "12:34" = 120 px
var TIME_H = 40;
var TIME_Y = 8;

var DATE_FONT = "6x8:2"; // 12x16 px na znak -> "WT 12.08.2026" = 156 px
var DATE_H = 16;
var DATE_Y = TIME_Y + TIME_H + 4; // 52

// +2 na kontur; tyle wierszy przerysowujemy przy tyknieciu minuty
var CLIP_BOTTOM = DATE_Y + DATE_H + 2;

// getDay(): 0 = niedziela. Bez polskich znakow - font 6x8 jest ASCII-only.
var DAYS = ["ND", "PN", "WT", "SR", "CZ", "PT", "SO"];

var timer = null;

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

function timeStr(d) {
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function dateStr(d) {
  return (
    DAYS[d.getDay()] +
    " " +
    pad2(d.getDate()) +
    "." +
    pad2(d.getMonth() + 1) +
    "." +
    d.getFullYear()
  );
}

// Bialy tekst z czarnym konturem. Tlo jest ciemne (srednia jasnosc 5-31),
// ale niejednolite - siatka i celownik potrafia zjesc sam bialy napis.
function drawOutlined(str, x, y) {
  g.setColor(0, 0, 0);
  g.drawString(str, x - 1, y);
  g.drawString(str, x + 1, y);
  g.drawString(str, x, y - 1);
  g.drawString(str, x, y + 1);
  g.setColor(1, 1, 1);
  g.drawString(str, x, y);
}

// full=true  -> cale tlo (wejscie na ekran)
// full=false -> tylko pasek z zegarem (tykniecie minuty)
function paint(full) {
  var w = g.getWidth();
  var h = g.getHeight();
  var d = new Date();

  if (!full) g.setClipRect(0, 0, w - 1, CLIP_BOTTOM);

  if (bg) {
    g.drawImage(bg, 0, 0);
  } else {
    // brak pliku w Storage - zegar ma dzialac mimo wszystko
    g.setBgColor(0, 0, 0);
    g.clearRect(0, 0, w - 1, h - 1);
  }

  g.setFontAlign(0, -1);
  g.setFont(TIME_FONT);
  drawOutlined(timeStr(d), w >> 1, TIME_Y);
  g.setFont(DATE_FONT);
  drawOutlined(dateStr(d), w >> 1, DATE_Y);

  if (!full) g.setClipRect(0, 0, w - 1, h - 1);
}

// Budzik ustawiony na rowna minute, a nie setInterval(60000) - inaczej
// zegar rozjezdza sie z sekundnikiem systemowym.
function schedule() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  var now = new Date();
  var ms = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  if (ms < 250) ms += 60000;
  timer = setTimeout(function () {
    timer = null;
    // po ciemku nie ma co rysowac - app.js przerysuje na zdarzenie lcdPower
    var on = true;
    try {
      on = Bangle.isLCDOn();
    } catch (e) {}
    if (on) paint(false);
    schedule();
  }, ms);
}

exports.draw = function (opts) {
  paint(true);
  try {
    Bangle.setLCDPower(1);
  } catch (e) {}
  schedule();
};

// Wolane przez go() w poligon.app.js przy wyjsciu z ekranu - bez tego timer
// zylby dalej i domalowywal zegar na innych ekranach.
exports.stop = function () {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};
