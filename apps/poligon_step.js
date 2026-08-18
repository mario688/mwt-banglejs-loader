// poligon_step.js — Step counter module for Bangle.js 2
//
// Same pattern as poligon_hr.js / poligon_gps.js
//
// BLE protocol:
//   Phone → Watch:  { t: 'sensor', sensor: 'step', enable: true, intervalMs: 2000 }
//   Watch → Phone:  batched in master sensor tick as msg.st = { c, d }
//     c = total step count, d = steps since last reset
//
// Uses Bangle.on("step") event — no extra power draw (accelerometer already runs)

var enabled = false;
var last = { count: 0, delta: 0, ts: 0 };
var sendFn = null;
var intervalMs = 2000;
var sendTimer = null;
var debug = false;
var startCount = 0; // count at start() — for delta calculation

function stepHandler(up) {
  var now = Date.now();
  last = {
    count: up,
    delta: up - startCount,
    ts: now,
  };
  if (debug) {
    print("STEP count=" + up + " delta=" + last.delta);
  }
}

function sendLatest() {
  if (!enabled || !sendFn || !last.ts) return;
  try {
    sendFn({
      t: "step",
      count: last.count,
      delta: last.delta,
      ts: Date.now(),
    });
  } catch (e) {}
}

exports.start = function (opts) {
  opts = opts || {};
  sendFn = opts.send || sendFn;
  var newInterval = opts.intervalMs != null ? opts.intervalMs : intervalMs;

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
    startCount = Bangle.getStepCount() || 0;
  } catch (e) {
    startCount = 0;
  }
  last = { count: startCount, delta: 0, ts: Date.now() };

  try {
    Bangle.on("step", stepHandler);
  } catch (e) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("step", stepHandler);
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

exports.resetDelta = function () {
  try {
    startCount = Bangle.getStepCount() || 0;
  } catch (e) {
    startCount = 0;
  }
  last.delta = 0;
};
