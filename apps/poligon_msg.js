// poligon_msg.js — Overlay message card for Bangle.js 2 (176×176)
//
// Usage:
//   MSG.show({ title: "HIT", message: "HP: 50\nAmmo: 30", timeout: 4000 }, onDismiss)
//   MSG.show({ message: "Game over" })          // no title, default 4 s
//   MSG.stop()                                   // cancel without onDismiss
//   MSG.isActive()                               // → bool
//
// Future: pass opts.img (image string/buffer) to show an icon above the text.

var _tmr = null;
var _dismissCb = null;

function _stop() {
  if (_tmr) { clearTimeout(_tmr); _tmr = null; }
  _dismissCb = null;
}

function _draw(opts) {
  var W = g.getWidth();   // 176
  var H = g.getHeight();  // 176
  var title   = opts.title   != null ? String(opts.title)   : null;
  var message = opts.message != null ? String(opts.message) : "";
  // var img  = opts.img || null; // future

  // ── Pre-calculate wrapped lines to size the card ─────────────
  var x0 = 8, x1 = W - 8;
  var cardInnerW = (x1 - x0) - 12;

  g.setFont("6x8", 2);
  var rawMsgLines = message.split("\n");
  var msgLines = [];
  for (var k = 0; k < rawMsgLines.length; k++) {
    var wr = g.wrapString(rawMsgLines[k], cardInnerW);
    for (var j = 0; j < wr.length; j++) msgLines.push(wr[j]);
  }

  var cardH = 28 + msgLines.length * 20 + 10; // top padding + lines + bottom
  if (title) cardH += 28;
  if (cardH > H - 16) cardH = H - 16; // max = screen minus margins
  var y0 = Math.round((H - cardH) / 2);
  var y1 = y0 + cardH;

  // Background
  g.setColor(0, 0, 0);
  g.fillRect(x0 + 1, y0 + 1, x1 - 1, y1 - 1);

  // Amber border (double line for visibility on dark bg)
  g.setColor(1, 0.8, 0);
  g.drawRect(x0, y0, x1, y1);
  g.drawRect(x0 + 1, y0 + 1, x1 - 1, y1 - 1);

  var cy = y0 + 14;

  // ── Title ─────────────────────────────────────────────────────
  if (title) {
    g.setColor(1, 0.8, 0);
    g.setFont("6x8", 2);
    g.setFontAlign(0, 0);
    g.drawString(title.toUpperCase(), W / 2, cy);
    cy += 18;
    g.setColor(0.35, 0.35, 0.35);
    g.drawLine(x0 + 6, cy, x1 - 6, cy);
    cy += 10;
  }

  // ── Optional image (future) ───────────────────────────────────
  // if (img) {
  //   g.drawImage(img, W / 2 - 12, cy);
  //   cy += 28;
  // }

  // ── Message lines (pre-wrapped above) ─────────────────────────
  g.setColor(1, 1, 1);
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  var maxVisLines = Math.floor((y1 - cy - 4) / 20);
  for (var i = 0; i < Math.min(msgLines.length, maxVisLines); i++) {
    g.drawString(msgLines[i], W / 2, cy);
    cy += 20;
  }

  Bangle.setLCDPower(1);
}

/**
 * Show an overlay message card.
 * @param {object}   opts       { title, message, timeout (ms, default 4000), img (future) }
 * @param {function} onDismiss  called when the card hides (timeout fires); NOT called by stop()
 */
exports.show = function (opts, onDismiss) {
  opts = opts || {};
  // Cancel any previous message without calling its onDismiss
  _stop();
  _dismissCb = onDismiss || null;

  _draw(opts);

  var ms = (opts.timeout != null && opts.timeout > 0) ? Number(opts.timeout) : 4000;
  _tmr = setTimeout(function () {
    _tmr = null;
    var cb = _dismissCb;
    _dismissCb = null; // guard against double-call
    if (cb) cb();
  }, ms);
};

/** Cancel the current message immediately (onDismiss is NOT invoked). */
exports.stop = _stop;

/** Returns true while a message is being displayed. */
exports.isActive = function () { return _tmr !== null; };
