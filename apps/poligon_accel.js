// poligon_accel.js
// Accelerometer streaming helper for Poligon
// - Accelerometer on Bangle.js 2 is always powered (no setAccelPower needed)
// - start() adds event listener + starts fixed-rate send timer
// - Timer-based sending guarantees stable Hz (decoupled from BLE queue)
// - Default 100 ms = 10 Hz

var enabled = false;
var last = { x: 0, y: 0, z: 0, diff: 0, mag: 0, ts: 0 };

var sendFn = null;
var intervalMs = 100; // 10 Hz default
var sendTimer = null;
var appId = "poligon";
var debug = false;

function accelHandler(xyz) {
  last = {
    x: xyz.x,
    y: xyz.y,
    z: xyz.z,
    diff: xyz.diff,
    mag: xyz.mag,
    ts: Date.now(),
  };
  if (debug) {
    print(
      "ACCEL x=" + xyz.x + " y=" + xyz.y + " z=" + xyz.z + " mag=" + xyz.mag,
    );
  }
}

function sendLatest() {
  if (!enabled || !sendFn || !last.ts) return;
  try {
    sendFn({
      t: "accel",
      x: last.x,
      y: last.y,
      z: last.z,
      diff: last.diff,
      mag: last.mag,
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
    // Already running — update interval if changed
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
    Bangle.on("accel", accelHandler);
  } catch (e) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("accel", accelHandler);
  } catch (e) {}
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
