// poligon_compass.js — Compass screen for Bangle.js 2 (176x176)
//
// Event-driven: redraws on every 'mag' event (heading update).
// Uses a 2bpp off-screen buffer for compass needle animation.
// Does NOT send BLE data — display-only screen.
//
// Usage:
//   COMPASS.start()  — enable compass power, start drawing
//   COMPASS.stop()   — release compass power, clean up

// ── Off-screen buffer (created once at require time) ─────────────
//
// AGS musi byc wielokrotnoscia 4: przy 2 bpp wiersz zajmuje AGS*2 bitow,
// a obiekt obrazka jest czytany przez drawImage jako ciagly strumien bitow
// bez dopelniania wierszy do pelnych bajtow. 152*2/8 = 38 B rowno.
var AGS = 152;             // buffer side length (px) — bylo 120
var AGM = AGS / 2;         // center / radius = 76
var RING_W = 12;           // ring thickness
var RING_OUTER = AGM - 2;  // 74
var RING_INNER = RING_OUTER - RING_W; // 62
var AGH = RING_INNER;      // arrow tip stops at ring inner edge
var ARROW_W = 10;          // arrow half-width at the base
var LABEL_R = 46;          // cardinal labels distance from center

// Indeksy palety bufora (2 bpp = 4 wpisy, wykorzystane wszystkie)
var C_BG = 0;    // biale tlo
var C_FG = 1;    // czarny: pierscien, litery E/W, czop
var C_N = 2;     // czerwony: grot N + litera N
var C_S = 3;     // niebieski: grot S + litera S

var ag = Graphics.createArrayBuffer(AGS, AGS, 2, { msb: true });
var aimg = {
  width: AGS,
  height: AGS,
  bpp: 2,
  buffer: ag.buffer,
  palette: null, // set in start()
};

// ── Layout ───────────────────────────────────────────────────────
var W = g.getWidth();
var H = g.getHeight();
var HEADING_H = H - AGS;                   // 24 — pasek z odczytem stopni
var COMPASS_X = Math.floor((W - AGS) / 2); // 12
var COMPASS_Y = HEADING_H;                 // 24 — kompas zajmuje reszte ekranu

// ── State ─────────────────────────────────────────────────────────
var _enabled = false;
var _magHandler = null;
var _lastHeading = NaN;
var _calibrated = false;

// ── Drawing helpers ───────────────────────────────────────────────

// Filled-triangle arrow in off-screen buffer
// r = angle in degrees (compass bearing), c = color index
function drawArrow(r, c) {
  var rad = ((360 - r) * Math.PI) / 180;
  var p = Math.PI / 2;
  ag.setColor(c).fillPoly([
    AGM + AGH * Math.sin(rad),                AGM - AGH * Math.cos(rad),
    AGM + ARROW_W * Math.sin(rad + p),        AGM - ARROW_W * Math.cos(rad + p),
    AGM + ARROW_W * Math.sin(rad - p),        AGM - ARROW_W * Math.cos(rad - p),
  ]);
}

// Full compass buffer redraw
function drawBuffer(heading) {
  // Clear to white
  ag.setColor(C_BG).fillRect(0, 0, AGS - 1, AGS - 1);

  // Ring (annulus): outer filled circle, inner hole
  ag.setColor(C_FG).fillCircle(AGM, AGM, RING_OUTER);
  ag.setColor(C_BG).fillCircle(AGM, AGM, RING_INNER);

  // Cardinal labels inside white center circle.
  // N/S dostaja kolory grotow, E/W zostaja czarne.
  ag.setFont("6x8", 2).setFontAlign(0, 0);
  ag.setColor(C_N).drawString("N", AGM, AGM - LABEL_R);
  ag.setColor(C_S).drawString("S", AGM, AGM + LABEL_R);
  ag.setColor(C_FG);
  ag.drawString("W", AGM - LABEL_R, AGM);
  ag.drawString("E", AGM + LABEL_R, AGM);

  if (!isNaN(heading)) {
    drawArrow(heading, C_N);       // polnoc — czerwony
    drawArrow(heading + 180, C_S); // poludnie — niebieski
  }

  // Center pivot dot — na wierzchu, zeby styk grotow byl czysty
  ag.setColor(C_FG).fillCircle(AGM, AGM, 3);
}

// Full screen redraw
function drawScreen(heading, calibrated) {
  // ── Heading text ────────────────────────────────────────────────
  g.setBgColor(1, 1, 1);
  g.clearRect(0, 0, W - 1, HEADING_H - 1);
  g.setColor(0, 0, 0).setFontAlign(0, 0);
  if (calibrated) {
    g.setFont("6x8", 2);
    g.drawString(Math.round(heading) + "\xb0", W / 2, HEADING_H / 2);
  } else {
    // bez polskich znakow - font 6x8 ich nie ma, "ó" wyszloby jako smiec
    g.setFont("6x8", 1);
    g.drawString("Kalibruj - obroc 360\xb0", W / 2, HEADING_H / 2);
  }

  // ── Compass buffer ───────────────────────────────────────────────
  drawBuffer(heading);
  g.drawImage(aimg, COMPASS_X, COMPASS_Y);

  Bangle.setLCDPower(1);
}

// ── Public API ────────────────────────────────────────────────────

exports.start = function () {
  if (_enabled) {
    // Already running — just redraw current state (e.g. after LCD power-on)
    drawScreen(_lastHeading, _calibrated);
    return;
  }
  _enabled = true;

  // Build palette (needs g to be available).
  // Czerwien i blekit sa dokladnie w 8 barwach ekranu 3-bitowego,
  // wiec nie zostana zditherowane.
  aimg.palette = new Uint16Array([
    g.toColor(1, 1, 1), // 0 = white (background)
    g.toColor(0, 0, 0), // 1 = black (ring, E/W labels, pivot)
    g.toColor(1, 0, 0), // 2 = red (N arrow + N label)
    g.toColor(0, 0, 1), // 3 = blue (S arrow + S label)
  ]);

  // Draw initial state (uncalibrated).
  // clear(1) najpierw resetuje kolory do motywu zegarka, wiec bialy kanwas
  // trzeba wymusic PO nim — inaczej paski po bokach tarczy (x 0..11 i
  // 164..175) przyjmuja kolor motywu zamiast bieli.
  g.clear(1);
  g.setColor(0, 0, 0).setBgColor(1, 1, 1);
  g.clearRect(0, 0, g.getWidth() - 1, g.getHeight() - 1);
  drawScreen(NaN, false);

  _magHandler = function (m) {
    if (!_enabled) return;
    _lastHeading = m.heading;
    _calibrated = !isNaN(m.heading);
    drawScreen(_lastHeading, _calibrated);
  };

  try { Bangle.setCompassPower(1, "poligon_cmp"); } catch (e) {}
  try { Bangle.on("mag", _magHandler); } catch (e) {}
};

exports.stop = function () {
  if (!_enabled) return;
  _enabled = false;
  if (_magHandler) {
    try { Bangle.removeListener("mag", _magHandler); } catch (e) {}
    _magHandler = null;
  }
  try { Bangle.setCompassPower(0, "poligon_cmp"); } catch (e) {}
};

exports.isEnabled = function () { return _enabled; };
