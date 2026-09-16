/**
 * Caption Wizard - font list.
 *
 * The panel shows the fonts After Effects actually has available. The host
 * script enumerates them through `app.fonts` (AE 24.0+) and falls back to a
 * small built-in list when that API is unavailable, so this module always has
 * something usable.
 */
(function (root) {
  "use strict";

  var FALLBACK = [
    "Arial", "Arial Black", "Segoe UI", "Verdana", "Tahoma", "Trebuchet MS",
    "Impact", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"
  ];

  /**
   * The family everything falls back to when the requested one is not installed.
   * Arial ships with every Windows and macOS install, so a style can never end up
   * with no usable font.
   */
  var FALLBACK_FAMILY = "Arial";

  var state = {
    families: [],      // sorted list of family names
    entries: [],       // the host's font objects: {family, regularPS, boldPS}
    source: "pending", // "app.fonts" | "builtin" | "pending"
    loaded: false,
    error: null,
    shape: null        // host's description of the font API, when it fails
  };

  /** Sorted unique family names currently known. */
  function families() {
    if (state.loaded && state.families.length) return state.families;
    return FALLBACK;
  }

  function source() {
    return state.source;
  }

  /** Is this family in the list After Effects reported? */
  function hasFamily(family) {
    if (!family) return false;
    var wanted = String(family).toLowerCase();
    var list = families();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).toLowerCase() === wanted) return true;
    }
    return false;
  }

  /**
   * The family to actually use: the requested one when it is available, Arial
   * otherwise. Keeps the fallback in one place so the panel, the browser preview
   * and the composition cannot disagree about what a missing font becomes.
   */
  function resolveFamily(family, fallback) {
    var wanted = String(family || "");
    if (wanted && hasFamily(wanted)) return wanted;
    return fallback || FALLBACK_FAMILY;
  }

  /** The host's record for one family, or null when it is not in the list. */
  function faceInfo(family) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].family === family) return state.entries[i];
    }
    return null;
  }

  /**
   * Does this family have a real bold face?
   *
   * After Effects reports the PostScript name it would use for regular and bold;
   * for a single-weight font such as Bangers or Impact those are the same name.
   * The panel uses this to avoid faking a bold that the composition will not
   * have - Chromium would synthesise one, and the preview would then be bolder
   * and wider than the generated captions.
   */
  function hasBold(family) {
    var info = faceInfo(String(family || ""));
    if (!info) return true;                       // unknown family: assume yes
    if (!info.regularPS || !info.boldPS) return true;
    return info.regularPS !== info.boldPS;
  }

  function statusText() {
    if (!state.loaded) return "Loading fonts...";
    if (state.source === "builtin") {
      return "After Effects returned no usable font list - showing the built-in " +
        state.families.length + ". Host reported: " + (state.shape || state.error || "no detail");
    }
    return state.families.length + " font families available from After Effects.";
  }

  /**
   * Ask the host for the font list.
   * `callHost(fnName, jsonArg, done)` is the panel's host bridge.
   */
  function load(callHost, done) {
    callHost("lcp_listFonts", null, function (result) {
      if (result && result.ok && result.fonts && result.fonts.length) {
        var names = [];
        for (var i = 0; i < result.fonts.length; i++) {
          var family = result.fonts[i].family;
          if (family) names.push(family);
        }
        names.sort(function (a, b) {
          var left = a.toLowerCase();
          var right = b.toLowerCase();
          if (left < right) return -1;
          if (left > right) return 1;
          return 0;
        });

        state.families = names;
        state.entries = result.fonts;
        state.source = result.source === "app.fonts" ? "app.fonts" : "builtin";
        state.loaded = true;
        state.error = null;
        state.shape = result.shape || null;
      } else {
        state.families = FALLBACK.slice(0);
        state.entries = [];
        state.source = "builtin";
        state.loaded = true;
        state.error = (result && result.error) ? result.error : null;
        state.shape = (result && result.shape) ? result.shape : null;
      }

      if (typeof done === "function") done(state);
    });
  }

  /**
   * Font picker control.
   *
   * A native <select> cannot show a font preview: Chromium on Windows ignores
   * per-<option> font styling, so all the names come out in the UI font. This
   * builds a custom list instead, where every row is rendered in its own
   * typeface, and keeps a filter box above it for typeahead.
   */
  function buildControl(key, def, value, onChange) {
    var doc = document;
    var wrap = doc.createElement("div");
    wrap.className = "control";

    var head = doc.createElement("div");
    head.className = "control-head";

    var label = doc.createElement("span");
    label.className = "control-label";
    label.textContent = def.label;
    head.appendChild(label);

    var count = doc.createElement("span");
    count.className = "control-value";
    head.appendChild(count);
    wrap.appendChild(head);

    // The closed state: the current family, drawn in its own face.
    var current = doc.createElement("button");
    current.type = "button";
    current.className = "font-current";
    current.title = "Show the font list";
    wrap.appendChild(current);

    var filter = doc.createElement("input");
    filter.type = "text";
    filter.className = "font-filter";
    filter.placeholder = "type to filter fonts";
    wrap.appendChild(filter);

    var list = doc.createElement("div");
    list.className = "font-list";
    wrap.appendChild(list);

    var hint = doc.createElement("div");
    hint.className = "control-hint";
    wrap.appendChild(hint);

    var selected = value;

    function faceOf(name) {
      return '"' + String(name).replace(/"/g, '\\"') + '", sans-serif';
    }

    function applyCurrent(name) {
      selected = name;
      current.textContent = name;
      current.style.fontFamily = faceOf(name);
    }

    function open() {
      list.className = "font-list open";
      filter.focus();
    }

    function close() {
      list.className = "font-list";
    }

    function toggle() {
      if (list.className.indexOf("open") >= 0) close(); else open();
    }

    // Rendering every installed family would be wasteful (and can be a thousand
    // rows), so the list is capped and the filter is the way to reach the rest.
    var ROW_CAP = 200;

    function fill(query) {
      var all = families();
      var needle = String(query || "").replace(/^\s+|\s+$/g, "").toLowerCase();
      var matching = [];
      var i;

      for (i = 0; i < all.length; i++) {
        if (!needle || all[i].toLowerCase().indexOf(needle) >= 0) matching.push(all[i]);
      }
      if (!matching.length) matching = all.slice(0);

      list.innerHTML = "";
      if (!matching.length) {
        var empty = doc.createElement("div");
        empty.className = "font-empty";
        empty.textContent = "No fonts available.";
        list.appendChild(empty);
        count.textContent = "0";
        return;
      }

      var shown = Math.min(matching.length, ROW_CAP);
      for (i = 0; i < shown; i++) {
        list.appendChild(buildRow(matching[i]));
      }

      if (matching.length > shown) {
        var more = doc.createElement("div");
        more.className = "font-empty";
        more.textContent = "+" + (matching.length - shown) + " more - keep typing to narrow";
        list.appendChild(more);
      }

      count.textContent = matching.length + " / " + all.length;
      hint.textContent = statusText();
    }

    function buildRow(name) {
      var row = doc.createElement("div");
      row.className = "font-row" + (name === selected ? " selected" : "");
      row.textContent = name;
      row.title = name;
      row.style.fontFamily = faceOf(name);
      row.onclick = function () {
        applyCurrent(name);
        var rows = list.getElementsByClassName("font-row");
        for (var r = 0; r < rows.length; r++) {
          rows[r].className = (rows[r].textContent === name) ? "font-row selected" : "font-row";
        }
        onChange(key, name);
      };
      return row;
    }

    filter.oninput = function () { fill(filter.value); };
    // Enter picks the first match, which makes the filter box a typeahead.
    filter.onkeydown = function (event) {
      var code = event.keyCode || event.which;
      if (code !== 13) return;
      event.preventDefault();
      var rows = list.getElementsByClassName("font-row");
      if (rows.length) rows[0].onclick();
    };
    current.onclick = toggle;

    applyCurrent(value);
    fill("");

    wrap.setFontFamilies = function () {
      fill(filter.value);
      applyCurrent(selected);
    };

    return wrap;
  }

  root.LcpFonts = {
    FALLBACK: FALLBACK,
    FALLBACK_FAMILY: FALLBACK_FAMILY,
    load: load,
    families: families,
    source: source,
    hasFamily: hasFamily,
    resolveFamily: resolveFamily,
    faceInfo: faceInfo,
    hasBold: hasBold,
    statusText: statusText,
    buildControl: buildControl,
    state: state
  };
})(window);
