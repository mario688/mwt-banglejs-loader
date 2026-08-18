// poligon_gps.js — GPS sensor module for Bangle.js 2
//
// Same pattern as poligon_hr.js / poligon_baro.js / poligon_mag.js
//
// BLE protocol:
//   Phone → Watch:  { t: 'sensor', sensor: 'gps', enable: true, intervalMs: 5000 }
//   Watch → Phone:  batched in master sensor tick as msg.p = { la, lo, al, sp, co, sa, fx, hd }
//
// Power draw: ~20 mA when active — use long intervals (default 5000 ms)

var enabled = false;
var last = {
  fix: 0,
  lat: 0,
  lon: 0,
  alt: 0,
  speed: 0,
  course: 0,
  satellites: 0,
  hdop: 99,
  time: 0, // GPS UTC time as Unix ms (0 = unknown)
  ts: 0,
};
var sendFn = null;
var intervalMs = 5000;
var sendTimer = null;
var appId = "poligon";
var debug = false;

function gpsHandler(fix) {
  var gpsTimeMs = 0;
  try {
    var t = +fix.time; // numeric coercion: Date → Unix ms, undefined/null → NaN
    if (t === t && t > 0) gpsTimeMs = t; // t === t is NaN check
  } catch (e) {}
  last = {
    fix: fix.fix || 0,
    lat: fix.lat || 0,
    lon: fix.lon || 0,
    alt: fix.alt || 0,
    speed: fix.speed || 0,
    course: fix.course || 0,
    satellites: fix.satellites || 0,
    hdop: fix.hdop || 99,
    time: gpsTimeMs,
    ts: Date.now(),
  };
  if (debug) {
    print(
      "GPS fix=" +
        last.fix +
        " lat=" +
        last.lat +
        " lon=" +
        last.lon +
        " sat=" +
        last.satellites,
    );
  }
}

function sendLatest() {
  if (!enabled || !sendFn || !last.ts) return;
  try {
    sendFn({
      t: "gps",
      fix: last.fix,
      lat: last.lat,
      lon: last.lon,
      alt: last.alt,
      speed: last.speed,
      course: last.course,
      sat: last.satellites,
      hdop: last.hdop,
      time: last.time,
      ts: Date.now(),
    });
  } catch (e) {}
}

exports.start = function (opts) {
  opts = opts || {};
  sendFn = opts.send || sendFn;
  var newInterval = opts.intervalMs != null ? opts.intervalMs : intervalMs;
  appId = opts.appId || appId;

  if (enabled) {
    // Already running — just update interval if needed
    if (newInterval !== intervalMs) {
      intervalMs = newInterval;
      if (sendTimer) clearInterval(sendTimer);
      if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
    }
    return;
  }

  intervalMs = newInterval;
  enabled = true;

  try {
    Bangle.setGPSPower(1, appId);
  } catch (e) {}
  try {
    Bangle.on("GPS", gpsHandler);
  } catch (e2) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("GPS", gpsHandler);
  } catch (e) {}
  try {
    Bangle.setGPSPower(0, appId);
  } catch (e2) {}
  if (sendTimer) {
    clearInterval(sendTimer);
    sendTimer = null;
  }
};

exports.getLast = function () {
  return last;
};
exports.isEnabled = function () {
  return enabled;
};
exports.setDebug = function (v) {
  debug = !!v;
};
