/*
 * 18 Words — <script> embed loader.
 *
 * Usage:
 *   <div data-words18 data-lang="en"></div>
 *   <script src="https://YOUR_DOMAIN/embed.js"></script>
 *
 * Or, without a container, just drop the script tag where the game should
 * appear (it will insert a div right after itself, language read from
 * data-lang on the <script> tag itself, defaulting to "en"):
 *   <script src="https://YOUR_DOMAIN/embed.js" data-lang="ru"></script>
 *
 * Each matched container gets its own closed-off Shadow DOM tree, so the
 * game's markup, CSS and DOM ids never collide with the host page or with
 * other widgets on the same page.
 */
(function () {
  "use strict";

  var CURRENT_SCRIPT = document.currentScript;
  if (!CURRENT_SCRIPT || !CURRENT_SCRIPT.src) {
    console.error("18 Words embed: could not determine this script's own URL, aborting.");
    return;
  }

  var SCRIPT_URL = new URL(CURRENT_SCRIPT.src, document.baseURI);
  var BASE_DIR = new URL(".", SCRIPT_URL);
  var SUPPORTED_LANGS = ["en", "ru", "th"];

  var langAssetPromises = {};
  window.__words18LoadedScripts = window.__words18LoadedScripts || {};

  function fetchText(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("18 Words embed: failed to fetch " + url + " (" + res.status + ")");
      return res.text();
    });
  }

  function loadScriptOnce(url) {
    var cache = window.__words18LoadedScripts;
    if (cache[url]) return cache[url];
    cache[url] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("18 Words embed: failed to load script " + url)); };
      document.head.appendChild(s);
    });
    return cache[url];
  }

  // Fetches (once per language) style.css, words.js and script.js, and
  // resolves with the language folder's own URL so callers can build
  // same-origin fetch() paths for days/*.json from inside the widget.
  function ensureLangAssets(lang) {
    if (langAssetPromises[lang]) return langAssetPromises[lang];
    var langDir = new URL(lang + "/", BASE_DIR);
    langAssetPromises[lang] = Promise.all([
      fetchText(new URL("style.css", langDir).href),
      loadScriptOnce(new URL("words.js", langDir).href),
      loadScriptOnce(new URL("script.js", langDir).href),
    ]).then(function (results) {
      return { css: results[0], langDir: langDir };
    });
    return langAssetPromises[lang];
  }

  // The game's own markup lives in index.html; reuse it instead of
  // duplicating it here so the widget can't drift from the standalone page.
  function fetchMarkup(langDir) {
    return fetchText(new URL("index.html", langDir).href).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var appEl = doc.querySelector(".app");
      var adOverlayEl = doc.getElementById("adOverlay");
      if (!appEl) throw new Error("18 Words embed: .app markup not found in " + langDir.href + "index.html");
      var wrapper = document.createElement("div");
      wrapper.appendChild(appEl);
      if (adOverlayEl) wrapper.appendChild(adOverlayEl);
      return wrapper;
    });
  }

  function mountWidget(container) {
    var lang = (container.getAttribute("data-lang") || "en").toLowerCase();
    if (SUPPORTED_LANGS.indexOf(lang) === -1) {
      console.error('18 Words embed: unsupported data-lang "' + lang + '", falling back to "en".');
      lang = "en";
    }

    var shadow = container.attachShadow({ mode: "open" });

    // Isolate inherited properties (color, font, line-height, ...) from the
    // host page before the game's own stylesheet sets its own values.
    var resetStyle = document.createElement("style");
    resetStyle.textContent =
      ":host { all: initial; display: block; contain: layout style; }";
    shadow.appendChild(resetStyle);

    ensureLangAssets(lang)
      .then(function (assets) {
        var styleEl = document.createElement("style");
        styleEl.textContent = assets.css;
        shadow.appendChild(styleEl);
        return fetchMarkup(assets.langDir).then(function (markup) {
          shadow.appendChild(markup);
          var mountFn = window.Words18Mount && window.Words18Mount[lang];
          if (typeof mountFn !== "function") {
            throw new Error("18 Words embed: mount function for \"" + lang + "\" was not registered");
          }
          mountFn(shadow, { baseUrl: assets.langDir.href });
        });
      })
      .catch(function (err) {
        container.textContent = "18 Words: failed to load the game.";
        console.error(err);
      });
  }

  function init() {
    var containers = Array.prototype.slice.call(document.querySelectorAll("[data-words18]"));
    if (containers.length === 0 && CURRENT_SCRIPT.parentNode) {
      var auto = document.createElement("div");
      auto.setAttribute("data-words18", "");
      auto.setAttribute("data-lang", CURRENT_SCRIPT.getAttribute("data-lang") || "en");
      CURRENT_SCRIPT.parentNode.insertBefore(auto, CURRENT_SCRIPT.nextSibling);
      containers = [auto];
    }
    containers.forEach(mountWidget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
