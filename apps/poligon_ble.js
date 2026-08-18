/* poligon_ble.js
 * Custom BLE service:
 *   SVC = 12345678-...0000
 *   RX  = ...0001 (phone -> watch write)
 *   TX  = ...0002 (watch -> phone notify)
 *
 * Protocol: JSON Lines over RX/TX (each msg ends with '\n')
 *
 * MTU notes:
 * - Default ATT MTU = 23 bytes -> payload = 20 bytes
 * - Phone can request higher MTU (iOS ~185, Android up to 512)
 * - NRF.on('mtu', fn) fires with negotiated ATT MTU value (Espruino 2v28+)
 * - TX_CHUNK_SIZE is updated dynamically on MTU change
 * - NRF.setMTU() does NOT exist in Espruino — MTU is phone-initiated
 */

var SVC = "12345678-1234-5678-1234-56789abc0000";
var RX  = "12345678-1234-5678-1234-56789abc0001";
var TX  = "12345678-1234-5678-1234-56789abc0002";

var rxBuf = "";
var RX_BUF_MAX = 1024;
// Safe default: 20 bytes (ATT MTU 23 - 3 header).
// Updated dynamically via NRF.on('mtu', ...) when phone negotiates higher MTU.
var TX_CHUNK_SIZE = 20;
// Inter-chunk delay in ms. 5 ms is safe for nRF52 SoftDevice (6+ HVN TX buffers)
// and dramatically improves throughput vs the previous 20 ms.
var TX_CHUNK_DELAY = 5;

// Adjust chunk size when phone negotiates a higher MTU.
// ATT payload = negotiated MTU - 3 bytes (ATT opcode + handle).
NRF.on("mtu", function (mtu) {
  var payload = mtu - 3;
  if (payload < 20)  payload = 20;
  if (payload > 244) payload = 244; // nRF52 DLE max
  TX_CHUNK_SIZE = payload;
});
var connected = false;
var connId = null;

// restart/ready gate
var bleReady = false;
var readyTimer = null;

// optional small queue (1 message) while not ready
var pending = [];

var onMessage    = function (_obj) {};
var onConnect    = function (_id) {};
var onDisconnect = function (_id) {};
var onReady      = function () {};
var onError      = function (_stage, _err) {};

function setConnected(v, id) {
  connected = !!v;
  connId = (id !== undefined && id !== null) ? id : null;
}

function safeJsonParse(line) {
  try { return JSON.parse(line); } catch (e) { return null; }
}

function setReady(v) {
  bleReady = !!v;
  if (bleReady) {
    // flush pending (but keep it safe)
    while (pending.length) {
      var msg = pending.shift();
      _sendNow(msg);
    }
    try { onReady(); } catch (e) {}
  }
}

function scheduleReady() {
  // after NRF.setServices, Espruino often restarts BLE stack.
  // during that: NRF.updateServices throws.
  setReady(false);
  if (readyTimer) clearTimeout(readyTimer);
  // conservative delay; you can tune down later
  readyTimer = setTimeout(function () {
    readyTimer = null;
    setReady(true);
  }, 1200);
}

function initBle() {
  rxBuf = "";

  // build service object without computed keys in literals
  var svcObj = {};

  svcObj[RX] = {
    writable: true,
    readable: false,
    maxLen: 247,
    value: [0],
    onWrite: function (evt) {
      rxBuf += E.toString(evt.data);

      // guard: trim buffer if no newline and it grows too large
      if (rxBuf.length > RX_BUF_MAX && rxBuf.indexOf("\n") < 0) {
        try { onError("rxOverflow", new Error("rxBuf>" + RX_BUF_MAX)); } catch (e) {}
        rxBuf = "";
        return;
      }

      var i;
      while ((i = rxBuf.indexOf("\n")) >= 0) {
        var line = rxBuf.substr(0, i);
        rxBuf = rxBuf.substr(i + 1);
        if (!line) continue;

        var obj = safeJsonParse(line);
        if (obj) {
          try { onMessage(obj); } catch (e) {}
        }
      }
    }
  };

  svcObj[TX] = {
    readable: true,
    notify: true,
    maxLen: 247,
    value: [0]
  };

  var services = {};
  services[SVC] = svcObj;

  // IMPORTANT:
  // - uart:true so IDE still works (don't use uart:false yet)
  // - advertise:true makes Espruino include the service in advertising data
  //   (this matches your RAM test that works)
  try {
    NRF.setServices(services, { uart: true, advertise: true });
  } catch (e) {
    try { onError("setServices", e); } catch (e2) {}
  }

  // setServices triggers BLE restart window -> delay readiness
  scheduleReady();

  // Do NOT spam NRF.setAdvertising here unless needed.
  // If you want filters by service UUID on the phone,
  // you can enable this later once stable.
  // NRF.setAdvertising({}, { services: [SVC] });

  NRF.on("connect", function (id) {
    rxBuf = "";
    setConnected(true, id);
    try { onConnect(id); } catch (e) {}
  });

  NRF.on("disconnect", function (id) {
    rxBuf = "";
    txQueue = [];
    txBusy  = false;
    setConnected(false, null);
    try { onDisconnect(id); } catch (e) {}
  });
}

// Serialized TX queue — prevents interleaving of concurrent senders.
// Problem: accel (5 Hz), mag (1 Hz), ping (0.5 Hz) all call _sendNow
// independently. With multi-chunk messages, setTimeout(sendNext, 20)
// yields the event loop — another sender fires _notifyChunk mid-sequence,
// corrupting the stream on the phone side.
// Fix: only one chunk sequence runs at a time; others wait in txQueue.
var txQueue = [];
var txBusy  = false;

function _notifyChunk(str) {
  var v = E.toUint8Array(str);
  var updTx = {};
  updTx[TX] = { value: v, notify: true };
  var upd = {};
  upd[SVC] = updTx;
  try {
    NRF.updateServices(upd);
    return true;
  } catch (e) {
    return false;
  }
}

function _drainQueue() {
  if (txBusy || txQueue.length === 0) return;
  var s = txQueue.shift();
  txBusy = true;
  var idx = 0;
  var retries = 0;
  function sendNext() {
    if (idx >= s.length) {
      txBusy = false;
      // Drain next message immediately (synchronous) — no setTimeout gap.
      if (txQueue.length > 0) _drainQueue();
      return;
    }
    var chunk = s.substr(idx, TX_CHUNK_SIZE);
    if (_notifyChunk(chunk)) {
      idx += TX_CHUNK_SIZE;
      retries = 0;
      if (idx >= s.length) {
        // Last chunk sent — finish immediately, no inter-message delay.
        // With high MTU most messages are single-chunk, so this path
        // is the hot path and avoiding setTimeout here is critical.
        txBusy = false;
        if (txQueue.length > 0) _drainQueue();
      } else {
        // More chunks in this message — delay for SoftDevice buffer
        setTimeout(sendNext, TX_CHUNK_DELAY);
      }
    } else {
      // SoftDevice buffer full — retry with back-off
      retries++;
      if (retries > 3) {
        // give up on this message, unblock pipeline
        txBusy = false;
        if (txQueue.length > 0) _drainQueue();
        return;
      }
      setTimeout(sendNext, 50);
    }
  }
  sendNext();
}

function _sendNow(obj) {
  var s = JSON.stringify(obj) + "\n";
  // Deduplicate periodic sensor data: if same type is already queued,
  // replace the stale reading instead of piling up behind it.
  var t = obj.t;
  if (t === "s" || t === "accel" || t === "mag" || t === "baro" || t === "hr") {
    var marker = '"t":"' + t + '"';
    for (var i = 0; i < txQueue.length; i++) {
      if (txQueue[i].indexOf(marker) >= 0) {
        txQueue[i] = s;
        _drainQueue();
        return;
      }
    }
  }
  txQueue.push(s);
  // cap: drop oldest if queue grows too deep (e.g. phone slow to consume)
  if (txQueue.length > 8) txQueue.shift();
  _drainQueue();
}

function send(obj) {
  // If BLE stack is restarting, NRF.updateServices will throw.
  if (!bleReady) {
    // keep only last few messages (avoid RAM growth)
    pending.push(obj);
    if (pending.length > 5) pending.shift();
    return;
  }

  try {
    _sendNow(obj);
  } catch (e) {
    // _notifyChunk now catches internally, so this is truly unexpected.
    // Do NOT call scheduleReady() here — that 1200 ms blackout is only
    // meant for NRF.setServices() BLE stack restarts, not transient errors.
    try { onError("send", e); } catch (e2) {}
  }
}

exports.init = function (opts) {
  opts = opts || {};
  onMessage    = opts.onMessage    || onMessage;
  onConnect    = opts.onConnect    || onConnect;
  onDisconnect = opts.onDisconnect || onDisconnect;
  onReady      = opts.onReady      || onReady;
  onError      = opts.onError      || onError;

  initBle();
};

exports.send = send;

exports.isConnected = function () { return connected; };
exports.getConnId   = function () { return connId; };
exports.isReady     = function () { return bleReady; };

// Allow external MTU override (phone tells us via command)
exports.setChunkSize = function (n) {
  if (n < 20) n = 20;
  if (n > 244) n = 244;
  TX_CHUNK_SIZE = n;
};
exports.getChunkSize = function () { return TX_CHUNK_SIZE; };

exports.uuids = { SVC: SVC, RX: RX, TX: TX };
