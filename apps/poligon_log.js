// poligon_log.js
var Storage = require("Storage");

var FILE = "poligon_errors.json";
var MAX = 60;               // ile wpisów trzymaÄ‡
var lastWrite = 0;
var MIN_GAP_MS = 800;       // rate limit (ochrona flash)

function toMsg(e) {
  if (e && e.message) return String(e.message);
  return String(e);
}
function toStack(e) {
  if (e && e.stack) return String(e.stack);
  return "";
}

function readList() {
  return Storage.readJSON(FILE, 1) || [];
}

function writeList(list) {
  Storage.writeJSON(FILE, list);
}

function logError(where, e, extra) {
  try {
    var now = Date.now();
    // rate limit
    if ((now - lastWrite) < MIN_GAP_MS) return;
    lastWrite = now;

    var list = readList();
    list.push({
      ts: now,
      where: String(where || "?"),
      msg: toMsg(e),
      stack: toStack(e),
      extra: extra || undefined
    });
    if (list.length > MAX) list = list.slice(list.length - MAX);
    writeList(list);

    // w razie czego teÅ¼ do konsoli
    console.log("[poligon][ERR]", where, toMsg(e));
  } catch (err2) {
    // jak nawet logger padnie, to nie chcemy rekurencji
    console.log("[poligon][ERR] logger failed", err2);
  }
}

// helper do czyszczenia logów
function clear() {
  try { Storage.erase(FILE); } catch (e) {}
}

exports.logError = logError;
exports.clear = clear;
exports.file = FILE;
