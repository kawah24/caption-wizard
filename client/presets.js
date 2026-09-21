/**
 * Caption Wizard - built-in style presets.
 *
 * A preset is data only: which controls it exposes, the defaults for those
 * controls, and the motion profile the host script converts into keyframes.
 *
 * Motion profiles understood by host/host.jsx:
 *   none | slideUp | slideDown | slideLeft | slideRight | popIn | zoomPunch
 *   blurFade | cinematic | flickerOut | pulse | karaoke | wordPunch | neon
 */
(function (root) {
  "use strict";

  /** Every control the panel can render. Types: font | select | range | toggle | color | text. */
  var CONTROL_DEFS = {
    fontFamily: {
      label: "Font",
      // Rendered by client/fonts.js: a filter box over a select populated from
      // the fonts After Effects reports through app.fonts.
      type: "font"
    },
    fontSize: { label: "Size", type: "range", min: 12, max: 300, step: 1, unit: "px" },
    bold: { label: "Bold", type: "toggle" },
    fill: { label: "Text colour", type: "color" },
    filled: { label: "Filled text", type: "toggle" },
    applyStroke: { label: "Outline", type: "toggle" },
    strokeColor: { label: "Outline colour", type: "color", dependsOn: "applyStroke" },
    strokeWidth: { label: "Outline width", type: "range", min: 1, max: 40, step: 1, unit: "px", dependsOn: "applyStroke" },
    applyShadow: { label: "Drop shadow", type: "toggle" },
    shadowColor: { label: "Shadow colour", type: "color", dependsOn: "applyShadow" },
    shadowAmount: { label: "Shadow amount", type: "range", min: 0, max: 100, step: 5, unit: "%", dependsOn: "applyShadow" },
    applyGlow: { label: "Glow", type: "toggle" },
    glowColor: { label: "Glow colour", type: "color", dependsOn: "applyGlow" },
    glowAmount: { label: "Glow amount", type: "range", min: 0, max: 100, step: 5, unit: "%", dependsOn: "applyGlow" },
    tracking: { label: "Letter spacing", type: "range", min: -50, max: 400, step: 5, unit: "1/1000 em" },
    transform: {
      label: "Case",
      type: "select",
      options: [
        { value: "none", label: "As Typed" },
        { value: "uppercase", label: "UPPERCASE" },
        { value: "lowercase", label: "lowercase" }
      ]
    },
    lines: {
      label: "Lines per caption",
      type: "select",
      options: [
        { value: "1", label: "single line" },
        { value: "2", label: "double line" },
        { value: "3", label: "triple line" }
      ]
    },
    maxWords: { label: "Max words per caption", type: "range", min: 1, max: 14, step: 1 },
    splitBySentence: { label: "Split captions by sentence", type: "toggle" },
    autoSpaceOutline: { label: "Auto-space for outline", type: "toggle" },
    align: { label: "Align", type: "select", options: ["left", "center", "right"] },
    posX: { label: "Horizontal", type: "range", min: 0, max: 100, step: 1, unit: "%" },
    posY: { label: "Vertical", type: "range", min: 0, max: 100, step: 1, unit: "%" },
    applyBox: { label: "Background bar", type: "toggle" },
    boxColor: { label: "Bar colour", type: "color", dependsOn: "applyBox" },
    boxOpacity: { label: "Bar opacity", type: "range", min: 0, max: 100, step: 5, unit: "%", dependsOn: "applyBox" },
    boxPadding: { label: "Bar padding", type: "range", min: 0, max: 80, step: 2, unit: "px", dependsOn: "applyBox" },
    // A third way to choose: one word a caption, by hashing the caption's own text.
    // Not a random number generator, because the preview rebuilds the plan on every
    // repaint and a fresh pick each time would make it flicker while the comp sat still.
    emphasisRandom: { label: "Pick the power word at random", type: "toggle" },

    emphasisWords: { label: "Power words (comma separated)", type: "text" },    emphasisAuto: { label: "Auto: numbers and SHOUTED words", type: "toggle" },
    emphasisColor: { label: "Power word colour", type: "color" },
    emphasisScale: { label: "Power word size", type: "range", min: 100, max: 150, step: 2, unit: "%" },
    wordByWord: { label: "One word at a time", type: "toggle" },
    karaokeHighlight: { label: "Highlight", type: "color" },
    karaokeDim: { label: "Base words", type: "color" },
    karaokePop: { label: "Pop the spoken word", type: "toggle" },
    inDurMs: { label: "In animation", type: "range", min: 0, max: 1200, step: 10, unit: "ms" },
    outDurMs: { label: "Out animation", type: "range", min: 0, max: 1200, step: 10, unit: "ms" }
  };

  /** Shared timing controls (rendered on the Timing tab, not per style). */
  var TIMING_DEFS = {
    wpm: { label: "Reading speed", type: "range", min: 80, max: 320, step: 5, unit: "wpm" },
    gapMs: { label: "Gap between captions", type: "range", min: 0, max: 600, step: 10, unit: "ms" },
    offsetMs: { label: "Offset", type: "range", min: -3000, max: 3000, step: 50, unit: "ms" }
  };

  var BASE_DEFAULTS = {
    fontFamily: "Anton",
    fontSize: 150,
    bold: false,
    fill: "#ffffff",
    filled: true,
    applyStroke: true,
    strokeColor: "#000000",
    strokeWidth: 6,
    applyShadow: false,
    shadowColor: "#000000",
    shadowAmount: 55,
    applyGlow: false,
    glowColor: "#ffffff",
    glowAmount: 40,
    tracking: 0,
    transform: "none",
    lines: "1",
    maxWords: 3,
    splitBySentence: false,
    autoSpaceOutline: true,
    align: "center",
    posX: 50,
    posY: 78,
    applyBox: false,
    boxColor: "#000000",
    boxOpacity: 70,
    boxPadding: 18,
    emphasisWords: "",
    emphasisAuto: true,
    emphasisColor: "#ffd400",
    emphasisScale: 110,
    wordByWord: false,
    karaoke: false,
    karaokeHighlight: "#ffd400",
    karaokeDim: "#9a9a9a",
    karaokePop: true,
    inDurMs: 250,
    outDurMs: 180
  };

  var TIMING_DEFAULTS = {
    wpm: 165,
    gapMs: 80,
    offsetMs: 0
  };

  /**
   * One line per timing control, shown as a tooltip on its row.
   *
   * Stamped onto TIMING_DEFS below, the same way CONTROL_HELP is stamped onto
   * CONTROL_DEFS - the timing controls were the only ones left without help.
   */
  var TIMING_HELP = {
    wpm: "How fast the captions read, in words per minute. It lays out plain lines only - a cue with its own timecodes keeps them.",
    gapMs: "The pause left between captions on plain lines. Cues with timecodes keep their own gaps instead.",
    offsetMs: "Shifts every caption earlier or later. Set automatically to a comp layer's start time when the audio comes from that layer, so a clip that does not begin at zero lines up."
  };

  /** Everything except the background bar, for clean minimal looks. */
  /**
   * One line per control, shown as a tooltip on its row.
   *
   * Kept together rather than beside each control: the wording stays in one voice,
   * and one missing entry is easy to spot instead of hidden among forty.
   */
  var CONTROL_HELP = {
    fontFamily: "The typeface. The list is what After Effects can see.",
    fontSize: "Caption size. Sizes are authored against a 1920px-wide comp, then scaled to yours.",
    bold: "A bolder weight, where the font has one. Some fonts offer only a single weight.",
    fill: "Colour of the letters.",
    filled: "Off draws hollow letters with the outline only.",
    applyStroke: "Draw an outline around the letters.",
    strokeColor: "Colour of the outline.",
    strokeWidth: "Outline thickness. A heavy outline eats into the space between letters.",
    applyShadow: "Draw a drop shadow behind the caption.",
    shadowColor: "Colour of the drop shadow.",
    shadowAmount: "How strong the drop shadow is.",
    applyGlow: "Draw a halo behind the caption.",
    glowColor: "Colour of the halo.",
    glowAmount: "How far the halo reaches. With Glow on, the caption costs one extra layer each.",
    tracking: "Space between letters, in 1/1000 em.",
    transform: "Force upper case, lower case, or leave the words as typed.",
    lines: "How many lines a caption may wrap to. This is a maximum, not a target.",
    maxWords: "Most words in one caption before the next one starts.",
    splitBySentence: "Also break captions at sentence ends, so a caption ends where a sentence does.",
    autoSpaceOutline: "Widen the spacing to keep a heavy outline from closing the letters up.",
    align: "Which side the caption grows from, measured at the Horizontal position.",
    posX: "Horizontal position, as a percentage of the comp width.",
    posY: "Vertical position, as a percentage of the comp height.",
    applyBox: "Draw a bar behind the caption.",
    boxColor: "Colour of the bar.",
    boxOpacity: "How solid the bar is.",
    boxPadding: "Space between the words and the edge of the bar.",
    emphasisRandom: "Choose one word in each caption without listing any, so the emphasis moves around rather than repeating the same rule.",

    emphasisWords: "Words to hit harder, separated by commas. Leave empty to use the automatic list.",
    emphasisAuto: "Emphasise the words a caption usually leans on, without listing them yourself.",
    emphasisColor: "Colour given to emphasised words.",
    emphasisScale: "How much larger emphasised words are drawn.",
    wordByWord: "Give every word its own layer instead of one per caption. Costs many more layers.",
    karaoke: "Keep the whole phrase on screen and light up each word as it is spoken.",
    karaokeHighlight: "Colour of the word being spoken.",
    karaokeDim: "Colour of the words around it.",
    karaokePop: "Give the spoken word a small pop as it lands.",
    inDurMs: "How long the caption takes to arrive.",
    outDurMs: "How long it takes to leave."
  };

  for (var helpKey in CONTROL_HELP) {
    if (CONTROL_HELP.hasOwnProperty(helpKey) && CONTROL_DEFS[helpKey]) {
      CONTROL_DEFS[helpKey].help = CONTROL_HELP[helpKey];
    }
  }

  for (var timingHelpKey in TIMING_HELP) {
    if (TIMING_HELP.hasOwnProperty(timingHelpKey) && TIMING_DEFS[timingHelpKey]) {
      TIMING_DEFS[timingHelpKey].help = TIMING_HELP[timingHelpKey];
    }
  }
  var PLAIN_CONTROLS = [
    "fontFamily", "fontSize", "bold", "fill", "filled", "applyStroke", "strokeColor",
    "strokeWidth", "applyShadow", "shadowColor", "shadowAmount", "applyGlow", "glowColor", "glowAmount",
    "tracking", "transform", "lines", "maxWords", "splitBySentence", "autoSpaceOutline", "align", "posX", "posY",
    "inDurMs", "outDurMs"
  ];

  /**
   * Word-at-a-time looks additionally expose the power-word controls, because
   * only they create per-word layers that can carry a separate colour and size.
   * They do not expose Max words: every word is already its own layer.
   */
  var WORD_CONTROLS = [
    "fontFamily", "fontSize", "bold", "fill", "filled", "applyStroke", "strokeColor",
    "strokeWidth", "applyShadow", "shadowColor", "shadowAmount", "applyGlow", "glowColor", "glowAmount",
    "tracking", "transform", "align", "posX", "posY", "splitBySentence", "autoSpaceOutline",
    "emphasisRandom", "emphasisWords", "emphasisAuto", "emphasisColor", "emphasisScale",
    "inDurMs", "outDurMs"
  ];

  var PRESETS = [
    {
      id: "karaoke",
      name: "Karaoke",
      blurb: "The whole phrase stays on screen and the spoken word lights up.",
      motion: "karaoke",
      karaoke: true,
      previewWords: ["Read", "along", "now"],
      controls: ["fontFamily", "fontSize", "bold", "karaokeHighlight", "karaokeDim", "karaokePop",
                 "applyStroke", "strokeColor", "strokeWidth",
                 "applyShadow", "shadowColor", "shadowAmount", "applyGlow", "glowColor", "glowAmount",
                 "tracking", "transform", "maxWords", "splitBySentence", "autoSpaceOutline", "align", "posX", "posY", "inDurMs", "outDurMs"],
      defaults: {
        fontSize: 150, karaokeHighlight: "#ff6fa5", karaokeDim: "#ffffff", karaokePop: true,
        strokeColor: "#000000", strokeWidth: 8, transform: "uppercase", posY: 76,
        applyGlow: false, glowColor: "#ff6fa5", glowAmount: 35,
        inDurMs: 200, outDurMs: 200
      }
    },
    {
      id: "neon",
      name: "Neon Outline",
      blurb: "Bright fill with a heavy coloured outline and a halo.",
      motion: "neon",
      previewLine: "Neon glow",
      controls: PLAIN_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#8ef7ff", strokeColor: "#1b2bff", strokeWidth: 12,
        transform: "uppercase", applyGlow: true, glowColor: "#1b2bff", glowAmount: 40,
        inDurMs: 300, outDurMs: 220
      }
    },
    {
      id: "neon-karaoke",
      name: "Neon Karaoke",
      blurb: "Neon outline that lights up each spoken word, karaoke style.",
      motion: "karaoke",
      karaoke: true,
      previewWords: ["Neon", "words", "glow"],
      controls: ["fontFamily", "fontSize", "bold", "karaokeHighlight", "karaokeDim", "karaokePop",
                 "applyStroke", "strokeColor", "strokeWidth",
                 "applyShadow", "shadowColor", "shadowAmount", "applyGlow", "glowColor", "glowAmount",
                 "tracking", "transform", "maxWords", "splitBySentence", "autoSpaceOutline", "align", "posX", "posY", "inDurMs", "outDurMs"],
      defaults: {
        fontSize: 150, karaokeHighlight: "#ff4df0", karaokeDim: "#8ef7ff", karaokePop: true,
        strokeColor: "#1b2bff", strokeWidth: 12, transform: "uppercase", posY: 76,
        applyGlow: true, glowColor: "#1b2bff", glowAmount: 40,
        inDurMs: 300, outDurMs: 220
      }
    },
    {
      id: "basic",
      name: "Basic",
      blurb: "Static caption, no motion. The safe default.",
      motion: "none",
      previewLine: "Clean and simple",
      controls: ["fontFamily", "fontSize", "bold", "fill", "applyStroke", "strokeColor",
                 "strokeWidth", "applyShadow", "shadowColor", "shadowAmount", "applyGlow", "glowColor", "glowAmount",
                 "tracking", "transform", "lines", "maxWords", "splitBySentence", "autoSpaceOutline", "align", "posX", "posY"],
      defaults: { fontSize: 150, posY: 80, strokeWidth: 5 }
    },
    {
      id: "slide-up",
      name: "Slide Up",
      blurb: "Rises into place, fades on the way out.",
      motion: "slideUp",
      previewLine: "Sliding in",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, posY: 76, inDurMs: 320, outDurMs: 200 }
    },
    {
      id: "slide-down",
      name: "Slide Down",
      blurb: "Drops in from above.",
      motion: "slideDown",
      previewLine: "Dropping in",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, posY: 30, inDurMs: 320, outDurMs: 200 }
    },
    {
      id: "slide-left",
      name: "Slide Left",
      blurb: "Enters from the right, exits to the left.",
      motion: "slideLeft",
      previewLine: "From the right",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, inDurMs: 300, outDurMs: 200 }
    },
    {
      id: "slide-right",
      name: "Slide Right",
      blurb: "Enters from the left.",
      motion: "slideRight",
      previewLine: "From the left",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, inDurMs: 300, outDurMs: 200 }
    },
    {
      id: "pop-in",
      name: "Pop In",
      blurb: "Snaps up to size with a small overshoot.",
      motion: "popIn",
      previewLine: "Pop!",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, fill: "#ffe14d", strokeWidth: 8, inDurMs: 240, outDurMs: 140 }
    },
    {
      id: "viral-pop",
      name: "Viral Pop",
      blurb: "One word at a time, hard and loud. The shorts look.",
      motion: "wordPunch",
      previewWords: ["THIS", "changed", "EVERYTHING"],
      controls: WORD_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#ffffff", strokeColor: "#000000", strokeWidth: 16,
        applyShadow: true, transform: "uppercase", tracking: 10, posY: 72,
        emphasisAuto: true, emphasisColor: "#ffd400", emphasisScale: 118,
        wordByWord: true, inDurMs: 90, outDurMs: 60
      },
      forceWordByWord: true
    },
    {
      id: "shorts-box",
      name: "Shorts Bar",
      blurb: "Boxed captions with a solid bar behind the line.",
      motion: "popIn",
      previewLine: "boxed caption",
      controls: ["fontFamily", "fontSize", "bold", "fill", "applyStroke", "strokeColor",
                 "strokeWidth", "applyShadow", "tracking", "transform", "lines", "align", "posX", "posY", "splitBySentence", "autoSpaceOutline",
                 "applyBox", "boxColor", "boxOpacity", "boxPadding"],
      defaults: {
        fontSize: 150, fill: "#ffffff", applyStroke: false, applyBox: true,
        boxColor: "#101010", boxOpacity: 80, boxPadding: 24, transform: "uppercase",
        lines: "2", posY: 74, inDurMs: 200, outDurMs: 140
      }
    },
    {
      id: "zoom-punch",
      name: "Zoom Punch",
      blurb: "Slam in from large and settle hard.",
      motion: "zoomPunch",
      previewLine: "SLAM",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, fill: "#ffffff", strokeWidth: 9, transform: "uppercase", inDurMs: 200, outDurMs: 120 }
    },
    {
      id: "blur-fade",
      name: "Blur Fade",
      blurb: "Soft opacity fade with a gentle scale settle.",
      motion: "blurFade",
      previewLine: "Soft focus",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, inDurMs: 420, outDurMs: 340 }
    },
    {
      id: "cinematic",
      name: "Cinematic",
      blurb: "Wide letter spacing and a slow drift. Documentary feel.",
      motion: "cinematic",
      previewLine: "A slow drift",
      controls: PLAIN_CONTROLS,
      defaults: {
        fontSize: 150, bold: false, tracking: 120, fill: "#f2f2f2",
        applyStroke: false, posY: 84, transform: "uppercase", inDurMs: 600, outDurMs: 600
      }
    },
    {
      id: "flicker-out",
      name: "Flicker Out",
      blurb: "Holds, then stutters out like a failing lamp.",
      motion: "flickerOut",
      previewLine: "Flickering",
      controls: PLAIN_CONTROLS,
      defaults: { fontSize: 150, strokeWidth: 7, inDurMs: 200, outDurMs: 400 }
    },
    {
      id: "pulse",
      name: "Pulse",
      blurb: "Breathes on the beat while it holds.",
      motion: "pulse",
      previewLine: "On the beat",
      controls: PLAIN_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#7ef0c2", strokeWidth: 7, transform: "uppercase",
        tracking: 40, inDurMs: 220, outDurMs: 200
      }
    },
    {
      id: "tiktok-classic",
      name: "TikTok Classic",
      blurb: "Heavy, uppercase, centred low. Built for vertical video.",
      motion: "popIn",
      previewLine: "WATCH THIS",
      controls: PLAIN_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#ffffff", strokeColor: "#000000", strokeWidth: 12,
        transform: "uppercase", posY: 74, inDurMs: 200, outDurMs: 140
      }
    },
    {
      id: "motivation",
      name: "Motivation",
      blurb: "Uppercase rise with a hot accent colour.",
      motion: "slideUp",
      previewLine: "KEEP GOING",
      controls: PLAIN_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#ff3b30", strokeColor: "#ffffff", strokeWidth: 8,
        transform: "uppercase", posY: 60, inDurMs: 300, outDurMs: 220
      }
    },
    {
      id: "word-punch",
      name: "Word Punch",
      blurb: "One word on screen at a time, hard cut per word.",
      motion: "wordPunch",
      previewLine: "One word",
      controls: WORD_CONTROLS,
      defaults: {
        fontSize: 150, fill: "#ffffff", strokeWidth: 8, transform: "uppercase",
        wordByWord: true, inDurMs: 120, outDurMs: 80
      },
      forceWordByWord: true
    },
    {
      id: "outline-only",
      name: "Outline Only",
      blurb: "Unfilled text: outline only, nothing inside.",
      motion: "none",
      previewLine: "HOLLOW",
      controls: ["fontFamily", "fontSize", "bold", "applyStroke", "strokeColor", "strokeWidth",
                 "tracking", "transform", "lines", "maxWords", "splitBySentence", "autoSpaceOutline", "align", "posX", "posY"],
      defaults: {
        fontSize: 150, filled: false, applyStroke: true, strokeColor: "#ffffff",
        strokeWidth: 6, transform: "uppercase", tracking: 20
      }
    },
    {
      id: "power-word",
      name: "Power Word",
      blurb: "Quiet lines, with the word that matters drawn much larger.",
      motion: "popIn",
      previewLine: "I did",
      // The emphasis keys are not in PLAIN_CONTROLS: this card exists for them.
      controls: ["fontFamily", "fontSize", "bold", "fill", "applyStroke", "strokeColor",
                 "strokeWidth", "tracking", "transform", "lines", "maxWords", "splitBySentence",
                 "align", "posX", "posY",
                 "emphasisRandom", "emphasisWords", "emphasisAuto", "emphasisColor", "emphasisScale"],
      defaults: {
        // Bold is left off, like every other card: the weight in the reference is
        // the font doing its job, and a preset that forces bold fights the picker.
        fontSize: 150, fill: "#ffffff",
        applyStroke: false, applyShadow: false, transform: "none", posY: 50,
        // Three lines, and one layer per line in the comp: the line holding the power
        // word is drawn with the emphasis style, which is how the reference gets a
        // larger word without a second font size inside one text document.
        lines: "3",
        emphasisRandom: true, emphasisAuto: false, emphasisWords: "",
        // Bigger and heavier, not a second colour - that is the look being copied.
        emphasisColor: "#ffffff", emphasisScale: 148,
        inDurMs: 200, outDurMs: 150
      }
    }
  ];

  function getPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return PRESETS[0];
  }

  /** Merge caller overrides on top of base defaults and the preset's own. */
  function resolveSettings(presetId, overrides) {
    var preset = getPreset(presetId);
    var out = {};
    var key;

    for (key in BASE_DEFAULTS) {
      if (BASE_DEFAULTS.hasOwnProperty(key)) out[key] = BASE_DEFAULTS[key];
    }
    for (key in preset.defaults) {
      if (preset.defaults.hasOwnProperty(key)) out[key] = preset.defaults[key];
    }

    // Top-level preset fields that the host script reads. These are not part of
    // `defaults`, and forgetting them silently degrades every generated layer:
    // a missing `motion` makes the host animate nothing, and a missing
    // `karaoke` makes it build one plain layer instead of a highlighted phrase.
    if (preset.motion) out.motion = preset.motion;
    if (preset.karaoke) out.karaoke = true;
    if (preset.forceWordByWord) out.wordByWord = true;

    if (overrides) {
      for (key in overrides) {
        if (overrides.hasOwnProperty(key) && overrides[key] !== undefined && overrides[key] !== null) {
          out[key] = overrides[key];
        }
      }
      // Older saved overrides used a boolean `uppercase`.
      if (overrides.uppercase !== undefined && out.transform === BASE_DEFAULTS.transform) {
        out.transform = overrides.uppercase ? "uppercase" : "none";
      }
    }
    return out;
  }

  /** Controls a preset exposes that are rendered on the Style tab. */
  function controlsFor(presetId) {
    return getPreset(presetId).controls;
  }

  /**
   * Is this word a power word?
   *
   * One implementation, used by the panel to mark words in the payload and by
   * the preview to colour them, so the two can never disagree. The host script
   * only has to honour the flag it is sent.
   */
  /** A small, stable hash, so a caption always picks the same word. */
  function emphasisHash(text) {
    var h = 0;
    var i;
    for (i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) % 1000003;
    }
    return h;
  }

  function isEmphasisWord(word, settings, allowShouted) {
    var text = String(word === null || word === undefined ? "" : word)
      .replace(/^[^\w\d]+|[^\w\d]+$/g, "");
    if (!text) return false;

    var list = String((settings && settings.emphasisWords) || "");
    if (list) {
      var parts = list.split(",");
      for (var i = 0; i < parts.length; i++) {
        var candidate = parts[i].replace(/^\s+|\s+$/g, "");
        if (candidate && candidate.toLowerCase() === text.toLowerCase()) return true;
      }
    }

    if (settings && settings.emphasisAuto === false) return false;

    if (/[0-9]/.test(text)) return true;
    if (allowShouted !== false && text.length > 2 &&
        text === text.toUpperCase() && /[A-Z]/.test(text)) {
      return true;
    }
    return false;
  }

  /** Flag power words across a planned caption list. */
  function markEmphasis(captions, settings) {
    if (!captions) return captions;
    var i;
    var w;

    for (i = 0; i < captions.length; i++) {
      var caption = captions[i];
      // The power words are decided from the caption's text, so they exist whether or not
      // the caption carries word timings.
      var plainWords = String(caption.text || "").split(/\s+/);
      var marks = [];
      var w2;
      if (settings && settings.emphasisRandom) {
        // One word, picked by hashing the caption. The same caption always chooses the
        // same word, so what the preview shows is what the host builds.
        var candidates = [];
        for (w2 = 0; w2 < plainWords.length; w2++) {
          var bare = String(plainWords[w2] || "").replace(/^[^\w\d]+|[^\w\d]+$/g, "");
          if (bare.length > 3) candidates.push(w2);
        }
        if (!candidates.length) {
          for (w2 = 0; w2 < plainWords.length; w2++) {
            if (plainWords[w2]) candidates.push(w2);
          }
        }
        if (candidates.length) {
          marks.push(candidates[emphasisHash(String(caption.text || "")) % candidates.length]);
        }
      } else {
        var shout = false;
        for (w2 = 0; w2 < plainWords.length; w2++) {
          var probe = String(plainWords[w2] || "");
          if (probe && probe !== probe.toUpperCase()) { shout = true; break; }
        }
        for (w2 = 0; w2 < plainWords.length; w2++) {
          if (plainWords[w2] && isEmphasisWord(plainWords[w2], settings, shout)) marks.push(w2);
        }
      }
      caption.emphasis = marks;

      if (!caption.words || !caption.words.length) continue;

      // If every word is already shouted, shouting is not a signal - otherwise
      // an all-caps transcript would highlight every single word.
      var allowShouted = false;
      for (w = 0; w < caption.words.length; w++) {
        var raw = String(caption.words[w].text || "");
        if (raw !== raw.toUpperCase()) { allowShouted = true; break; }
      }

      for (w = 0; w < caption.words.length; w++) {
        caption.words[w].emphasis = isEmphasisWord(caption.words[w].text, settings, allowShouted);
      }
    }

    return captions;
  }

  root.LcpPresets = {
    CONTROL_DEFS: CONTROL_DEFS,
    TIMING_DEFS: TIMING_DEFS,
    BASE_DEFAULTS: BASE_DEFAULTS,
    TIMING_DEFAULTS: TIMING_DEFAULTS,
    PRESETS: PRESETS,
    getPreset: getPreset,
    resolveSettings: resolveSettings,
    controlsFor: controlsFor,
    isEmphasisWord: isEmphasisWord,
    markEmphasis: markEmphasis
  };
})(window);
