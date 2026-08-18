// poligon_mag.js
// Magnetometer / Compass streaming helper for Poligon
// - requires Bangle.setCompassPower(1, appId) to activate
// - start() enables compass + adds listener + starts fixed-rate send timer
// - Timer-based sending guarantees stable Hz (decoupled from BLE queue)
// - Default 1000 ms = 1 Hz
// - heading is NaN until the watch has been rotated 360 degrees after power-on

var enabled = false;
var last = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, heading: 0, ts: 0 };

var sendFn = null;
var intervalMs = 1000; // 1 Hz default
var sendTimer = null;
var appId = "poligon";
var debug = false;

function magHandler(xyz) {
  last = {
    x: xyz.x,
    y: xyz.y,
    z: xyz.z,
    dx: xyz.dx,
    dy: xyz.dy,
    dz: xyz.dz,
    heading: xyz.heading,
    ts: Date.now(),
  };
  if (debug) {
    print(
      "MAG x=" +
        xyz.x +
        " y=" +
        xyz.y +
        " z=" +
        xyz.z +
        " heading=" +
        xyz.heading,
    );
  }
}

function sendLatest() {
  if (!enabled || !sendFn || !last.ts) return;
  try {
    sendFn({
      t: "mag",
      x: last.x,
      y: last.y,
      z: last.z,
      dx: last.dx,
      dy: last.dy,
      dz: last.dz,
      heading: last.heading,
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
    Bangle.setCompassPower(1, appId);
  } catch (e) {}
  try {
    Bangle.on("mag", magHandler);
  } catch (e2) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("mag", magHandler);
  } catch (e) {}
  try {
    Bangle.setCompassPower(0, appId);
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
