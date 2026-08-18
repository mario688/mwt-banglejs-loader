// poligon_hr.js
// HR streaming helper for Poligon
// - start() enables HRM + listens to Bangle 'HRM' events + starts fixed-rate send timer
// - Timer-based sending guarantees stable Hz (decoupled from BLE queue)
// - Default 1000 ms = 1 Hz
// - Only sends when bpm > 0 and confidence >= minConfidence

var enabled = false;
var last = { bpm: 0, confidence: 0, ts: 0 };
var onUpdate = null;

var sendFn = null;
var intervalMs = 1000;
var minConfidence = 60;
var sendTimer = null;
var appId = "poligon";

var lastPrintTs = 0;
var debug = false;

function hrmHandler(hrm) {
  var bpm = hrm && hrm.bpm ? hrm.bpm : 0;
  var conf = hrm && hrm.confidence ? hrm.confidence : 0;
  var now = Date.now();

  if (debug) {
    var dt = lastPrintTs ? now - lastPrintTs : 0;
    lastPrintTs = now;
    print("HRM bpm=" + bpm + " conf=" + conf + " dt=" + dt + "ms ts=" + now);
  }

  last = { bpm: bpm, confidence: conf, ts: now };
  if (onUpdate) {
    try {
      onUpdate(last);
    } catch (e) {}
  }
}

function sendLatest() {
  if (!enabled || !sendFn) return;
  if (!last.bpm || last.bpm <= 0) return;
  if (last.confidence < minConfidence) return;
  try {
    sendFn({ t: "hr", bpm: last.bpm, conf: last.confidence, ts: Date.now() });
  } catch (e) {}
}

exports.start = function (opts) {
  opts = opts || {};
  onUpdate = opts.onUpdate || null;
  sendFn = opts.send || sendFn;
  var newInterval = opts.intervalMs != null ? opts.intervalMs : intervalMs;
  minConfidence =
    opts.minConfidence != null ? opts.minConfidence : minConfidence;
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
    Bangle.setHRMPower(1, appId);
  } catch (e) {}
  try {
    Bangle.on("HRM", hrmHandler);
  } catch (e2) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("HRM", hrmHandler);
  } catch (e) {}
  try {
    Bangle.setHRMPower(0, appId);
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
