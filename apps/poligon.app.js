// poligon.app.js
var LOG = require("poligon_log.js");

try {
  var UI = require("poligon_ui.js");
  var QR = require("poligon_qr.js");
  var HOME = require("poligon_home.js");
  var GAME = require("poligon_game.js");
  var LOBBY = require("poligon_lobby.js");
  var MSG = require("poligon_msg.js");
  var MESSAGES = require("poligon_messages.js");
  var BLE = require("poligon_ble.js");
  var HR = require("poligon_hr.js");
  var ACCEL = require("poligon_accel.js");
  var MAG = require("poligon_mag.js");
  var BARO = require("poligon_baro.js");
  var STEP = require("poligon_step.js");
  var COMPASS = require("poligon_compass.js");

  // ── Tryb pracy ──
  // true  — przycisk objezdza wszystkie ekrany po kolei (wygodne przy pracy):
  //         qr -> home -> lobby -> game -> messages -> compass -> qr
  // false — produkcja. Ekrany qr/home/lobby zmienia WYLACZNIE telefon (nav)
  //         albo zdarzenia BLE; gracz nie ma jak z nich uciec przyciskiem.
  //         Przycisk zaczyna dzialac dopiero po starcie rozgrywki i chodzi
  //         tylko po petli: game -> messages -> compass -> game.
  var IS_DEV = false;

  var state = {
    screen: "qr", // "qr" | "home" | "lobby" | "game" | "messages" | "compass"
    gameStarted: false, // ustawiane przez telefon: nav->game albo dane gry
    mac: NRF.getAddress(),
    bleConnected: false,
    lastMsg: null,

    game: { ammo: null, hp: null },
    lobby: {
      teamColor: null,
      teamName: null,
      totalPlayers: null,
      starting: false,
      countdown: null,
    },

    hrUiTimer: null,
    lcdHandlerInstalled: false,
    msgActive: false,
  };

  var _msgTouchHandler = null;

  function safeCallDraw(mod, args, tag) {
    try {
      if (mod && typeof mod.draw === "function") mod.draw(args);
    } catch (e) {
      try {
        LOG.logError("draw_" + (tag || "unknown"), e);
      } catch (e2) {}
      g.clear(1);
      g.setFont("6x8", 2);
      g.setFontAlign(0, 0);
      g.drawString("DRAW ERROR", g.getWidth() / 2, 30);
      g.setFont("6x8", 1);
      g.drawString(String(e), g.getWidth() / 2, 70);
    }
  }

  function draw() {
    if (state.screen === "qr") {
      safeCallDraw(QR, { mac: state.mac, connected: state.bleConnected }, "qr");
      return;
    }

    if (state.screen === "home") {
      safeCallDraw(
        HOME,
        {
          mac: state.mac,
          connected: state.bleConnected,
          lastMsg: state.lastMsg,
        },
        "home",
      );
      return;
    }

    if (state.screen === "lobby") {
      safeCallDraw(
        LOBBY,
        {
          teamColor: state.lobby.teamColor,
          teamName: state.lobby.teamName,
          totalPlayers: state.lobby.totalPlayers,
          starting: !!state.lobby.starting,
          countdown: state.lobby.countdown,
        },
        "lobby",
      );
      return;
    }

    if (state.screen === "game") {
      safeCallDraw(
        GAME,
        {
          mac: state.mac,
          connected: state.bleConnected,
          lastMsg: state.lastMsg,
          hr: HR.getLast(),
          step: STEP.getLast(),
          ammo: state.game.ammo,
          hp: state.game.hp,
        },
        "game",
      );
      return;
    }

    if (state.screen === "messages") {
      safeCallDraw(MESSAGES, null, "messages");
      return;
    }

    if (state.screen === "compass") {
      try {
        COMPASS.start();
      } catch (e) {} // idempotent — redraws if already running
      return;
    }
  }

  // ── Master sensor timer ──
  // Single timer polls all active sensors and sends ONE batched BLE message
  // per tick. This eliminates contention when multiple NRF.updateServices
  // calls compete for SoftDevice HVN buffers.
  var sensorCfg = {};
  var masterTimer = null;
  var MASTER_TICK_MS = 100;

  // Round to N decimal places — reduces JSON size dramatically
  // (BMA421 accel = 12-bit ≈ 0.001g, so 3dp captures full HW resolution)
  function r3(v) {
    return Math.round(v * 1000) / 1000;
  }
  function r1(v) {
    return Math.round(v * 10) / 10;
  }

  function masterSensorTick() {
    if (!state.bleConnected) return;
    try {
      if (BLE.isReady && !BLE.isReady()) return;
    } catch (e) {}

    var now = Math.round(Date.now());
    var msg = { t: "s", ts: now };
    var has = false;

    for (var name in sensorCfg) {
      var cfg = sensorCfg[name];
      cfg.ct += MASTER_TICK_MS;
      if (cfg.ct < cfg.ms) continue;
      cfg.ct = 0;

      var d;
      if (name === "accel") d = ACCEL.getLast();
      else if (name === "mag") d = MAG.getLast();
      else if (name === "hr") d = HR.getLast();
      else if (name === "baro") d = BARO.getLast();
      else if (name === "step") d = STEP.getLast();
      else continue;

      if (!d || !d.ts) continue;

      if (name === "accel") {
        msg.a = {
          x: r3(d.x),
          y: r3(d.y),
          z: r3(d.z),
          d: r3(d.diff),
          m: r3(d.mag),
        };
        has = true;
      } else if (name === "hr") {
        if (d.bpm > 0 && d.confidence >= (cfg.minConf || 60)) {
          msg.h = { b: d.bpm, c: d.confidence };
          has = true;
        }
      } else if (name === "mag") {
        msg.g = {
          x: r1(d.x),
          y: r1(d.y),
          z: r1(d.z),
          dx: r1(d.dx),
          dy: r1(d.dy),
          dz: r1(d.dz),
          h: r1(d.heading),
        };
        has = true;
      } else if (name === "baro") {
        msg.b = { tp: r1(d.temp), p: r1(d.pressure), a: r1(d.altitude) };
        has = true;
      } else if (name === "step") {
        msg.st = { c: d.count, d: d.delta };
        has = true;
      }
    }

    if (has) {
      try {
        BLE.send(msg);
      } catch (e2) {}
    }
  }

  function startMasterTimer() {
    if (masterTimer) return;
    masterTimer = setInterval(masterSensorTick, MASTER_TICK_MS);
  }

  function stopMasterTimer() {
    if (!masterTimer) return;
    clearInterval(masterTimer);
    masterTimer = null;
  }

  function stopAllSensors() {
    HR.stop();
    ACCEL.stop();
    MAG.stop();
    BARO.stop();
    STEP.stop();
    try {
      COMPASS.stop();
    } catch (e) {}
    sensorCfg = {};
    autoSensors = false; // czujniki zgaszone wyzej — pozwol je znow wystartowac
    stopMasterTimer();
    stopHrUiTimer();
  }

  function stopHrUiTimer() {
    if (state.hrUiTimer) {
      clearInterval(state.hrUiTimer);
      state.hrUiTimer = null;
    }
  }

  // ── Sensory ekranu gry ──
  // HUD gry pokazuje tetno i kroki, ale do tej pory NIC ich nie wlaczalo —
  // czujniki startowaly wylacznie na komende "sensor" z telefonu. Po wejsciu
  // z lobby na ekran gry HUD pokazywal wiec zera.
  //
  // Startujemy je tu tylko do WYSWIETLANIA: HR.start()/STEP.start() bez opcji
  // "send" nie tworzy timera wysylkowego (patrz poligon_hr.js), wiec przez BLE
  // nadal leci tylko to, o co poprosil telefon przez sensorCfg.
  var autoSensors = false;

  function startGameSensors() {
    if (autoSensors) return;
    autoSensors = true;
    if (!sensorCfg.hr) {
      try {
        HR.start({ appId: "poligon" });
      } catch (e) {}
    }
    if (!sensorCfg.step) {
      try {
        STEP.start({ appId: "poligon" });
      } catch (e) {}
    }
  }

  function stopGameSensors() {
    if (!autoSensors) return;
    autoSensors = false;
    // nie gasimy czujnika, ktory zamowil telefon — on decyduje o swoim strumieniu
    if (!sensorCfg.hr) {
      try {
        HR.stop();
      } catch (e) {}
    }
    if (!sensorCfg.step) {
      try {
        STEP.stop();
      } catch (e) {}
    }
  }

  function startHrUiTimer() {
    stopHrUiTimer();
    // 1 Hz partial HR + step redraw (only top bar, not full screen)
    state.hrUiTimer = setInterval(function () {
      if (state.screen !== "game") return;
      if (state.msgActive) return;
      try {
        GAME.drawHr(HR.getLast());
      } catch (e) {}
      try {
        GAME.drawStep(STEP.getLast());
      } catch (e) {}
    }, 1000);
  }

  function dismissMsg() {
    if (!state.msgActive) return;
    if (_msgTouchHandler) {
      try {
        Bangle.removeListener("touch", _msgTouchHandler);
      } catch (e) {}
      _msgTouchHandler = null;
    }
    state.msgActive = false;
    MSG.stop();
    go(state.screen); // reinstalls kiosk UI and redraws current screen
  }

  function showMsg(opts) {
    // Cleanup previous message handlers (without redrawing)
    if (_msgTouchHandler) {
      try {
        Bangle.removeListener("touch", _msgTouchHandler);
      } catch (e) {}
      _msgTouchHandler = null;
    }
    MSG.stop();
    state.msgActive = true;

    // Optional buzz on show
    if (opts.buzz) {
      try {
        Bangle.buzz(400, 1);
      } catch (e) {}
    }

    // BTN1 dismisses the message
    UI.setKioskUI(function () {
      dismissMsg();
    });

    // Touch dismisses the message
    _msgTouchHandler = function () {
      dismissMsg();
    };
    Bangle.on("touch", _msgTouchHandler);

    MSG.show(opts, function () {
      // Timeout fired — clean up touch handler and redraw
      if (_msgTouchHandler) {
        try {
          Bangle.removeListener("touch", _msgTouchHandler);
        } catch (e) {}
        _msgTouchHandler = null;
      }
      state.msgActive = false;
      go(state.screen);
    });
  }

  // Przycisk poza trybem dev nie rusza ekranow qr/home/lobby — tam nawigacja
  // nalezy do telefonu. Zwraca handler gotowy dla UI.setKioskUI.
  function devOnlyBtn(target) {
    return function () {
      if (IS_DEV) go(target);
    };
  }

  function stopLobbyIfNeeded(nextScreen) {
    if (state.screen === "lobby" && nextScreen !== "lobby") {
      try {
        if (LOBBY && LOBBY.stop) LOBBY.stop();
      } catch (e) {}
      state.lobby.starting = null; // <— ważne: null, nie false
    }
  }

  function go(screen) {
    if (
      screen !== "qr" &&
      screen !== "home" &&
      screen !== "lobby" &&
      screen !== "game" &&
      screen !== "messages" &&
      screen !== "compass"
    )
      return;

    stopLobbyIfNeeded(screen);
    if (state.screen === "home" && screen !== "home") {
      try {
        if (HOME && HOME.stop) HOME.stop();
      } catch (e) {}
    }
    if (state.screen === "compass" && screen !== "compass") {
      try {
        COMPASS.stop();
      } catch (e) {}
    }
    if (state.screen === "game" && screen !== "game") {
      stopGameSensors();
      stopHrUiTimer();
    }
    state.screen = screen;

    if (screen === "qr") {
      // poza dev: dopiero polaczenie BLE przenosi na home (onConnect)
      UI.setKioskUI(devOnlyBtn("home"));
    } else if (screen === "home") {
      UI.setKioskUI(devOnlyBtn("lobby"), function () {
        // druga linia obrony dla timera zegara: odpala sie takze wtedy,
        // gdy uzytkownik wyjdzie z apki do launchera, a go() nie zdazy
        if (HOME && HOME.stop) HOME.stop();
      });
    } else if (screen === "lobby") {
      UI.setKioskUI(devOnlyBtn("game"));
    } else if (screen === "game") {
      UI.setKioskUI(function () {
        // poza dev przycisk otwiera petle rozgrywki dopiero po jej starcie
        if (IS_DEV || state.gameStarted) go("messages");
      });
      startGameSensors();
      startHrUiTimer();
    } else if (screen === "messages") {
      Bangle.setUI({
        mode: "custom",
        btn: function () {
          go("compass");
        },
        swipe: function (_lr, ud) {
          if (ud < 0) MESSAGES.scrollUp(); // swipe up = older
          if (ud > 0) MESSAGES.scrollDown(); // swipe down = newer
        },
      });
    } else if (screen === "compass") {
      UI.setKioskUI(function () {
        // dev domyka pelna petle na qr, produkcja wraca do rozgrywki
        go(IS_DEV ? "qr" : "game");
      });
    } else {
      UI.setKioskUI(function () {
        go("qr");
      });
    }
    draw();
  }

  function applyGameMsg(msg) {
    if (!msg) return;
    // dane rozgrywki = rozgrywka trwa (odblokowuje przycisk poza trybem dev)
    state.gameStarted = true;
    if (msg.ammo != null) state.game.ammo = msg.ammo;
    if (msg.hp != null) state.game.hp = msg.hp;
    if (state.screen === "game") draw();
  }

  function applyLobbyMsg(msg) {
    if (!msg) return;

    if (msg.teamColor != null) state.lobby.teamColor = msg.teamColor;
    if (msg.teamName != null) state.lobby.teamName = msg.teamName;
    if (msg.totalPlayers != null) state.lobby.totalPlayers = msg.totalPlayers;
    if (msg.countdown != null) state.lobby.countdown = msg.countdown;

    // starting: true => countdown start
    // starting: false => reset countdown (w module), i ma sie dac odpalic ponownie
    if (msg.starting != null) state.lobby.starting = !!msg.starting;

    if (state.screen === "lobby") draw();
  }

  function handleNavMsg(msg) {
    if (!msg || msg.type !== "nav") return false;
    var s = msg.screen;
    if (
      s === "qr" ||
      s === "home" ||
      s === "lobby" ||
      s === "game" ||
      s === "messages" ||
      s === "compass"
    ) {
      // Telefon jest zrodlem prawdy o stanie rozgrywki: nav na "game" ja
      // otwiera, powrot na qr/home/lobby ja zamyka. Bez tego przycisk
      // zostalby odblokowany po zakonczonej grze.
      if (s === "game") state.gameStarted = true;
      else if (s === "qr" || s === "home" || s === "lobby")
        state.gameStarted = false;
      go(s);
      return true;
    }
    return false;
  }

  function handleChat(msg) {
    if (!msg || msg.type !== "chat") return false;
    try {
      MESSAGES.addMessage(msg);
      if (state.screen === "messages") {
        // already on messages screen — redraw (addMessage scrolled to bottom)
        draw();
      } else if (!state.msgActive) {
        // show brief overlay notification
        showMsg({
          title: msg.sender != null ? String(msg.sender) : "Wiadomość",
          message: msg.message != null ? String(msg.message) : "",
          timeout: 4000,
          buzz: true,
        });
      }
      try {
        BLE.send({ t: "ack", got: "chat", ts: Date.now() });
      } catch (e1) {}
    } catch (e2) {
      try {
        BLE.send({ t: "err", where: "chat", msg: String(e2), ts: Date.now() });
      } catch (e3) {}
    }
    return true;
  }

  // { t: "dev", on: true|false } — przelacza tryb nawigacji przyciskiem
  // bez ponownego uploadu. Pominiete "on" tylko odpytuje o stan.
  function handleDevMsg(msg) {
    if (!msg || msg.type !== "dev") return false;

    if (msg.on != null) {
      IS_DEV = !!msg.on;
      // przeinstaluj UI biezacego ekranu, zeby przycisk zmienil zachowanie
      // natychmiast, a nie dopiero po nastepnej zmianie ekranu
      go(state.screen);
    }

    try {
      BLE.send({
        t: "ack",
        got: "dev",
        dev: IS_DEV,
        screen: state.screen,
        gameStarted: !!state.gameStarted,
        ts: Date.now(),
      });
    } catch (e) {}
    return true;
  }

  function handleSystemControl(msg) {
    if (!msg || !msg.type) return false;

    // 0) MTU — phone tells us negotiated MTU so we can use larger chunks
    if (msg.type === "mtu") {
      var m = Number(msg.mtu);
      if (m >= 23) {
        BLE.setChunkSize(m - 3);
      }
      try {
        BLE.send({
          t: "ack",
          got: "mtu",
          chunk: BLE.getChunkSize(),
          ts: Date.now(),
        });
      } catch (e0) {}
      return true;
    }

    // 1) SET BRIGHTNESS 0..1
    if (msg.type === "setBrightness") {
      try {
        var v = msg.value != null ? Number(msg.value) : NaN;
        if (isNaN(v)) throw new Error("value is NaN");
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        Bangle.setLCDBrightness(v);
        try {
          BLE.send({ t: "ack", got: "setBrightness", ts: Date.now() });
        } catch (e1) {}
      } catch (e2) {
        try {
          BLE.send({
            t: "err",
            where: "setBrightness",
            msg: String(e2),
            ts: Date.now(),
          });
        } catch (e3) {}
      }
      return true;
    }

    // 2) SET BACKLIGHT on/off
    if (msg.type === "setBacklight") {
      try {
        Bangle.setBacklight(!!msg.on);
        try {
          BLE.send({ t: "ack", got: "setBacklight", ts: Date.now() });
        } catch (e4) {}
      } catch (e5) {
        try {
          BLE.send({
            t: "err",
            where: "setBacklight",
            msg: String(e5),
            ts: Date.now(),
          });
        } catch (e6) {}
      }
      return true;
    }

    // 3) LOCK/UNLOCK
    if (msg.type === "setLocked") {
      try {
        Bangle.setLocked(!!msg.locked);
        try {
          BLE.send({ t: "ack", got: "setLocked", ts: Date.now() });
        } catch (e7) {}
      } catch (e8) {
        try {
          BLE.send({
            t: "err",
            where: "setLocked",
            msg: String(e8),
            ts: Date.now(),
          });
        } catch (e9) {}
      }
      return true;
    }

    // 4) GET FLAGS
    if (msg.type === "getFlags") {
      var reqId = msg.reqId != null ? msg.reqId : null;
      try {
        var flags = {
          backlightOn: !!Bangle.isBacklightOn(),
          barometerOn: !!Bangle.isBarometerOn(),
          charging: !!Bangle.isCharging(),
          compassOn: !!Bangle.isCompassOn(),
          gpsOn: !!Bangle.isGPSOn(),
          hrmOn: !!Bangle.isHRMOn(),
          lcdOn: !!Bangle.isLCDOn(),
          locked: !!Bangle.isLocked(),
          dev: IS_DEV, // tryb nawigacji przyciskiem — telefon synchronizuje UI
        };
        BLE.send({ t: "flags", reqId: reqId, ts: Date.now(), flags: flags });
      } catch (e10) {
        try {
          BLE.send({
            t: "err",
            where: "getFlags",
            reqId: reqId,
            msg: String(e10),
            ts: Date.now(),
          });
        } catch (e11) {}
      }
      return true;
    }

    return false;
  }

  function handleShow(msg) {
    if (!msg || msg.type !== "message") return false;
    try {
      showMsg({
        title: msg.title != null ? String(msg.title) : null,
        message: msg.message != null ? String(msg.message) : "",
        timeout: msg.timeout != null ? Number(msg.timeout) : 4000,
        img: msg.img != null ? msg.img : null,
        buzz: !!msg.buzz,
      });
      try {
        BLE.send({ t: "ack", got: "message", ts: Date.now() });
      } catch (e4) {}
    } catch (e5) {
      try {
        BLE.send({
          t: "err",
          where: "message",
          msg: String(e5),
          ts: Date.now(),
        });
      } catch (e6) {}
    }
    return true;
  }

  function handleAlert(msg) {
    if (!msg || msg.type !== "alert") return false;
    try {
      var message = msg.message != null ? String(msg.message) : "";
      var title = msg.title != null ? String(msg.title) : undefined;

      var p =
        title !== undefined
          ? E.showAlert(message, title)
          : E.showAlert(message);
      p.then(function () {
        try {
          BLE.send({ t: "ack", got: "alert_ok", ts: Date.now() });
        } catch (e1) {}
        // reinstall proper UI + redraw via go()
        go(state.screen);
      });
    } catch (e3) {
      try {
        BLE.send({ t: "err", where: "alert", msg: String(e3), ts: Date.now() });
      } catch (e4) {}
    }
    return true;
  }

  function handleBuzz(msg) {
    if (!msg || msg.type !== "buzz") return false;
    var time = msg.time != null ? msg.time : 200;
    var strength = msg.strength != null ? msg.strength : 1;

    try {
      Bangle.buzz(time, strength)
        .then(function () {
          try {
            BLE.send({ t: "ack", got: "buzz", ts: Date.now() });
          } catch (e0) {}
        })
        .catch(function (e) {
          try {
            BLE.send({
              t: "err",
              where: "buzz",
              msg: String(e),
              ts: Date.now(),
            });
          } catch (e1) {}
        });
    } catch (e2) {
      try {
        BLE.send({ t: "err", where: "buzz", msg: String(e2), ts: Date.now() });
      } catch (e3) {}
    }
    return true;
  }

  function handleSensorControl(msg) {
    if (!msg || msg.type !== "sensor") return false;
    var s = msg.sensor;
    var en = !!msg.enable;

    if (
      s !== "accel" &&
      s !== "mag" &&
      s !== "hr" &&
      s !== "baro" &&
      s !== "step"
    )
      return false;

    if (en) {
      // Defaults per sensor
      var defMs = 100;
      if (s === "mag") defMs = 1000;
      else if (s === "hr") defMs = 1000;
      else if (s === "baro") defMs = 5000;
      else if (s === "step") defMs = 2000;

      var intMs = msg.intervalMs != null ? msg.intervalMs : defMs;
      var minConf = 60;
      if (s === "hr" && msg.minConfidence != null) minConf = msg.minConfidence;

      // Start hardware collection only (no send function — master timer sends)
      var startOpts = { appId: "poligon" };
      if (s === "accel") ACCEL.start(startOpts);
      else if (s === "mag") MAG.start(startOpts);
      else if (s === "hr") {
        startOpts.minConfidence = minConf;
        HR.start(startOpts);
      } else if (s === "baro") BARO.start(startOpts);
      else if (s === "step") STEP.start(startOpts);

      // Register in master timer config
      sensorCfg[s] = { ms: intMs, ct: 0, minConf: minConf };
      startMasterTimer();

      // HR UI on watch game screen
      if (s === "hr" && state.screen === "game") startHrUiTimer();
    } else {
      if (s === "accel") ACCEL.stop();
      else if (s === "mag") MAG.stop();
      else if (s === "hr") {
        HR.stop();
        stopHrUiTimer();
      } else if (s === "baro") BARO.stop();
      else if (s === "step") STEP.stop();

      delete sensorCfg[s];

      // Telefon wylaczyl swoj strumien, ale ekran gry nadal potrzebuje tetna
      // i krokow do wyswietlania — podnosimy je z powrotem w trybie "tylko HUD".
      if (state.screen === "game" && (s === "hr" || s === "step")) {
        autoSensors = false;
        startGameSensors();
        startHrUiTimer();
      }

      // Stop master timer if no sensors active
      var any = false;
      for (var k in sensorCfg) {
        any = true;
        break;
      }
      if (!any) stopMasterTimer();
    }

    try {
      var ack = {
        t: "ack",
        got: "sensor",
        sensor: s,
        enabled: en,
        ts: Date.now(),
      };
      if (en && msg.intervalMs != null) ack.intervalMs = msg.intervalMs;
      BLE.send(ack);
    } catch (e3) {}
    return true;
  }

  function init() {
    UI.keepScreenOnForDev();

    // GPS jest wylaczony z aplikacji (brak ekranu i obslugi sensora), ale
    // zasilanie modulu potrafi przetrwac przeladowanie apki — gasimy je
    // jawnie, zeby nie zjadalo baterii w tle.
    try {
      Bangle.setGPSPower(0, "poligon");
    } catch (e) {}

    if (!state.lcdHandlerInstalled) {
      state.lcdHandlerInstalled = true;
      Bangle.on("lcdPower", function (on) {
        if (on) draw();
      });
    }

    go("qr");

    BLE.init({
      onReady: function () {},

      onConnect: function (id) {
        state.bleConnected = true;
        go("home");
        try {
          UI.showToast("CONNECTED.", 1500);
        } catch (e) {}
      },

      onDisconnect: function (id) {
        state.bleConnected = false;
        stopAllSensors();
        try {
          if (LOBBY && LOBBY.stop) LOBBY.stop();
        } catch (e) {}
        state.lobby.starting = false;
        state.gameStarted = false;
        go("qr");
        try {
          UI.showToast("DISCONNECTED", 2000);
        } catch (e) {}
      },

      onMessage: function (msg) {
        state.lastMsg = msg;

        // normalize: accept both "t" and "type" as message type key
        if (msg && msg.t && !msg.type) msg.type = msg.t;

        // handlers: buzz/show/alert/system
        if (handleBuzz(msg)) return;
        if (handleShow(msg)) return;
        if (handleAlert(msg)) return;
        if (handleChat(msg)) return;
        if (handleDevMsg(msg)) return;
        if (handleSystemControl(msg)) return;
        if (handleSensorControl(msg)) return;

        // NAV ma priorytet
        if (handleNavMsg(msg)) {
          try {
            BLE.send({ t: "ack", got: "nav", ts: Date.now() });
          } catch (e0) {}
          return;
        }

        // LOBBY update
        if (msg && msg.type === "lobby") {
          applyLobbyMsg(msg);
          try {
            BLE.send({ t: "ack", got: "lobby", ts: Date.now() });
          } catch (e1) {}
          return;
        }

        // GAME update
        if (msg && msg.type === "game") {
          applyGameMsg(msg);
          try {
            BLE.send({ t: "ack", got: "game", ts: Date.now() });
          } catch (e2) {}
          return;
        }

        // fallback redraw + ack
        draw();
        try {
          BLE.send({
            t: "ack",
            got: msg && (msg.t || msg.type) ? msg.t || msg.type : "msg",
            ts: Date.now(),
          });
        } catch (e3) {}
      },

      onError: function (stage, err) {
        try {
          LOG.logError("ble_" + stage, err);
        } catch (e4) {}
      },
    });
  }

  init();
} catch (e) {
  try {
    LOG.logError("app_boot", e);
  } catch (e2) {}
  g.clear(1);
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString("POLIGON ERROR", g.getWidth() / 2, 30);
  g.setFont("6x8", 1);
  g.drawString(String(e), g.getWidth() / 2, 70);
}
