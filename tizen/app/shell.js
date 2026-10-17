/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 for old TV engines: catch clauses need a binding */
/*
 * Brightframe TV shell (Samsung Tizen hosted app). Runs from the app package, then hands over to the site.
 *   1. Registers the remote keys the site uses (number keys for PINs and pairing codes, media keys).
 *   2. Checks the staging site answers (GET /api/tv/ping), and that the TV's clock is roughly right.
 *   3. Opens the site as the top-level page (first-party cookies keep the screen paired).
 * If the site can't be reached, it shows what went wrong, retries every 15 s, OK retries now, Return exits.
 * Written for old engines (no modules, no arrow functions): it must run even where the site might not.
 */
(function () {
  "use strict";
  var cfg = window.BF_SHELL || {};
  var SITE = String(cfg.site || "").replace(/\/+$/, "");
  var VERSION = cfg.version || "dev";
  var $ = function (id) { return document.getElementById(id); };
  var retryTimer = null, attempts = 0, device = "unknown TV";

  // 1. Keys. Arrows, OK and Return are always delivered; Samsung TVs deliver these only once registered.
  var KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind"];
  var registered = [];
  try {
    if (window.tizen && tizen.tvinputdevice) {
      for (var i = 0; i < KEYS.length; i++) {
        try { tizen.tvinputdevice.registerKey(KEYS[i]); registered.push(KEYS[i]); } catch (e) { /* key not on this remote */ }
      }
    }
  } catch (e) { /* not a Tizen app (e.g. tested in a desktop browser) */ }
  try {
    if (window.tizen && tizen.systeminfo) {
      tizen.systeminfo.getPropertyValue("BUILD", function (b) { device = (b.model || "TV") + " · firmware " + (b.buildVersion || "?"); render(); }, function () {});
    }
  } catch (e) { /* optional */ }

  // Samsung's TV user agent has no "Chrome/": the engine shows as "... 108.0.5359.1/8.0 TV Safari/537.36".
  function engine() {
    var ua = navigator.userAgent, m = /Chrome\/([\d.]+)/.exec(ua) || /\) ([\d]+\.[\d.]+)\/[\d.]+ TV/.exec(ua), t = /Tizen ([\d.]+)/.exec(ua);
    return (m ? "Chromium " + m[1] : ua) + (t ? " · Tizen " + t[1] : "");
  }

  var state = { phase: "start", error: "", hint: "" };
  function render() {
    var msg = { start: "Starting Brightframe…", check: "Connecting to Brightframe…", go: "Opening Brightframe…", fail: "Can't reach Brightframe", config: "This app isn't set up" }[state.phase];
    $("msg").textContent = msg;
    $("hint").innerHTML = state.hint;
    var showDetail = state.phase === "fail" || state.phase === "config";
    $("detail").hidden = !showDetail;
    if (showDetail) {
      $("detail").textContent = [
        "What happened:  " + state.error,
        "Site:           " + (SITE || "(none)"),
        "Network:        " + (navigator.onLine === false ? "offline (TV reports no network)" : "TV reports a network connection"),
        "Attempts:       " + attempts + "  ·  next try in 15 s",
        "TV:             " + device,
        "Engine:         " + engine(),
        "Keys:           " + (registered.length ? registered.length + " registered" : "none registered (not running as a Tizen app?)"),
        "Shell:          " + VERSION + "  ·  " + new Date().toLocaleString(),
      ].join("\n");
    }
  }

  function fail(error, hint) {
    state = { phase: "fail", error: error, hint: (hint ? hint + "<br>" : "") + "Press <b>OK</b> to try again, or <b>Return</b> to close the app." };
    render();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(check, 15000);
  }

  // The bypass parameter, for a staging deployment behind Vercel Deployment Protection (see tizen/README.md).
  function withBypass(url) {
    if (!cfg.bypass) return url;
    return url + (url.indexOf("?") < 0 ? "?" : "&") + "x-vercel-protection-bypass=" + encodeURIComponent(cfg.bypass) + "&x-vercel-set-bypass-cookie=true";
  }

  // 2. Check the site.
  function check() {
    clearTimeout(retryTimer);
    // https://<host> only (http://localhost is for testing the shell on a computer).
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(SITE) && !/^http:\/\/localhost(:\d+)?$/.test(SITE)) { state = { phase: "config", error: "No staging site address in shell-config.js", hint: "Rebuild the app with tizen/build-and-install.ps1." }; render(); return; }
    attempts++;
    state = { phase: "check", error: "", hint: "" }; render();
    if (navigator.onLine === false) { fail("The TV has no network connection", "Check the TV's Wi-Fi or network cable. Brightframe will keep trying."); return; }
    var xhr = new XMLHttpRequest(), started = Date.now(), done = false;
    xhr.open("GET", withBypass(SITE + "/api/tv/ping?shell=" + encodeURIComponent(VERSION)), true);
    xhr.timeout = 12000;
    xhr.onload = function () {
      if (done) return; done = true;
      if (xhr.status === 401 || xhr.status === 403) { fail("The staging site refused the TV (HTTP " + xhr.status + ")", "The site is protected. Rebuild the app with the Vercel protection-bypass secret (tizen/README.md)."); return; }
      if (xhr.status !== 200) { fail("The site answered HTTP " + xhr.status, xhr.status === 404 ? "This deployment may be too old for the TV app, or the address is wrong." : ""); return; }
      var body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) { /* a login page instead of JSON */ }
      if (!body || !body.ok) { fail("The site didn't answer like Brightframe (maybe a sign-in page)", "If the staging site is protected, rebuild the app with the protection-bypass secret."); return; }
      var server = Date.parse(body.time) + (Date.now() - started) / 2, skew = Math.round((Date.now() - server) / 60000);
      if (Math.abs(skew) >= 3) {
        state = { phase: "go", error: "", hint: "Note for a grown-up: this TV's clock is about <b>" + Math.abs(skew) + " minutes " + (skew > 0 ? "fast" : "slow") + "</b>. Bedtime is still enforced on the server, but on-screen countdowns may look off. Set the TV's time to automatic." };
        render();
        setTimeout(go, 6000);
      } else go();
    };
    xhr.onerror = function () { if (done) return; done = true; fail("The site couldn't be reached (network error)", "Check the internet connection. If other apps work, the staging site may be down."); };
    xhr.ontimeout = function () { if (done) return; done = true; fail("The site didn't answer within 12 seconds"); };
    xhr.send();
  }

  // 3. Hand over to the site. replace(): Return on the site's first screen doesn't come back here.
  function go() {
    state = { phase: "go", error: "", hint: state.hint }; render();
    location.replace(withBypass(SITE + "/watch?shell=" + encodeURIComponent(VERSION)));
  }

  document.addEventListener("keydown", function (e) {
    if (state.phase !== "fail" && state.phase !== "config") return;
    if (e.keyCode === 13) { e.preventDefault(); check(); }
    if (e.keyCode === 10009) { // Return: close the app
      e.preventDefault();
      try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* not a Tizen app */ }
    }
  });
  window.addEventListener("online", function () { if (state.phase === "fail") check(); });
  window.onerror = function (m) { state = { phase: "fail", error: "Shell script error: " + m, hint: "" }; render(); };

  render();
  setTimeout(check, 50);
})();
