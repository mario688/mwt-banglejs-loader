// poligon_gps_screen.js — GPS info screen for Bangle.js 2 (176x176)
//
// Shows: fix, lat, lon, alt, spd+course, sat+hdop, time (UTC)
// Style: black-on-white, same as poligon_qr.js

var HEADER_H = 28;
var LINE_H = 20; // "6x8" x2 = 16px + 4px gap

// Format Unix ms timestamp as HH:MM:SS UTC (no Date object — pure arithmetic)
function fmtTime(ms) {
  if (!ms || ms <= 0) return "--:--:--";
  var sec = Math.floor(ms / 1000);
  var s = sec % 60;
  var min = Math.floor(sec / 60);
  var m = min % 60;
  var h = Math.floor(min / 60) % 24;
  return (h < 10 ? "0" : "") + h + ":" +
         (m < 10 ? "0" : "") + m + ":" +
         (s < 10 ? "0" : "") + s;
}

exports.draw = function (gps) {
  var W = g.getWidth();
  var H = g.getHeight();

  g.setColor("#000");
  g.setBgColor("#fff");
  g.clear(1);

  // ── Header ────────────────────────────────────────────────────
  g.setColor(0, 0, 0);
  g.fillRect(0, 0, W, HEADER_H);
  g.setColor(1, 1, 1);
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString("GPS", W / 2, HEADER_H / 2 + 1);

  g.setColor(0, 0, 0);
  g.setFont("6x8", 2);
  g.setFontAlign(-1, -1);

  if (!gps || !gps.ts) {
    g.setFontAlign(0, 0);
    g.drawString("GPS OFF", W / 2, H / 2);
    Bangle.setLCDPower(1);
    return;
  }

  var y = HEADER_H + 6;

  // ── Fix status ────────────────────────────────────────────────
  var fixStr = gps.fix > 0 ? "FIX OK" : "Szukam...";
  g.drawString(fixStr, 4, y);
  y += LINE_H;

  if (gps.fix > 0) {
    // ── Coordinates ───────────────────────────────────────────────
    var latStr = "La:" + (typeof gps.lat === "number" ? gps.lat.toFixed(5) : "---");
    var lonStr = "Lo:" + (typeof gps.lon === "number" ? gps.lon.toFixed(5) : "---");
    g.drawString(latStr, 4, y);
    y += LINE_H;
    g.drawString(lonStr, 4, y);
    y += LINE_H;

    // ── Altitude ──────────────────────────────────────────────────
    var altStr = "Alt:" + (typeof gps.alt === "number" ? Math.round(gps.alt) + "m" : "---");
    g.drawString(altStr, 4, y);
    y += LINE_H;

    // ── Speed | Course (one row, split at centre) ─────────────────
    var spdStr = "Sp:" + (typeof gps.speed === "number" ? gps.speed.toFixed(1) : "---");
    var coStr  = "Co:" + (typeof gps.course === "number" ? Math.round(gps.course) + "\xb0" : "---");
    g.setFontAlign(-1, -1);
    g.drawString(spdStr, 4, y);
    g.setFontAlign(1, -1);
    g.drawString(coStr, W - 4, y);
    g.setFontAlign(-1, -1);
    y += LINE_H;
  }

  // ── Satellites | HDOP (one row) ───────────────────────────────
  var satStr  = "Sa:" + (gps.satellites || 0);
  var hdopStr = "HD:" + (gps.hdop != null ? gps.hdop.toFixed(1) : "---");
  g.setFontAlign(-1, -1);
  g.drawString(satStr, 4, y);
  g.setFontAlign(1, -1);
  g.drawString(hdopStr, W - 4, y);
  g.setFontAlign(-1, -1);
  y += LINE_H;

  // ── GPS UTC time ──────────────────────────────────────────────
  var timeStr = "UTC:" + fmtTime(gps.time);
  g.drawString(timeStr, 4, y);

  Bangle.setLCDPower(1);
};
