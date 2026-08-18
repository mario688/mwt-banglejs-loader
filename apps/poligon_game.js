// poligon_game.js — HUD gry na tle game.img
//
// Tlo ma cztery narozne panele z wbudowanymi ikonami (HR:, but, nabój, serce).
// Wartosci trafiaja w wolne miejsce OBOK ikony. Prostokaty ponizej zmierzone
// bezposrednio na obrazku (najwiekszy pusty obszar w kazdym panelu):
//
//   bpm   x 20..73   y 33..53    54x21   (pod etykieta "HR:")
//   steps x 104..155 y 35..53    52x19   (pod butem)
//   ammo  x 34..69   y 116..147  36x32   (obok naboju)
//   hp    x 121..153 y 120..147  33x28   (obok serca)

var S = require("Storage");

var BG_FILE = "game.img";

// Storage.read() zwraca string mapowany w pamieci read-only — te ~60 KB
// nie zajmuja RAM-u. Czytamy raz przy ladowaniu modulu.
var bg = S.read(BG_FILE);

// Fonty bitmapowe (ostre, bez ditheringu). Metryki na sztywno, zeby dobor
// byl deterministyczny i liczyl sie raz, a nie przy kazdym rysowaniu.
// Kolejnosc malejaco po powierzchni znaku — bierzemy pierwszy, ktory wchodzi.
// "4x6:2x3" to font 4x6 rozciagniety 2x w poziomie i 3x w pionie (8x18 px);
// wchodzi tam, gdzie 12 px na znak jest juz za szerokie, a 6x15 za male.
var FONTS = [
  { n: "12x20", w: 12, h: 20 },
  { n: "6x8:2", w: 12, h: 16 },
  { n: "4x6:2x3", w: 8, h: 18 },
  { n: "6x15", w: 6, h: 15 },
  { n: "6x8", w: 6, h: 8 },
];

// Prostokaty obejmuja obszary, ktore na 3-bitowym ekranie i tak renderuja sie
// na czarno (zaden kanal nie przebija najnizszego progu ditheringu, ~8/255).
// Dzieki temu odswiezenie pojedynczego pola to zwykle wypelnienie czernia —
// na ekranie nie do odroznienia od tla — zamiast blitowania 31 tys. pikseli
// obrazka co sekunde. Zmieniajac tlo, przelicz te prostokaty ponownie.
//
// max = najdluzsza spodziewana wartosc. Font dobieramy pod TE dlugosc, nie pod
// biezaca — inaczej cyfry zmienialyby rozmiar np. przy przejsciu hp 99 -> 100.
var F = {
  bpm: { x1: 24, y1: 39, x2: 70, y2: 58, max: 3, col: [1, 0, 0] },
  steps: { x1: 104, y1: 36, x2: 155, y2: 53, max: 4, col: [1, 1, 1] },
  ammo: { x1: 34, y1: 127, x2: 70, y2: 146, max: 3, col: [1, 1, 0] },
  hp: { x1: 121, y1: 129, x2: 153, y2: 146, max: 3, col: [1, 0, 0] },
};

function pickFont(f) {
  var fw = f.x2 - f.x1 + 1;
  var fh = f.y2 - f.y1 + 1;
  for (var i = 0; i < FONTS.length; i++) {
    if (FONTS[i].w * f.max <= fw && FONTS[i].h <= fh) return FONTS[i].n;
  }
  return FONTS[FONTS.length - 1].n;
}

for (var k in F) {
  F[k].font = pickFont(F[k]);
  F[k].cx = (F[k].x1 + F[k].x2) >> 1;
  F[k].cy = (F[k].y1 + F[k].y2) >> 1;
}

var prevBpm = -1;
var prevSteps = -1;

// Przerysowanie JEDNEGO pola: czyscimy jego prostokat i piszemy wartosc.
// Bez czyszczenia stare cyfry zostawalyby pod nowymi (np. 100 -> 99 = "990").
function paintField(f, text) {
  g.setBgColor(0, 0, 0);
  g.clearRect(f.x1, f.y1, f.x2, f.y2);
  g.setFont(f.font);
  g.setFontAlign(0, 0);
  g.setColor(f.col[0], f.col[1], f.col[2]);
  g.drawString(text, f.cx, f.cy);
}

// Full redraw (on screen enter or ammo/hp change)
exports.draw = function (opts) {
  opts = opts || {};
  var ammo = opts.ammo != null ? opts.ammo : 0;
  var hp = opts.hp != null ? opts.hp : 0;
  var hrObj = opts.hr || {};
  var bpm = hrObj.bpm || 0;
  var stepObj = opts.step || {};
  var steps = stepObj.delta || 0;

  g.reset();
  if (bg) {
    g.drawImage(bg, 0, 0);
  } else {
    g.setBgColor(0, 0, 0);
    g.clearRect(0, 0, g.getWidth() - 1, g.getHeight() - 1);
  }

  // tlo jest juz na ekranie, wiec same napisy — bez odtwarzania kawalkow
  g.setFontAlign(0, 0);
  var order = ["bpm", "steps", "ammo", "hp"];
  var vals = { bpm: bpm, steps: steps, ammo: ammo, hp: hp };
  for (var i = 0; i < order.length; i++) {
    var f = F[order[i]];
    g.setFont(f.font);
    g.setColor(f.col[0], f.col[1], f.col[2]);
    g.drawString(String(vals[order[i]]), f.cx, f.cy);
  }

  prevBpm = bpm;
  prevSteps = steps;

  Bangle.setLCDPower(1);
};

// Partial HR-only redraw (called by 1 Hz timer)
exports.drawHr = function (hrObj) {
  var bpm = hrObj && hrObj.bpm ? hrObj.bpm : 0;
  if (bpm === prevBpm) return; // no change, skip
  paintField(F.bpm, String(bpm));
  prevBpm = bpm;
};

// Partial step-only redraw (called by UI timer)
exports.drawStep = function (stepObj) {
  var steps = stepObj && stepObj.delta ? stepObj.delta : 0;
  if (steps === prevSteps) return;
  paintField(F.steps, String(steps));
  prevSteps = steps;
};
