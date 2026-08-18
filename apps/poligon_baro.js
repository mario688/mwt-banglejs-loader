// poligon_baro.js
// Barometer / Temperature streaming helper for Poligon
// - BMP280 / SPL06 sensor (Bangle.js 2)
// - setBarometerPower(1) causes 'pressure' events to fire
// - start() enables barometer + adds listener + starts fixed-rate send timer
// - Timer-based sending guarantees stable Hz (decoupled from BLE queue)
// - Default 5000 ms = 0.2 Hz
//   Barometer draws ~50 uA — keep interval long to save battery

var enabled = false;
var last = { temp: 0, pressure: 0, altitude: 0, ts: 0 };

var sendFn = null;
var intervalMs = 5000; // 0.2 Hz default
var sendTimer = null;
var appId = "poligon";
var debug = false;

function pressureHandler(e) {
  last = {
    temp: e.temperature,
    pressure: e.pressure,
    altitude: e.altitude,
    ts: Date.now(),
  };
  if (debug) {
    print(
      "BARO temp=" +
        e.temperature +
        " pres=" +
        e.pressure +
        " alt=" +
        e.altitude,
    );
  }
}

function sendLatest() {
  if (!enabled || !sendFn || !last.ts) return;
  try {
    sendFn({
      t: "baro",
      temp: last.temp,
      pres: last.pressure,
      alt: last.altitude,
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
    Bangle.setBarometerPower(1, appId);
  } catch (e) {}
  try {
    Bangle.on("pressure", pressureHandler);
  } catch (e2) {}
  if (sendFn) sendTimer = setInterval(sendLatest, intervalMs);
};

exports.stop = function () {
  if (!enabled) return;
  enabled = false;
  try {
    Bangle.removeListener("pressure", pressureHandler);
  } catch (e) {}
  try {
    Bangle.setBarometerPower(0, appId);
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
