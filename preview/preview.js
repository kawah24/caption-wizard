/**
 * Caption Wizard - standalone browser preview.
 *
 * Renders the real panel modules (presets, previews, controls, fonts) in a
 * plain browser page so a style, font or layout change can be seen before the
 * extension is installed and After Effects is restarted.
 *
 * It is a preview, not the panel: there is no host, so nothing here creates
 * layers. The font list comes from preview/fonts.js, generated from the fonts
 * installed on this machine, whereas the real panel asks After Effects.
 */
(function () {
  "use strict";

  var doc = document;

  var state = {
    presetId: "basic",
    overrides: {}   // { presetId: { key: value } }
  };

  function byId(id) { return doc.getElementById(id); }

  /** Minimal host stand-in so LcpFonts.load() works unchanged. */
  function callHost(fnName, jsonArg, done) {
    if (fnName === "lcp_listFonts") {
      var families = window.LCP_PREVIEW_FONTS || [];
      var fonts = [];
      for (var i = 0; i < families.length; i++) {
        fonts.push({ family: families[i], regularPS: "", boldPS: "" });
      }
      done({
        ok: true,
        source: families.length ? "system-font-list" : "builtin",
        fonts: fonts
      });
      return;
    }
    done({ ok: false, error: "the preview page has no After Effects host" });
  }

  function currentSettings() {
    return root().LcpPresets.resolveSettings(state.presetId, state.overrides[state.presetId] || {});
  }

  function root() {
    return window;
  }

  /* ------------------------------------------------------------------ */

  function renderStage() {
    var container = byId("stageContainer");
    var preset = window.LcpPresets.getPreset(state.presetId);

    container.innerHTML = "";
    var stage = window.LcpPreviews.buildStage(preset, currentSettings());
    container.appendChild(stage);

    // The stage takes its size from its container, so it has to be in the DOM
    // before it can be fitted. Reference frame here: 1920x1080.
    window.LcpPreviews.sizeStage(stage, 1920, 1080, 340);

    var note = byId("stageNote");
    if (note) {
      note.textContent = preset.blurb + "  -  " + window.LcpFonts.statusText() +
        "  -  " + window.LcpPreviews.fontStatusText(currentSettings().fontFamily);
    }
  }

  function renderGrid() {
    var grid = byId("styleGrid");
    var presets = window.LcpPresets.PRESETS;
    grid.innerHTML = "";

    for (var i = 0; i < presets.length; i++) {
      (function (preset) {
        grid.appendChild(window.LcpPreviews.buildCard(preset, {
          selected: preset.id === state.presetId,
          onSelect: function (id) {
            state.presetId = id;
            renderStage();
            renderGrid();
            renderSettings();
          }
        }));
      })(presets[i]);
    }

    byId("styleCount").textContent = String(presets.length);
  }

  function renderSettings() {
    var preset = window.LcpPresets.getPreset(state.presetId);
    window.LcpControls.render(
      byId("settingsContainer"),
      preset.controls,
      window.LcpPresets.CONTROL_DEFS,
      currentSettings(),
      function (key, value) {
        if (!state.overrides[state.presetId]) state.overrides[state.presetId] = {};
        state.overrides[state.presetId][key] = value;
        // Live repaint of the stage only - the style grid is a picker and its
        // cards keep their own thumbnail size.
        var stage = byId("stageContainer").firstChild;
        if (stage) {
          window.LcpPreviews.applyStageSettings(stage, preset, currentSettings(), {
            compWidth: 1920,
            compHeight: 1080
          });
        }
      }
    );
  }

  function renderMeta() {
    var families = window.LCP_PREVIEW_FONTS || [];
    var generated = window.LCP_PREVIEW_FONTS_GENERATED || "unknown";
    byId("meta").innerHTML =
      "Rendering the real panel modules from <code>../client/</code> - " +
      window.LcpPresets.PRESETS.length + " styles, " + families.length +
      " font families (list generated " + generated + "). " +
      "The panel itself asks After Effects for its font list, so a family shown " +
      "here may still be unavailable to the host.";
  }

  function loadFonts(done) {
    window.LcpFonts.load(callHost, function () {
      renderSettings();
      renderStage();
      renderGrid();
      if (typeof done === "function") done();
    });
  }

  function refreshAll() {
    loadFonts(function () { renderMeta(); });
  }

  function init() {
    byId("refreshBtn").onclick = function () {
      refreshAll();
      byId("meta").innerHTML += " <strong>Refreshed.</strong>";
    };
    byId("reloadBtn").onclick = function () { window.location.reload(); };

    window.onresize = function () {
      var stage = byId("stageContainer").firstChild;
      if (stage) window.LcpPreviews.sizeStage(stage, 1920, 1080, 340);
    };

    refreshAll();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
