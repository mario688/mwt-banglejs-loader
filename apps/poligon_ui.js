/* poligon_ui.js
 * Minimal UI helpers (BW, clear, basic button handler)
 */

exports.forceBW = function () {
  // Nie invertuj, QR i czytelność na tym zyskują
  g.setColor("#000");
  g.setBgColor("#fff");
};

exports.clearScreen = function (reset) {
  // reset==true: reset state grafiki + clear
  if (reset) g.clear(1);
  else g.clear();
};

exports.keepScreenOnForDev = function () {
  // dev-friendly: nie gaś ekranu
  try { Bangle.setLCDPower(1); } catch (e) {}
  try { Bangle.setLCDTimeout(0); } catch (e) {}
  try { Bangle.setLocked(0); } catch (e) {}
};

exports.setKioskUI = function (onBtn, onRemove) {
  // Proste sterowanie przyciskiem/tapem
  // Bangle.js2: dotyk + 1 przycisk, Bangle.js1: przyciski
  //
  // onRemove trafia do Bangle.setUI jako "remove" — Espruino wola go, gdy ten
  // UI jest zdejmowany: przy przejsciu na inny ekran ORAZ przy wyjsciu z apki
  // do launchera. To drugie jest wazne, bo go() wtedy nie leci i timery
  // ekranu zylyby dalej, domalowujac sie na cudzej aplikacji.
  Bangle.setUI({
    mode: "custom",
    btn: function () {
      if (onBtn) onBtn();
    },
    remove: function () {
      if (onRemove) {
        try { onRemove(); } catch (e) {}
      }
    }
  });
};

exports.resetUI = function () {
  // zdejmij custom ui
  try { Bangle.setUI(); } catch (e) {}
};

var toastTimer = null;

exports.showToast = function (msg, ms, onDone) {
  ms = ms || 2000;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  var W = g.getWidth();
  var H = g.getHeight();
  // dark bar at bottom
  g.setColor(0, 0, 0);
  g.fillRect(0, H - 28, W, H);
  g.setColor(1, 1, 1);
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString(msg, W / 2, H - 14);
  toastTimer = setTimeout(function () {
    toastTimer = null;
    if (onDone) onDone();
  }, ms);
};
