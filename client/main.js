/**
 * Caption Wizard - panel logic.
 *
 * Local only: parses the transcript in the page, optionally transcribes audio
 * on this machine through tools/transcribe.py, and hands the result to the
 * After Effects host script. No network calls, no account, no licence checks.
 */
(function (root) {
  "use strict";

  var doc = document;

  function byId(id) { return doc.getElementById(id); }

  var cs = new root.CSInterfaceLite();

  var state = {
    presetId: "karaoke",
    overrides: {},   // { presetId: { controlKey: value } }
    timing: {},
    hostReady: false,
    comp: null,
    busy: false,
    asr: { cues: null, srt: "", language: null },   // cues produced by the local transcriber
    audio: { path: null, python: null, models: [], ready: false },
    generatedFingerprint: null,   // settings the comp's layers were built from
    customStyles: [],             // { name, base, overrides } saved by the user
    job: null
  };

  var el = {};

  var SAMPLE_TEXT = [
    "One caption per line.",
    "Load an SRT to keep your own timecodes.",
    "Pick a style, then generate."
  ].join("\n");

  var LANGUAGES = [
    ["auto", "auto-detect"], ["en", "English"], ["de", "German"], ["tr", "Turkish"],
    ["es", "Spanish"], ["fr", "French"], ["it", "Italian"], ["pt", "Portuguese"],
    ["ru", "Russian"], ["ar", "Arabic"], ["hi", "Hindi"], ["ja", "Japanese"],
    ["ko", "Korean"], ["zh", "Chinese"]
  ];

  var MODELS = ["tiny", "base", "small", "medium", "large-v3"];

  /* ------------------------------------------------------------------ */
  /* host bridge helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Escape a JSON payload so it survives being embedded inside the
   * single-quoted ExtendScript literal we pass to evalScript. This is the
   * classic CEP breakage point: backslashes, quotes, newlines and every
   * non-ASCII character have to be escaped explicitly.
   */
  function toHostLiteral(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var code = text.charCodeAt(i);

      if (ch === "\\") out += "\\\\";
      else if (ch === "'") out += "\\'";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\u2028") out += "\\u2028";
      else if (ch === "\u2029") out += "\\u2029";
      else if (code < 32 || code > 126) out += "\\u" + ("000" + code.toString(16)).slice(-4);
      else out += ch;
    }
    return out;
  }

  function callHost(fnName, jsonArg, done) {
    var script = (jsonArg === undefined || jsonArg === null)
      ? fnName + "();"
      : fnName + "('" + toHostLiteral(jsonArg) + "');";

    cs.evalScript(script, function (raw) {
      done(root.lcpUnwrapHostResult(raw));
    });
  }

  /* ------------------------------------------------------------------ */
  /* state helpers                                                      */
  /* ------------------------------------------------------------------ */

  function currentSettings() {
    return root.LcpPresets.resolveSettings(baseIdFor(state.presetId), state.overrides[state.presetId] || {});
  }

  function currentTiming() {
    var base = root.LcpPresets.TIMING_DEFAULTS;
    var out = {};
    var key;
    for (key in base) {
      if (base.hasOwnProperty(key)) out[key] = base[key];
    }
    for (key in state.timing) {
      if (state.timing.hasOwnProperty(key)) out[key] = state.timing[key];
    }
    return out;
  }

  /** True while the transcript box still holds unmodified transcriber output. */
  function usingTranscriberCues() {
    return !!(state.asr.cues && state.asr.cues.length && state.asr.srt &&
              el.transcriptInput.value === state.asr.srt);
  }

  function buildPlan() {
    var timing = currentTiming();
    var style = currentSettings();
    var plan;

    if (usingTranscriberCues()) {
      plan = root.LcpTranscript.planFromCues(state.asr.cues, {
        offsetMs: timing.offsetMs,
        wordsPerCaption: style.maxWords,
      splitBySentence: style.splitBySentence === true,
        wordByWord: wantsWordTimings()
      });
    } else {
      plan = root.LcpTranscript.planCaptions(el.transcriptInput.value, {
        wpm: timing.wpm,
        gapMs: timing.gapMs,
        offsetMs: timing.offsetMs,
        wordsPerCaption: style.maxWords,
      splitBySentence: style.splitBySentence === true,
        wordByWord: wantsWordTimings()
      });
    }

    // Power words are decided here, once, and then travel with the payload, so
    // the host and the preview cannot drift apart on what counts as emphasis.
    root.LcpPresets.markEmphasis(plan.captions, style);
    return plan;
  }

  /**
   * Word data is needed by one-word-at-a-time styles and by karaoke, which
   * highlights the spoken word inside the full phrase.
   */
  function wantsWordTimings() {
    var style = currentSettings();
    return !!(style.wordByWord || style.karaoke);
  }

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || "";
    el.status.className = "status" + (kind ? " " + kind : "");
  }

  function setAutoStatus(message, kind) {
    if (!el.autoStatus) return;
    el.autoStatus.textContent = message || "";
    el.autoStatus.className = "status" + (kind ? " " + kind : "");
  }

  function setAutoProgress(percent) {
    if (!el.autoProgressBar) return;
    el.autoProgressBar.style.width = Math.max(0, Math.min(100, percent)) + "%";
  }

  /* ------------------------------------------------------------------ */
  /* transcript panel                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Match the panel's arrangement to the browser preview: when there is room,
   * the editing controls move to a right-hand column instead of stacking under
   * the style grid, which otherwise makes for a very long scroll.
   */
  function applyResponsiveLayout() {
    var width = root.innerWidth || doc.documentElement.clientWidth || 0;
    var wide = width >= 620;
    if (wide) {
      doc.body.className = "wide";
    } else {
      doc.body.className = "";
    }
    // The stage is sized against its container, so it has to be re-fitted.
    resizeStage();
  }

  /** What the current timing settings actually produce for this transcript. */
  function updateTimingSummary() {
    if (!el.timingSummary) return;
    var timing = currentTiming();
    var style = currentSettings();
    var plan = buildPlan();

    if (!plan.captions.length) {
      el.timingSummary.textContent = "No captions yet.";
      return;
    }

    var words = 0;
    for (var i = 0; i < plan.captions.length; i++) {
      words += root.LcpTranscript.countWords(plan.captions[i].text);
    }

    var seconds = plan.durationMs / 1000;
    var lines = [
      plan.captions.length + " caption(s), " + words + " word(s)",
      "total " + root.LcpTranscript.msToTime(plan.durationMs),
      timing.wpm + " wpm target",
      style.maxWords + " words per caption (style)",
      timing.gapMs + " ms gap",
      "offset " + timing.offsetMs + " ms",
      "source: " + (plan.mode === "srt" ? "timecodes" : (plan.mode === "asr" ? "local transcription" : "plain text"))
    ];

    if (seconds > 0) {
      lines.push("reads at " + (words / seconds * 60).toFixed(0) + " wpm actual");
    }

    var changed = 0;
    for (var c = 0; c < plan.captions.length; c++) {
      var captionWords = root.LcpTranscript.countWords(plan.captions[c].text);
      if (captionWords > style.maxWords) changed++;
    }
    if (changed) {
      lines.push("note: " + changed + " caption(s) longer than the limit");
    }

    el.timingSummary.textContent = lines.join("\n");
  }

  function updateStats() {
    if (!el.transcriptStats) return;
    var plan = buildPlan();
    if (!plan.captions.length) {
      el.transcriptStats.textContent = "No captions yet.";
      return;
    }
    var words = 0;
    for (var i = 0; i < plan.captions.length; i++) {
      words += root.LcpTranscript.countWords(plan.captions[i].text);
    }
    var source = plan.mode === "srt" ? "timecodes"
      : (plan.mode === "asr" ? "local transcription (real word timings)" : "plain text");
    el.transcriptStats.textContent =
      plan.captions.length + " caption(s), " + words + " word(s), from " + source +
      ", ends at " + root.LcpTranscript.msToTime(plan.durationMs);
    updateTimingSummary();
    refreshStageCaption();
  }

  function loadSrtFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      el.transcriptInput.value = String(reader.result || "");
      state.asr.cues = null;
      state.asr.srt = "";
      updateStats();
      setStatus("Loaded " + file.name + ".", "ok");
    };
    reader.onerror = function () {
      setStatus("Could not read that file.", "error");
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ */
  /* controls                                                           */
  /* ------------------------------------------------------------------ */

  /** Control construction lives in controls.js so the browser preview can
   *  render the exact same UI. */
  function buildControl(key, def, value, onChange) {
    return root.LcpControls.build(key, def, value, onChange);
  }

  /**
   * Repaint the live preview only. The style grid is a picker and stays put -
   * changing the font size moves the caption on the stage, not the cards.
   */
  function refreshSelectedPreview() {
    var settings = currentSettings();
    var preset = activePreset();

    var stage = el.stageContainer.firstChild;
    if (stage) {
      var comp = currentCompSize();
      root.LcpPreviews.applyStageSettings(stage, preset, settings, {
        compWidth: comp.width,
        compHeight: comp.height
      });
    }
    updateFontStatus();
  }

  /** The active comp's size, or the 1920x1080 reference when there is none. */
  function currentCompSize() {
    if (state.comp && state.comp.ok && state.comp.width && state.comp.height) {
      return { width: state.comp.width, height: state.comp.height };
    }
    return { width: root.LcpPreviews.REFERENCE_COMP_WIDTH, height: 1080 };
  }

  /** Re-fit the stage after a resize, keeping the comp's aspect ratio. */
  function resizeStage() {
    var stage = el.stageContainer ? el.stageContainer.firstChild : null;
    if (!stage) return;
    var comp = currentCompSize();
    root.LcpPreviews.sizeStage(stage, comp.width, comp.height, STAGE_MAX_HEIGHT);

    // Re-fitting the frame is not enough: the caption's size is derived from the
    // frame's width, so it has to be re-applied too. Without this the stage kept
    // the scale it was given while it had no width at all - and a stage built on
    // a hidden tab has none, which is why the preview looked wrong until a
    // setting was touched.
    root.LcpPreviews.applyStageSettings(stage, activePreset(),
      currentSettings(), { compWidth: comp.width, compHeight: comp.height });
  }

  /** A real caption from the transcript, for the preview stage. */
  function captionForPreview() {
    var plan = buildPlan();
    var style = currentSettings();
    var limit = Math.max(1, parseInt(style.maxWords, 10) || 6);

    // Prefer a caption inside the style's own limit, so the preview shows what
    // generation will produce rather than something longer.
    return root.LcpTranscript.pickPreviewCaption(plan.captions, {
      minWords: Math.min(2, limit),
      maxWords: limit
    });
  }

  /** Rebuild the large preview stage for the selected style. */
  function renderStage() {
    if (!el.stageContainer) return;
    var preset = activePreset();
    var comp = currentCompSize();
    var caption = captionForPreview();

    el.stageContainer.innerHTML = "";
    var stage = root.LcpPreviews.buildStage(preset, currentSettings(), {
      disableMedia: true,
      compWidth: comp.width,
      compHeight: comp.height,
      maxHeight: STAGE_MAX_HEIGHT,
      caption: caption
    });
    el.stageContainer.appendChild(stage);
    stage.setAttribute("data-caption", caption ? caption.text : "");
    state.previewCaptionText = caption ? caption.text : "";
    updateFontStatus();
  }

  /**
   * Keep the stage showing real transcript text as the transcript is edited.
   * Only touches the DOM when the chosen caption actually changes.
   */
  function refreshStageCaption() {
    var stage = el.stageContainer ? el.stageContainer.firstChild : null;
    if (!stage) return;

    var caption = captionForPreview();
    var text = caption ? caption.text : "";
    if (stage.getAttribute("data-caption") === text) return;

    var preset = activePreset();
    var comp = currentCompSize();
    root.LcpPreviews.setStageCaption(stage, preset, currentSettings(), caption, {
      compWidth: comp.width,
      compHeight: comp.height
    });
    stage.setAttribute("data-caption", text);
    state.previewCaptionText = text;
    updateFontStatus();
  }

  function renderStyleGrid() {
    var grid = el.styleGrid;
    grid.innerHTML = "";

    // Saved styles come first, in a section of their own, so the styles you use
    // sit at the top and the shipped ones stay below in their authored order.
    if (state.customStyles.length) {
      var heading = doc.createElement("div");
      heading.className = "grid-section";
      heading.textContent = "Custom";
      grid.appendChild(heading);
    }

    for (var c = 0; c < state.customStyles.length; c++) {
      (function (entry) {
        var base = root.LcpPresets.getPreset(entry.base);
        var custom = {
          id: entry.name,
          name: entry.name,
          blurb: "Your style, built on " + (base ? base.name : entry.base),
          motion: base ? base.motion : "none",
          karaoke: !!(base && base.karaoke),
          previewWords: base ? base.previewWords : null,
          previewLine: base ? base.previewLine : entry.name,
          controls: (base ? base.controls : ["fontSize"]).slice(0),
          defaults: {},
          custom: true
        };
        grid.appendChild(root.LcpPreviews.buildCard(custom, {
          selected: entry.name === state.presetId,
          removeId: entry.name,
          onRemove: deleteCustomStyle,
          onSelect: function (id) {
            state.presetId = id;
            var saved = customStyleEntry(id);
            if (saved) state.overrides[id] = saved.overrides || {};
            renderStyleGrid();
            renderStage();
            renderSettings();
            saveSession();
          }
        }));
      })(state.customStyles[c]);
    }

    // Cards deliberately get no settings: they show each preset's own look at
    // their own thumbnail size. Feeding them the current settings meant a large
    // font size overflowed the card, and a grid that shifts while you drag a
    // slider is hard to choose from.
    var presets = root.LcpPresets.PRESETS;
    for (var i = 0; i < presets.length; i++) {
      (function (preset) {
        grid.appendChild(root.LcpPreviews.buildCard(preset, {
          selected: preset.id === state.presetId,
          onSelect: function (id) {
            state.presetId = id;
            renderStyleGrid();
            renderStage();
            renderSettings();
            saveSession();
          }
        }));
      })(presets[i]);
    }
  }

  /**
   * Put the current style back to its preset defaults: the panel opens with
   * `overrides[presetId]` holding only what the user changed, so clearing it
   * restores the shipped values without touching any other preset.
   */
  var STORE_KEYS = {
    overrides: "lcp.overrides",
    selection: "lcp.presetId",
    custom: "lcp.customStyles"
  };

  function storeJSON(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode etc */ }
  }

  function readJSON(key, fallback) {
    try {
      var raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  /**
   * Persist the panel's editing session: the per-style overrides, the selected
   * style and the saved styles. Called after every change, so a reopened panel
   * is where the user left it.
   */
  function saveSession() {
    storeJSON(STORE_KEYS.overrides, state.overrides);
    storeJSON(STORE_KEYS.selection, state.presetId);
    storeJSON(STORE_KEYS.custom, state.customStyles);
  }

  /**
   * Restore a saved session. A selection that is neither a built-in nor a saved
   * style falls back to the default.
   */
  function loadSession() {
    var overrides = readJSON(STORE_KEYS.overrides, null);
    if (overrides && typeof overrides === "object") state.overrides = overrides;

    state.customStyles = readJSON(STORE_KEYS.custom, []) || [];
    if (!(state.customStyles instanceof Array)) state.customStyles = [];

    var selection = readJSON(STORE_KEYS.selection, state.presetId);
    var known = root.LcpPresets.getPreset(selection) ||
      state.customStyles.some(function (s) { return s.name === selection; });
    if (known && typeof selection === "string") state.presetId = selection;
  }

  /**
   * Which built-in style a selection resolves through.
   *
   * A saved style keeps its own settings but borrows the motion and defaults of the
   * style it was built from. getPreset() cannot tell a saved name from a typo - it
   * falls back to the first preset - so nothing may ask it directly.
   */
  function baseIdFor(id) {
    var entry = customStyleEntry(id);
    return entry ? entry.base : id;
  }

  /** The preset behind the current selection, saved or built-in. */
  function activePreset() {
    return root.LcpPresets.getPreset(baseIdFor(state.presetId));
  }

  /** A saved style's settings, as the grid and the editor see them. */
  function customStyleEntry(id) {
    for (var i = 0; i < state.customStyles.length; i++) {
      if (state.customStyles[i].name === id) return state.customStyles[i];
    }
    return null;
  }

  /**
   * Save the current style's settings under a name.
   *
   * The saved style keeps the motion of the style it was built from - so it still
   * previews and generates like that one - and its own overrides, which the editor
   * then works on directly.
   */
  function saveCustomStyle(name) {
    name = String(name === undefined || name === null ? "" : name).replace(/^\s+|\s+$/g, "");
    if (!name) { setStatus("Name the style before saving.", "error"); return false; }
    var builtIn = root.LcpPresets.PRESETS.some(function (p) { return p.id === name; });
    if (builtIn || customStyleEntry(name)) {
      setStatus('"' + name + '" already exists - choose another name.', "error");
      return false;
    }

    state.customStyles.push({ name: name, base: state.presetId, overrides: state.overrides[state.presetId] || {} });
    state.overrides[name] = state.customStyles[state.customStyles.length - 1].overrides;
    state.presetId = name;
    saveSession();
    renderStyleGrid();
    renderStage();
    renderSettings();
    setStatus('Saved "' + name + '". It is in the style grid, marked custom.', "ok");
    return true;
  }

  function deleteCustomStyle(id) {
    state.customStyles = state.customStyles.filter(function (s) { return s.name !== id; });
    delete state.overrides[id];
    state.presetId = "karaoke";
    saveSession();
    renderStyleGrid();
    renderStage();
    renderSettings();
    setStatus('Removed "' + id + '".', "ok");
  }

  function resetStyle() {
    var preset = activePreset();

    if (!state.overrides[state.presetId] ||
        !Object.keys(state.overrides[state.presetId]).length) {
      setStatus(preset.name + " is already at its defaults.");
      return;
    }

    var changed = Object.keys(state.overrides[state.presetId]).length;
    state.overrides[state.presetId] = {};

    saveSession();
    renderSettings();
    renderStage();
    updateFontStatus();
    setStatus(changed + " setting(s) in " + preset.name + " reset to defaults.", "ok");
  }

  function onSettingChanged(k, v) {
    if (!state.overrides[state.presetId]) state.overrides[state.presetId] = {};
    state.overrides[state.presetId][k] = v;

    // A switch can reveal or hide the controls that belong to it.
    var def = root.LcpPresets.CONTROL_DEFS[k];
    if (def && def.type === "toggle") {
      renderSettings();
    }

    refreshSelectedPreview();

    // Max words changes which caption is representative, so the stage has to
    // pick again - restyling alone left it showing a caption from the old limit.
    updateStats();

    saveSession();
  }

  function renderSettings() {
    var container = el.settingsContainer;
    container.innerHTML = "";
    var keys = root.LcpPresets.controlsFor(state.presetId);
    var settings = currentSettings();

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var def = root.LcpPresets.CONTROL_DEFS[key];
      if (!def) continue;
      // Only show detail controls while the switch they belong to is on.
      if (def.dependsOn && !settings[def.dependsOn]) continue;

      (function (controlKey, controlDef) {
        container.appendChild(buildControl(controlKey, controlDef, settings[controlKey], onSettingChanged));
      })(key, def);
    }
  }

  function renderTiming() {
    var container = el.timingContainer;
    container.innerHTML = "";
    var timing = currentTiming();
    var key;

    for (key in root.LcpPresets.TIMING_DEFS) {
      if (!root.LcpPresets.TIMING_DEFS.hasOwnProperty(key)) continue;
      (function (controlKey, controlDef) {
        container.appendChild(buildControl(controlKey, controlDef, timing[controlKey], function (k, v) {
          state.timing[k] = v;
          updateStats();
        }));
      })(key, root.LcpPresets.TIMING_DEFS[key]);
    }
  }

  function loadFonts() {
    root.LcpFonts.load(callHost, function () {
      renderSettings();
      refreshSelectedPreview();
      updateFontStatus();
    });
  }

  /** Show what the preview is actually rendering, under the stage. */
  /**
   * What Generate would produce right now.
   *
   * Kept as a fingerprint so the panel can tell a comp that matches the preview
   * from one built with older settings - the usual reason a generated caption
   * looks out of place next to the preview.
   */
  function generationFingerprint() {
    var plan = buildPlan();
    return JSON.stringify({
      style: currentSettings(),
      timing: currentTiming(),
      captions: plan.captions
    });
  }

  function updateFontStatus() {
    if (!el.stageNote) return;
    var preset = activePreset();
    var settings = currentSettings();
    var comp = currentCompSize();

    // Be explicit where the preview cannot be faithful: the comp's own frame,
    // the font, a bold that does not exist, and the flattened effects.
    var compNote = (state.comp && state.comp.ok)
      ? "comp " + comp.width + " x " + comp.height
      : "no active comp - previewing " + comp.width + " x " + comp.height;

    var captionText = String(state.previewCaptionText || "");
    if (captionText.length > 42) captionText = captionText.substring(0, 42) + "...";
    var captionNote = captionText
      ? "showing \"" + captionText + "\" from your transcript"
      : "no transcript yet - showing a sample line";

    var notes = [preset.blurb, compNote, captionNote, root.LcpFonts.statusText(),
      root.LcpPreviews.fontStatusText(settings.fontFamily)];

    if (settings.bold && !root.LcpFonts.hasBold(settings.fontFamily)) {
      notes.push("bold is not available for that family, so the preview and the comp both use the regular weight");
    }
    if (settings.applyShadow || settings.applyGlow) {
      notes.push("shadow and glow are approximated in this preview");
    }

    // Say the scale out loud. The preview is a scaled view of the comp, so a
    // caption cannot be drawn at its comp size here - what has to match is its
    // share of the frame. Printing both numbers makes that checkable instead of
    // a matter of opinion.
    var stage = el.stageContainer ? el.stageContainer.firstChild : null;
    var frameWidth = stage ? stage.clientWidth : 0;
    if (frameWidth > 0) {
      var drawn = Math.round(settings.fontSize * root.LcpPreviews.sizeFactor(frameWidth));
      notes.push("this " + frameWidth + "px frame draws a " + Math.round(settings.fontSize) +
                 "px caption at " + drawn + "px - the same share of the frame as the comp");
    }
    if (state.generatedFingerprint && state.generatedFingerprint !== generationFingerprint()) {
      notes.push("settings or text changed since you generated - press Generate Captions " +
                 "to update the comp to this preview");
    }
    el.stageNote.textContent = notes.join("  -  ");
  }

  /* ------------------------------------------------------------------ */
  /* host actions                                                       */
  /* ------------------------------------------------------------------ */

  function describeComp(info) {
    if (!info || info.ok === false) return "No active composition.";
    return "Comp: " + info.name + "  " + info.width + "x" + info.height +
           "  " + info.frameRate + " fps  " + info.duration.toFixed(2) + "s  " +
           info.layers + " layer(s)" +
           (info.generated ? "  " + info.generated + " from this panel" : "");
  }

  /**
   * How tall the preview frame may grow.
   *
   * A portrait comp is capped by height, so this decides how wide the frame gets
   * and therefore how large the caption is drawn. At 300 a 1080x1920 comp gave a
   * 169px-wide frame, which rendered a 150px caption at 13px - legible, but small
   * enough to look like a different size from the comp. 420 gives it 236px.
   */
  var STAGE_MAX_HEIGHT = 420;

  function refreshCompInfo() {
    if (!state.hostReady) return;
    callHost("lcp_compInfo", null, function (info) {
      if (info && info.ok) {
        // Re-fit the preview when the comp changes, since the frame follows its
        // aspect ratio and the text is scaled against its width.
        var changed = !state.comp || state.comp.width !== info.width ||
                      state.comp.height !== info.height;
        state.comp = info;
        el.compInfo.textContent = describeComp(info);
        if (changed) {
          renderStage();
        }
      } else {
        state.comp = null;
        el.compInfo.textContent = (info && info.error) ? info.error : "No active composition.";
      }
    });
  }

  function onGenerate() {
    if (state.busy) return;

    var plan = buildPlan();
    if (!plan.captions.length) {
      setStatus("Nothing to generate - add transcript text first.", "error");
      return;
    }
    if (!state.hostReady) {
      setStatus("After Effects host script is not reachable. Click Refresh.", "error");
      return;
    }

    state.busy = true;
    el.generateBtn.disabled = true;
    setStatus("Generating " + plan.captions.length + " caption(s)...", "busy");

    var payload = JSON.stringify({
      captions: plan.captions,
      style: currentSettings(),
      replacePrevious: !!(el.replacePrevious && el.replacePrevious.checked)
    });

    callHost("lcp_create", payload, function (result) {
      state.busy = false;
      el.generateBtn.disabled = false;

      if (!result) {
        setStatus("No response from After Effects. Is a composition open?", "error");
        return;
      }
      if (result.ok === false) {
        setStatus(result.error || "Generation failed.", "error");
        return;
      }

      // Report what the comp actually gained. Glow adds a backdrop layer behind
      // every text layer, so the plain total would overstate the caption count.
      var message = "Created " + result.created + " text layer(s)";
      if (result.backdrops) {
        message += " (" + result.text + " caption" + (result.text === 1 ? "" : "s") +
                   " + " + result.backdrops + " glow backdrop" +
                   (result.backdrops === 1 ? "" : "s") + ")";
      }
      message += ".";
      if (result.removed) {
        message = "Replaced " + result.removed + " previous layer(s). " + message;
      }
      // Remember what these layers were built from, so the preview can say when it
      // has moved on since. Read before the fingerprint changes shape.
      state.generatedFingerprint = generationFingerprint();
      updateFontStatus();
      // Report the placement the host actually used. Positions depend on where
      // After Effects anchors text, so showing the numbers beats assuming it.
      if (result.placement) {
        var place = result.placement;
        message += "\nPlaced at " + Math.round(place.fraction * 100) + "% of the comp height (" +
                   Math.round(place.anchorY) + " px of " + place.compHeight +
                   ", text offset " + Math.round(place.textOffsetY) + " px)";
        if (place.compHeight > 0 && Math.abs(place.fraction - (place.posY / 100)) > 0.01) {
          message += " - does not match the Vertical setting";
        }
        message += ".";
        // The caption's own size in the comp, next to the preview's note, so the
        // two proportions can be compared as numbers rather than by eye.
        if (place.compWidth > 0) {
          message += "\nComp caption: " + (place.fontFace || "?") + " at " +
                     Math.round(place.fontDrawnPx) + "px in a " + place.compWidth + "px comp (" +
                     (place.fontDrawnPx / place.compWidth * 100).toFixed(1) + "% of the width), from a " +
                     Math.round(place.fontSetting) + "px setting.";
        }
        // The letter spacing is only comparable when both sides draw the same face:
        // a fallback has different glyph widths, so the same tracking setting shows
        // up as different spacing. Compare what the host resolved with what the
        // preview is drawing, and say so rather than leaving it to the eye.
        if (place.fontFace && root.LcpFonts && root.LcpFonts.familyForPostScript) {
          var compFamily = root.LcpFonts.familyForPostScript(place.fontFace);
          var previewFamily = root.LcpPreviews.resolvePreviewFont(settings.fontFamily).family;
          if (compFamily !== previewFamily) {
            message += "\nFont mismatch: the comp resolved " + place.fontFace + " (" + compFamily +
                       ") while this preview draws " + previewFamily +
                       " - letter spacing, size and outline will differ until they match.";
          }
        }
      }
      if (result.warnings && result.warnings.length) {
        message += "\n" + result.warnings.join("\n");
      }
      if (result.errors && result.errors.length) {
        message += "\n" + result.errors.length + " caption(s) had problems:\n- " +
                   result.errors.join("\n- ");
        setStatus(message, "busy");
      } else {
        setStatus(message, "ok");
      }
      refreshCompInfo();
    });
  }

  function onClearGenerated() {
    if (state.busy) return;
    if (!state.hostReady) {
      setStatus("After Effects host script is not reachable. Click Refresh.", "error");
      return;
    }

    state.busy = true;
    el.clearGeneratedBtn.disabled = true;

    callHost("lcp_clear", null, function (result) {
      state.busy = false;
      el.clearGeneratedBtn.disabled = false;

      if (!result) {
        setStatus("No response from After Effects.", "error");
        return;
      }
      if (result.ok === false) {
        setStatus(result.error || "Could not clear generated layers.", "error");
        return;
      }
      setStatus("Removed " + result.removed + " generated layer(s).", "ok");
      refreshCompInfo();
    });
  }

  function refresh() {
    if (!cs.isAvailable()) {
      state.hostReady = false;
      el.generateBtn.disabled = true;
      el.compInfo.textContent = "Not running inside After Effects.";
      setStatus("Host unavailable.", "error");
      return;
    }

    setStatus("Connecting to After Effects...", "busy");
    callHost("lcp_ping", null, function (res) {
      if (res && res.ok) {
        state.hostReady = true;
        el.generateBtn.disabled = false;
        setStatus("Host script ready (v" + res.version + ").", "ok");
        loadFonts();
        refreshCompInfo();
        // Auto Caption works from the video that is already open, so look for it
        // as soon as the host answers. Silent: no comp open is not an error here.
        useCompMedia(true);
      } else {
        state.hostReady = false;
        el.generateBtn.disabled = true;
        setStatus("Host script did not answer. Make sure the panel is open inside After Effects.", "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* auto caption tab                                                   */
  /* ------------------------------------------------------------------ */

  function updateAutoButtons() {
    var ready = !!(state.audio.ready && state.audio.path);
    el.transcribeBtn.disabled = !ready || !!state.job;
    el.cancelTranscribeBtn.disabled = !state.job;
  }

  function annotateModels(cached) {
    var options = el.modelSelect.getElementsByTagName("option");
    for (var i = 0; i < options.length; i++) {
      var name = options[i].value;
      var suffix = cached.indexOf(name) >= 0 ? " (cached)" : " (needs download)";
      options[i].textContent = name + suffix;
    }
  }

  function checkPython(manualPath) {
    if (manualPath) {
      try { root.localStorage.setItem("lcp.pythonPath", manualPath); } catch (err) { /* ignore */ }
    }

    el.pythonState.textContent = "checking...";
    setAutoStatus("Checking the local transcriber...", "busy");

    root.LcpAuto.check(function (res) {
      if (res && res.ok) {
        state.audio.python = res.python;
        state.audio.models = res.models || [];
        state.audio.ready = true;
        el.pythonPath.value = res.python;
        el.pythonState.textContent = "faster-whisper " + (res.fasterWhisper || "?") +
          (res.ctranslate2 ? ", ct2 " + res.ctranslate2 : "");
        annotateModels(state.audio.models);
        setAutoStatus(
          "Ready. Cached models: " +
          (state.audio.models.length ? state.audio.models.join(", ") : "none - pick a model and allow one download"),
          "ok"
        );
      } else {
        state.audio.ready = false;
        el.pythonState.textContent = "unavailable";
        setAutoStatus((res && res.error) || "Local transcriber unavailable.", "error");
      }
      updateAutoButtons();
    });
  }

  /**
   * Take the audio straight from the active composition rather than asking for a
   * file. Media time t sits at comp time t + startTime, so the layer's start
   * time is applied as the transcript offset - otherwise captions land early or
   * late whenever the clip does not begin at zero.
   *
   * `silent` is used for the automatic attempt on load and on Refresh, where a
   * missing comp should not shout at the user.
   */
  function useCompMedia(silent) {
    if (!state.hostReady) {
      if (!silent) setAutoStatus("After Effects host script is not reachable. Click Refresh.", "error");
      return;
    }

    if (el.mediaState) el.mediaState.textContent = "checking...";

    callHost("lcp_mediaInfo", null, function (info) {
      if (!info || info.ok === false) {
        state.audio.fromComp = null;
        if (el.mediaState) el.mediaState.textContent = "none";
        if (el.mediaHint) el.mediaHint.textContent = (info && info.error) || "No composition media found.";
        if (!silent) setAutoStatus((info && info.error) || "No composition media found.", "error");
        updateAutoButtons();
        return;
      }

      state.audio.path = info.path;
      state.audio.fromComp = { layer: info.layer, startTime: info.startTime, hasAudio: info.hasAudio };
      el.audioPath.value = info.path;

      if (el.mediaState) {
        el.mediaState.textContent = info.hasAudio ? "from the comp" : "no audio track";
      }
      if (el.mediaHint) {
        var parts = ["comp \"" + info.comp + "\", layer \"" + info.layer + "\""];
        if (!info.hasAudio) parts.push("this clip has no audio track");
        if (info.startTime) parts.push("starts at " + info.startTime.toFixed(2) + "s, applied as the timing offset");
        el.mediaHint.textContent = parts.join("  -  ");
      }

      setAutoStatus("Loaded the comp's video: " + info.path, info.hasAudio ? "ok" : "busy");
      updateAutoButtons();
    });
  }

  function chooseAudio() {
    var cepFs = root.cep && root.cep.fs ? root.cep.fs : null;

    if (!cepFs || typeof cepFs.showOpenDialog !== "function") {
      setAutoStatus("The CEP file dialog is unavailable - paste a full file path above instead.", "error");
      return;
    }

    var result = cepFs.showOpenDialog(
      false, false, "Choose audio or video",
      "",
      ["mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "mkv", "webm"]
    );

    if (result && result.err === 0 && result.data && result.data.length) {
      state.audio.path = result.data[0];
      el.audioPath.value = state.audio.path;
      setAutoStatus("Selected " + state.audio.path, "ok");
    } else if (result && result.err !== 0) {
      setAutoStatus("File dialog error: " + result.err, "error");
    }
    updateAutoButtons();
  }

  function describeStage(progress) {
    if (!progress) return "Working...";
    if (progress.stage === "converting") return "Extracting audio...";
    if (progress.stage === "loading model") return "Loading model " + (progress.model || "") + "...";
    if (progress.stage === "transcribing") {
      return "Transcribing" + (progress.segment ? " (segment " + progress.segment + ")" : "") + "...";
    }
    if (progress.stage === "done") return "Finishing...";
    return "Working...";
  }

  function finishTranscribe(result) {
    state.job = null;
    el.generateBtn.disabled = false;
    el.transcribeBtn.disabled = false;
    el.cancelTranscribeBtn.disabled = true;

    if (!result || result.ok !== true) {
      setAutoProgress(0);
      setAutoStatus((result && result.error) || "Transcription failed.", "error");
      updateAutoButtons();
      return;
    }

    setAutoProgress(100);

    if (!result.segments || !result.segments.length) {
      setAutoStatus("No speech was detected in that file.", "error");
      updateAutoButtons();
      return;
    }

    var srt = root.LcpAuto.segmentsToSrt(result.segments);
    state.asr.cues = root.LcpAuto.segmentsToCues(result.segments);
    state.asr.srt = srt;
    state.asr.language = result.language || null;

    // A clip that does not start at zero shifts every cue, so align the
    // transcript to the composition using the layer's own start time.
    var offsetNote = "";
    if (state.audio.fromComp && state.audio.fromComp.startTime) {
      var offsetMs = Math.round(state.audio.fromComp.startTime * 1000);
      state.timing.offsetMs = offsetMs;
      renderTiming();
      offsetNote = "timing offset set to " + offsetMs + " ms for that layer";
    }

    el.transcriptInput.value = srt;
    updateStats();
    showTab("text");

    var wordCount = 0;
    for (var i = 0; i < state.asr.cues.length; i++) {
      wordCount += (state.asr.cues[i].words || []).length;
    }

    setAutoStatus(
      result.segments.length + " cue(s), " + wordCount + " word timing(s), language " +
      (result.language || "unknown") + ", model " + (result.model || "?") +
      (offsetNote ? ". " + offsetNote : "."),
      "ok"
    );
    setStatus("Transcript filled from the local transcription. Generate when ready.", "ok");
    updateAutoButtons();
  }

  function transcribeNow() {
    if (state.job) return;
    if (!state.audio.ready) {
      setAutoStatus("The local transcriber is not ready. Check the Python row.", "error");
      return;
    }
    if (!state.audio.path) {
      setAutoStatus("Choose an audio or video file first.", "error");
      return;
    }

    el.transcribeBtn.disabled = true;
    el.cancelTranscribeBtn.disabled = false;
    el.generateBtn.disabled = true;
    setAutoProgress(1);
    setAutoStatus("Starting " + el.modelSelect.value + "...", "busy");

    state.job = root.LcpAuto.transcribe({
      python: state.audio.python,
      input: state.audio.path,
      model: el.modelSelect.value,
      language: el.languageSelect.value,
      allowDownload: el.allowDownload.checked
    }, {
      onProgress: function (progress) {
        if (progress && typeof progress.percent === "number") setAutoProgress(progress.percent);
        setAutoStatus(describeStage(progress), "busy");
      },
      onResult: function (result) {
        finishTranscribe(result);
      }
    });
  }

  function cancelTranscribe() {
    if (!state.job) return;
    setAutoStatus("Cancelling...", "busy");
    state.job.cancel();
  }

  function buildAutoTab() {
    var i;
    for (i = 0; i < MODELS.length; i++) {
      var modelOption = doc.createElement("option");
      modelOption.value = MODELS[i];
      modelOption.textContent = MODELS[i];
      el.modelSelect.appendChild(modelOption);
    }
    for (i = 0; i < LANGUAGES.length; i++) {
      var languageOption = doc.createElement("option");
      languageOption.value = LANGUAGES[i][0];
      languageOption.textContent = LANGUAGES[i][1];
      el.languageSelect.appendChild(languageOption);
    }

    try {
      var savedModel = root.localStorage.getItem("lcp.model");
      if (savedModel) el.modelSelect.value = savedModel;
      var savedLanguage = root.localStorage.getItem("lcp.language");
      if (savedLanguage) el.languageSelect.value = savedLanguage;
    } catch (err) { /* ignore */ }

    el.modelSelect.onchange = function () {
      try { root.localStorage.setItem("lcp.model", el.modelSelect.value); } catch (e) { /* ignore */ }
    };
    el.languageSelect.onchange = function () {
      try { root.localStorage.setItem("lcp.language", el.languageSelect.value); } catch (e) { /* ignore */ }
    };
    el.audioPath.oninput = function () {
      state.audio.path = el.audioPath.value.replace(/^\s+|\s+$/g, "") || null;
      state.audio.fromComp = null;   // hand-typed path: no comp offset to apply
      updateAutoButtons();
    };
    el.useCompMediaBtn.onclick = function () { useCompMedia(false); };
    el.pythonPath.onchange = function () {
      checkPython(el.pythonPath.value.replace(/^\s+|\s+$/g, ""));
    };
    el.recheckPythonBtn.onclick = function () {
      checkPython(el.pythonPath.value.replace(/^\s+|\s+$/g, ""));
    };
    el.chooseAudioBtn.onclick = chooseAudio;
    el.transcribeBtn.onclick = transcribeNow;
    el.cancelTranscribeBtn.onclick = cancelTranscribe;

    if (!root.LcpAuto.available()) {
      state.audio.ready = false;
      el.pythonState.textContent = "unavailable";
      setAutoStatus(
        "Node integration is unavailable, so the panel cannot launch the local transcriber. " +
        "The manifest already declares --enable-nodejs and --mixed-context, and CEP only " +
        "reads those flags when After Effects starts - so fully quit and reopen After Effects, " +
        "then reopen this panel. Probe: " + root.LcpAuto.diagnostics() + ".",
        "error"
      );
      updateAutoButtons();
      return;
    }

    try {
      var savedPython = root.localStorage.getItem("lcp.pythonPath");
      if (savedPython) el.pythonPath.value = savedPython;
    } catch (err2) { /* ignore */ }

    checkPython(null);
  }

  /* ------------------------------------------------------------------ */
  /* tabs + wiring                                                      */
  /* ------------------------------------------------------------------ */

  function showTab(tabId) {
    var tabs = el.tabBar.getElementsByClassName("tab");
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].className = (tabs[i].getAttribute("data-tab") === tabId) ? "tab active" : "tab";
    }
    el.viewText.style.display = tabId === "text" ? "block" : "none";
    el.viewStyle.style.display = tabId === "style" ? "block" : "none";
    el.viewTiming.style.display = tabId === "timing" ? "block" : "none";
    el.viewAuto.style.display = tabId === "auto" ? "block" : "none";

    // The stage is built while this tab is hidden, so it has never had a width to
    // measure against. Re-fit it the moment it becomes visible.
    if (tabId === "style") {
      resizeStage();
    }

    // Generate belongs to the style: it applies the style you picked. The rest of
    // the footer stays visible everywhere, so a transcribe message or an error is
    // never hidden by which tab happens to be open.
    if (el.generateArea) {
      el.generateArea.style.display = tabId === "style" ? "block" : "none";
    }
  }

  function collectElements() {
    el.tabBar = byId("tabBar");
    el.viewText = byId("view-text");
    el.viewStyle = byId("view-style");
    el.viewTiming = byId("view-timing");
    el.viewAuto = byId("view-auto");
    el.transcriptInput = byId("transcriptInput");
    el.transcriptStats = byId("transcriptStats");
    el.compInfo = byId("compInfo");
    el.styleGrid = byId("styleGrid");
    el.stageContainer = byId("stageContainer");
    el.stageNote = byId("stageNote");
    el.settingsContainer = byId("settingsContainer");
    el.timingContainer = byId("timingContainer");
    el.timingSummary = byId("timingSummary");
    el.resetStyleBtn = byId("resetStyleBtn");
    el.generateBtn = byId("generateBtn");
    el.refreshBtn = byId("refreshBtn");
    el.clearGeneratedBtn = byId("clearGeneratedBtn");
    el.generateArea = byId("generateArea");
    el.replacePrevious = byId("replacePrevious");
    el.saveStyleBtn = byId("saveStyleBtn");
    el.customStyleName = byId("customStyleName");
    el.status = byId("status");
    el.cepBanner = byId("cepBanner");
    el.srtFile = byId("srtFile");
    el.pythonState = byId("pythonState");
    el.pythonPath = byId("pythonPath");
    el.recheckPythonBtn = byId("recheckPythonBtn");
    el.modelSelect = byId("modelSelect");
    el.languageSelect = byId("languageSelect");
    el.allowDownload = byId("allowDownload");
    el.audioPath = byId("audioPath");
    el.chooseAudioBtn = byId("chooseAudioBtn");
    el.useCompMediaBtn = byId("useCompMediaBtn");
    el.mediaState = byId("mediaState");
    el.mediaHint = byId("mediaHint");
    el.transcribeBtn = byId("transcribeBtn");
    el.cancelTranscribeBtn = byId("cancelTranscribeBtn");
    el.autoProgressBar = byId("autoProgressBar");
    el.autoStatus = byId("autoStatus");
  }

  function init() {
    collectElements();

    if (!cs.isAvailable()) {
      el.cepBanner.style.display = "block";
    }

    applyResponsiveLayout();
    root.onresize = applyResponsiveLayout;

    // After Effects is a separate window, so switching comps there leaves this
    // panel describing the old one until you press Refresh. Re-read the comp when
    // the panel comes back to the front, which is exactly when a switch has just
    // happened. Deliberately narrow: the audio path is left alone so a clip you
    // chose by hand is never replaced, and the font list is not re-enumerated
    // because it cannot change without one.
    var lastFocusCheck = 0;
    root.onfocus = function () {
      var now = new Date().getTime();
      if (state.busy || !state.hostReady) return;
      if (now - lastFocusCheck < 1200) return;
      lastFocusCheck = now;
      refreshCompInfo();
    };

    loadSession();

    renderStyleGrid();
    renderStage();
    renderSettings();
    renderTiming();
    buildAutoTab();

    el.transcriptInput.value = SAMPLE_TEXT;
    updateStats();

    el.transcriptInput.oninput = function () {
      updateStats();
    };

    el.tabBar.onclick = function (event) {
      var target = event.target || event.srcElement;
      var tab = target.getAttribute && target.getAttribute("data-tab");
      if (tab) showTab(tab);
    };

    // Named styles: save the current settings under a name, get a card that
    // selects them, and a small delete control on the card.
    el.saveStyleBtn.onclick = function () {
      if (!saveCustomStyle(el.customStyleName.value)) return;
      el.customStyleName.value = "";
    };
    el.customStyleName.onkeydown = function (event) {
      if (event && (event.key === "Enter" || event.keyCode === 13)) {
        if (!saveCustomStyle(el.customStyleName.value)) return;
        el.customStyleName.value = "";
      }
    };

    byId("loadSrtBtn").onclick = function () { el.srtFile.click(); };
    el.srtFile.onchange = function () {
      loadSrtFile(el.srtFile.files && el.srtFile.files[0]);
      el.srtFile.value = "";
    };
    byId("sampleBtn").onclick = function () {
      el.transcriptInput.value = SAMPLE_TEXT;
      state.asr.cues = null;
      state.asr.srt = "";
      updateStats();
    };
    byId("clearTextBtn").onclick = function () {
      el.transcriptInput.value = "";
      state.asr.cues = null;
      state.asr.srt = "";
      updateStats();
      setStatus("");
    };

    el.generateBtn.onclick = onGenerate;
    el.clearGeneratedBtn.onclick = onClearGenerated;
    el.refreshBtn.onclick = refresh;
    el.resetStyleBtn.onclick = resetStyle;

    refresh();

    // A seam for the headless checks: the storage round-trip is not reachable
    // through the UI without gestures a test cannot make.
    root.LcpPanel = {
      state: state,
      saveSession: saveSession,
      loadSession: loadSession,
      saveCustomStyle: saveCustomStyle,
      deleteCustomStyle: deleteCustomStyle,
      customStyles: function () { return state.customStyles; }
    };
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);