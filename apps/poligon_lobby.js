// poligon_lobby.js — ekran lobby na tle lobby_2.img
//
// Tlo ma dwie ramki HUD. Wspolrzedne ponizej to WNETRZE tych ramek,
// zmierzone bezposrednio na obrazku (nie na oko):
//
//   nazwa druzyny : obrys x 16-159, y 17-63  ->  wnetrze x 18-157, y 19-61
//   liczba graczy : obrys x 46-129, y 69-91  ->  wnetrze x 48-127, y 70-89
//
// Oba pola sa wysrodkowane wzgledem ekranu, wiec w poziomie uzywamy W/2.

var S = require("Storage");

var BG_FILE = "lobby.img";

// Storage.read() zwraca string mapowany w pamieci read-only — te ~60 KB
// nie zajmuja RAM-u. Czytamy raz przy ladowaniu modulu.
var bg = S.read(BG_FILE);

// wnetrza pol
var NAME_W = 140; // 18..157
var NAME_CY = 40; // (19+61)/2
var CNT_W = 80; // 48..127
var CNT_CY = 80; // (70+89)/2 zaokraglone

// Drabinki fontow — bierzemy pierwszy, ktory miesci sie w szerokosci pola.
// "12x20:2" to 24x40 px na znak, wiec przy 43 px wysokosci wnetrza wchodzi
// z zapasem, ale tylko dla krotkich nazw (5 znakow = 120 px).
var NAME_FONTS = ["12x20:2", "12x20", "6x15"];
var CNT_FONT = "12x20"; // 3 cyfry = 36 px w polu 80 px

var tmr;
var left = 10;
var wasStarting = false;

function stopTimer() {
  if (tmr) {
    clearInterval(tmr);
    tmr = undefined;
  }
}

function parseColor(str, fallback) {
  fallback = fallback || { r: 1, g: 0, b: 0 }; // czerwony fallback
  if (typeof str !== "string") return fallback;

  // usun znaki sterujace (np. \0, \r, \n) i spacje z koncow
  str = str.replace(/[\x00-\x1F\x7F]/g, "").trim();

  // #RGB / #RRGGBB
  if (str[0] === "#") {
    var hex = str.slice(1).trim();
    if (hex.length === 3) {
      var r3 = parseInt(hex[0] + hex[0], 16);
      var g3 = parseInt(hex[1] + hex[1], 16);
      var b3 = parseInt(hex[2] + hex[2], 16);
      if (!isNaN(r3) && !isNaN(g3) && !isNaN(b3))
        return { r: r3 / 255, g: g3 / 255, b: b3 / 255 };
    }
    if (hex.length === 6) {
      var r6 = parseInt(hex.slice(0, 2), 16);
      var g6 = parseInt(hex.slice(2, 4), 16);
      var b6 = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r6) && !isNaN(g6) && !isNaN(b6))
        return { r: r6 / 255, g: g6 / 255, b: b6 / 255 };
    }
    return fallback;
  }

  // rgb/rgba(...) bez regexa
  var lower = str.toLowerCase();
  if (lower.indexOf("rgb") === 0) {
    var p1 = str.indexOf("(");
    var p2 = str.lastIndexOf(")");
    if (p1 >= 0 && p2 > p1) {
      var inside = str.substring(p1 + 1, p2);
      var parts = inside.split(",");
      if (parts.length >= 3) {
        var r = Number(parts[0]);
        var g2 = Number(parts[1]);
        var b = Number(parts[2]);
        if (!isNaN(r) && !isNaN(g2) && !isNaN(b)) {
          return { r: r / 255, g: g2 / 255, b: b / 255 };
        }
      }
    }
  }

  return fallback;
}

// Ekran Bangle.js 2 ma 3 bity koloru — kazdy kanal jest albo zgaszony, albo
// pelny. Kolor druzyny spoza tej osemki zostalby zditherowany, czyli tekst
// rozsypalby sie w kropki. Dociagamy wiec do najblizszej z 8 barw.
function snapColor(c) {
  var r = c.r > 0.5 ? 1 : 0;
  var gg = c.g > 0.5 ? 1 : 0;
  var b = c.b > 0.5 ? 1 : 0;
  if (!r && !gg && !b) return { r: 1, g: 1, b: 1 }; // czarny bylby niewidoczny
  return { r: r, g: gg, b: b };
}

function pickTextColor(bg2) {
  var lum = 0.2126 * bg2.r + 0.7152 * bg2.g + 0.0722 * bg2.b;
  return lum > 0.6 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };
}

// Ustawia najwiekszy font z drabinki, ktory miesci napis w maxW, i przycina
// tekst, gdy nawet najmniejszy nie wystarcza. Zwraca tekst do narysowania.
function fitText(str, maxW, fonts) {
  var i;
  for (i = 0; i < fonts.length; i++) {
    g.setFont(fonts[i]);
    if (g.stringWidth(str) <= maxW) return str;
  }
  g.setFont(fonts[fonts.length - 1]);
  while (str.length > 1 && g.stringWidth(str) > maxW) {
    str = str.substr(0, str.length - 1);
  }
  return str;
}

function drawInfo(opts) {
  opts = opts || {};
  var W = g.getWidth();
  var H = g.getHeight();

  g.reset();
  if (bg) {
    g.drawImage(bg, 0, 0);
  } else {
    // brak pliku w Storage — dane maja byc widoczne mimo wszystko
    g.setBgColor(0, 0, 0);
    g.clearRect(0, 0, W - 1, H - 1);
  }

  var team = snapColor(parseColor(opts.teamColor, { r: 1, g: 0, b: 0 }));

  // nazwa druzyny w kolorze druzyny
  var name = opts.teamName != null ? String(opts.teamName) : "-";
  name = fitText(name, NAME_W, NAME_FONTS);
  g.setFontAlign(0, 0);
  g.setColor(team.r, team.g, team.b);
  g.drawString(name, W / 2, NAME_CY);

  // liczba graczy na bialo — kontrast wazniejszy niz kolor druzyny
  var cnt = String(opts.totalPlayers != null ? opts.totalPlayers : "-");
  cnt = fitText(cnt, CNT_W, [CNT_FONT]);
  g.setColor(1, 1, 1);
  g.drawString(cnt, W / 2, CNT_CY);

  Bangle.setLCDPower(1);
}

function drawCountdown(opts) {
  opts = opts || {};
  var W = g.getWidth();
  var H = g.getHeight();
  // odliczanie ma przykuc uwage, wiec zostaje pelnoekranowe, bez tla
  var team = snapColor(parseColor(opts.teamColor, { r: 1, g: 0, b: 0 }));
  var txt = pickTextColor(team);

  g.setColor(team.r, team.g, team.b);
  g.fillRect(0, 0, W, H);

  g.setColor(txt.r, txt.g, txt.b);
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString("STARTING IN", W / 2, 22);

  g.setFont("Vector", 84);
  g.drawString(String(left), W / 2, H / 2 + 10);

  Bangle.setLCDPower(1);
}

function startCountdown(opts) {
  stopTimer();
  left = opts.countdown != null && opts.countdown > 0 ? opts.countdown : 10;
  drawCountdown(opts);

  tmr = setInterval(function () {
    left--;
    if (left < 0) left = 0;
    drawCountdown(opts);
    Bangle.buzz();
    if (left === 0) stopTimer();
  }, 1000);
}

exports.draw = function (opts) {
  opts = opts || {};
  var starting =
    opts.starting === true ? true : opts.starting === false ? false : null;

  if (starting !== true) {
    stopTimer();
    wasStarting = false;
    drawInfo(opts);
    return;
  }

  if (!wasStarting) {
    wasStarting = true;
    startCountdown(opts);
    return;
  }

  drawCountdown(opts);
};

exports.stop = function () {
  stopTimer();
  wasStarting = false;
};
