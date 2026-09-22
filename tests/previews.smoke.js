/**
 * Smoke test for client/previews.js
 *
 * Covers the PostScript-name to CSS-family mapping. That mapping is what decides
 * whether the panel's preview shows the font you picked or silently falls back -
 * which is exactly how the preview and the comp drift apart.
 *
 * Run from the extension root:   node tests/previews.smoke.js
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var source = fs.readFileSync(path.join(__dirname, "..", "client", "previews.js"), "utf8");
var fontsSource = fs.readFileSync(path.join(__dirname, "..", "client", "fonts.js"), "utf8");
// Both halves matter: the slice used to stop before applyStageSettings, so the
// function that draws the background bar was never executed by this suite - and a
// missing variable in it emptied the preview for Shorts Bar with every test green.
var stageSource = source.slice(source.indexOf("function withKaraokeMarker"),
                               source.indexOf("function applyStageSettings")) +
                  source.slice(source.indexOf("function applyStageSettings"));

// The real font list, as After Effects would report it. Notably without Anton,
// so the fallback can be exercised.
var FONT_RESPONSE = {
  ok: true,
  source: "app.fonts",
  fonts: [
    { family: "Arial", regularPS: "ArialMT", boldPS: "Arial-BoldMT" },
    { family: "Bebas Neue", regularPS: "BebasNeue-Regular", boldPS: "BebasNeue-Bold" },
    { family: "Barlow Condensed", regularPS: "BarlowCondensed-Regular", boldPS: "BarlowCondensed-Bold" },
    { family: "Montserrat", regularPS: "Montserrat-Regular", boldPS: "Montserrat-Bold" },
    { family: "Impact", regularPS: "Impact", boldPS: "Impact" },
    { family: "Segoe UI", regularPS: "SegoeUI", boldPS: "SegoeUI-Bold" },
    { family: "Times New Roman", regularPS: "TimesNewRomanPSMT", boldPS: "TimesNewRomanPS-BoldMT" }
  ]
};

function stubElement(tag) {
  var el = {
    tagName: tag || "div",
    className: "",
    style: {},
    textContent: "",
    children: [],
    attrs: {},
    setAttribute: function (k, v) { el.attrs[k] = v; },
    getAttribute: function (k) { return el.attrs[k] === undefined ? null : el.attrs[k]; },
    appendChild: function (c) { el.children.push(c); return c; },
    removeChild: function (c) { return c; },
    getElementsByClassName: function (name) {
      var found = [];
      (function walk(node) {
        for (var i = 0; i < (node.children || []).length; i++) {
          var child = node.children[i];
          if (String(child.className).split(/\s+/).indexOf(name) >= 0) found.push(child);
          walk(child);
        }
      })(el);
      return found;
    },
    querySelector: function () { return null; },
    addEventListener: function () {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }
  };
  el.style.setProperty = function (k, v) { el.style[k] = v; };
  el.style.getPropertyValue = function (k) { return el.style[k] === undefined ? "" : el.style[k]; };
  el.style.removeProperty = function (k) { delete el.style[k]; };
  return el;
}

var sandbox = {
  document: {
    // No getContext anywhere, so fontAvailable() keeps returning true, as the
    // existing font checks expect - but real enough to build a stage with.
    createElement: function (tag) { return stubElement(tag); },
    createTextNode: function (text) { return { nodeType: 3, textContent: String(text) }; }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fontsSource, sandbox);
vm.runInContext(source, sandbox);
sandbox.LcpFonts.load(function (fnName, arg, done) { done(FONT_RESPONSE); }, function () {});

var P = sandbox.LcpPreviews;

var failures = 0;
var checks = 0;

function check(label, condition, detail) {
  checks++;
  if (!condition) {
    failures++;
    console.log("  FAIL  " + label + (detail === undefined ? "" : "  -> " + detail));
  }
}
function eq(label, actual, expected) {
  check(label, actual === expected, "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

console.log("previews.js smoke test");
console.log("");

console.log("normalise");
eq("strips case and separators", P.normalizeName("Bebas Neue-Bold"), "bebasneuebold");
eq("handles null", P.normalizeName(null), "");

console.log("");
console.log("camel split");
eq("BebasNeue", P.camelSplit("BebasNeue"), "Bebas Neue");
eq("ArialMT", P.camelSplit("ArialMT"), "Arial MT");
eq("already spaced", P.camelSplit("Times New Roman"), "Times New Roman");
eq("hyphenated", P.camelSplit("Barlow-Condensed"), "Barlow Condensed");

console.log("");
console.log("PostScript name -> renderable family");
eq("ArialMT finds Arial", P.familyForPostScript("ArialMT"), "Arial");
eq("Arial-BoldMT finds Arial", P.familyForPostScript("Arial-BoldMT"), "Arial");
eq("BebasNeue-Bold finds Bebas Neue", P.familyForPostScript("BebasNeue-Bold"), "Bebas Neue");
eq("Montserrat-Black finds Montserrat", P.familyForPostScript("Montserrat-Black"), "Montserrat");
eq("BarlowCondensed-Medium finds the condensed family",
  P.familyForPostScript("BarlowCondensed-Medium"), "Barlow Condensed");
eq("exact family passes through", P.familyForPostScript("Impact"), "Impact");
eq("shortest prefix does not win over the longest",
  P.familyForPostScript("BarlowCondensedSemiBold"), "Barlow Condensed");

console.log("");
console.log("unknown names degrade to a readable guess, never to nothing");
var unknown = P.familyForPostScript("ZapfDingbatsITC");
check("returns a spaced name", unknown === "Zapf Dingbats ITC", unknown);
eq("empty input is safe", P.familyForPostScript(""), "Arial");
eq("null input is safe", P.familyForPostScript(null), "Arial");

console.log("");
check("outline width 0 draws nothing", P.strokePx(0, P.sizeFactor(236)) === 0);
check("the outline grows with the slider",
  P.strokePx(2, P.sizeFactor(236)) < P.strokePx(6, P.sizeFactor(236)) &&
  P.strokePx(6, P.sizeFactor(236)) < P.strokePx(12, P.sizeFactor(236)) &&
  P.strokePx(12, P.sizeFactor(236)) < P.strokePx(40, P.sizeFactor(236)),
  [2, 6, 12, 40].map(function (w) { return P.strokePx(w, P.sizeFactor(236)).toFixed(3); }).join(", "));
check("every width in the slider's useful range gives a different outline",
  (function () {
    var seen = {};
    for (var w = 0; w <= 40; w++) {
      var key = P.strokePx(w, P.sizeFactor(236)).toFixed(2);
      if (seen[key]) return false;
      seen[key] = true;
    }
    return true;
  })(),
  "the old rule pinned every width under 16 to 1px");
check("it uses the host's rule: width times factor",
  Math.abs(P.strokePx(12, P.sizeFactor(236)) - 12 * P.sizeFactor(236)) < 1e-9);
check("a missing width uses the shipped default",
  P.strokePx(undefined, P.sizeFactor(236)) === P.strokePx(6, P.sizeFactor(236)));
console.log("glow is shared, and visible at preview sizes");

check("no glow setting means no shadow",
  P.glowShadow(13, { applyGlow: false }) === "" && P.glowShadow(13, {}) === "");
check("a zero amount means no shadow",
  P.glowShadow(13, { applyGlow: true, glowAmount: 0 }) === "", P.glowShadow(13, { applyGlow: true, glowAmount: 0 }));
check("the halo carries the style's own colour",
  P.glowShadow(13, { applyGlow: true, glowAmount: 40, glowColor: "#1b2bff" }).indexOf("#1b2bff") >= 0,
  P.glowShadow(13, { applyGlow: true, glowAmount: 40, glowColor: "#1b2bff" }));
check("the halo is two shadows, near and far",
  (P.glowShadow(13, { applyGlow: true, glowAmount: 40, glowColor: "#fff" }).match(/0 0 /g) || []).length === 2);
check("a glow with no colour falls back to the fill",
  P.glowShadow(13, { applyGlow: true, glowAmount: 40, fill: "#8ef7ff" }).indexOf("#8ef7ff") >= 0);
check("the halo is wide enough to see at a 7px preview size",
  P.glowShadow(7, { applyGlow: true, glowAmount: 40, glowColor: "#fff" }).indexOf("0 0 5px") >= 0,
  P.glowShadow(7, { applyGlow: true, glowAmount: 40, glowColor: "#fff" }));
check("the stage and the cards both go through glowShadow",
  (source.match(/glowShadow\(/g) || []).length >= 3,
  (source.match(/glowShadow\(/g) || []).length + " uses");

console.log("");
console.log("the live stage measures itself after layout, not before");

check("the live stage re-applies its scale once it has been laid out",
  /requestAnimationFrame/.test(stageSource) &&
  /requestAnimationFrame\(function \(\) \{\s*\n\s*sizeStage\(stage, compWidth, compHeight, opts\.maxHeight\);/.test(stageSource));
check("buildStage measures after layout, and again when the width changes",
  (stageSource.match(/applyStageSettings\(/g) || []).length >= 3,
  (stageSource.match(/applyStageSettings\(/g) || []).length + " call(s)");
check("the stage watches its own width",
  /new root\.ResizeObserver/.test(stageSource));
check("it ignores a zero or unchanged width",
  /if \(!width \|\| width === lastWidth\) return;/.test(stageSource));
check("and re-fits and re-applies when the width really changes",
  /watch\.observe\(stage\)/.test(stageSource));
check("every pass re-fits the frame",
  (stageSource.match(/sizeStage\(/g) || []).length >= 3,
  (stageSource.match(/sizeStage\(/g) || []).length + " call(s)");
check("every pass reuses the same settings",
  (stageSource.match(/applyStageSettings\(stage, preset, settings, \{ compWidth: compWidth, compHeight: compHeight \}\);/g) || []).length >= 3,
  (stageSource.match(/applyStageSettings\(stage, preset, settings, \{ compWidth: compWidth, compHeight: compHeight \}\);/g) || []).length + " call(s)");

console.log("");
console.log("caption placement, shared by the stage and the cards");

check("centred: the box is centred on the position",
  JSON.stringify(P.captionPlacement({ posX: 50, posY: 76, align: "center" })) ===
  JSON.stringify({ align: "center", left: "50%", top: "76%", transform: "translate(-50%, -50%)" }),
  JSON.stringify(P.captionPlacement({ posX: 50, posY: 76, align: "center" })));
check("left: the left edge sits on the position",
  P.captionPlacement({ posX: 20, posY: 70, align: "left" }).transform === "translate(0, -50%)");
check("right: the right edge sits on the position",
  P.captionPlacement({ posX: 20, posY: 70, align: "right" }).transform === "translate(-100%, -50%)");
check("a nonsense alignment falls back to centred",
  P.captionPlacement({ align: "middle" }).align === "center");
check("missing values use the shipped defaults",
  P.captionPlacement({}).left === "50%" && P.captionPlacement({}).top === "78%",
  JSON.stringify(P.captionPlacement({})));
check("no settings at all does not throw",
  P.captionPlacement(null).align === "center");

check("the live stage places captions with it",
  /captionPlacement\(settings\)/.test(source) &&
  /anchor\.style\.transform = spot\.transform/.test(source));
console.log("");
console.log("the outline can only grow outward");

var outline = P.outlineShadow(10, "#1b2bff");
check("it is sixteen hard offsets and nothing blurred",
  (outline.match(/px /g) || []).length === 32 && !/ [1-9][\\d.]*px #/.test(outline), outline);
check("it carries the style's colour", outline.indexOf("#1b2bff") >= 0);
check("it reaches half the stroke width",
  (function () {
    var parts = outline.split(", ");
    var max = 0;
    parts.forEach(function (p) {
      var m = p.match(/^(-?[\d.]+)px (-?[\d.]+)px/);
      if (m) max = Math.max(max, Math.abs(parseFloat(m[1])), Math.abs(parseFloat(m[2])));
    });
    return Math.abs(max - 5) < 0.01;
  })(), outline);
check("it grows with the slider",
  P.outlineShadow(20, "#fff") !== P.outlineShadow(4, "#fff"));
check("it is symmetric, so the letters are never shifted",
  (function () {
    var sum = 0;
    P.outlineShadow(10, "#fff").split(", ").forEach(function (p) {
      var m = p.match(/^(-?[\d.]+)px (-?[\d.]+)px/);
      if (m) { sum += parseFloat(m[1]) + parseFloat(m[2]); }
    });
    return Math.abs(sum) < 0.01;
  })());
check("a zero width draws nothing",
  (P.outlineShadow(0, "#fff").match(/[1-9][\d.]*px/g) || []).length === 0, P.outlineShadow(0, "#fff"));
check("a filled caption never gets a centred stroke",
  !/webkitTextStroke = strokeWidthPx/.test(source) ||
  /outlineOnly/.test(source));
check("the outline is added to the shadow list before that list is applied",
  (function () {
    var add = source.indexOf("effects.unshift(outlineShadow(");
    var apply = source.indexOf("label.style.textShadow = effects.join");
    return add > 0 && apply > 0 && add < apply;
  })(),
  "it was unshifted after the list had already reached the element, so nothing showed");
check("the glow is pushed into the same list, not applied separately",
  (function () {
    var glow = source.indexOf("var glow = glowShadow(renderedSize, settings)");
    var push = source.indexOf("if (glow) effects.push(glow)");
    var apply = source.indexOf("label.style.textShadow = effects.join");
    return glow > 0 && push > glow && apply > push;
  })());
check("a filled caption uses the shadow outline, never a centred stroke",
  /outlineShadow\(strokeWidthPx/.test(source) &&
  /var outlineOnly = \(settings\.filled === false\)/.test(source));
check("the stroke rule is width times factor, with no floor",
  /function strokePx[\s\S]{0,320}return Math\.max\(0, width \* factor\);/.test(source));
check("the cards are centred by the stylesheet, not by script",
  !/label\.style\.(position|left|top|transform)\s*=/.test(source));
check("the stylesheet centres a card's caption",
  /align-items: center;[\s\S]{0,140}justify-content: center;/.test(
    fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8")));
check("a card keeps the stylesheet's readable size",
  !/function applyCardStyle[\s\S]{0,700}applyTextStyle/.test(source),
  "cards are a picker, so they do not scale type with the comp");
check("word-per-word cards animate their words, not just the line",
  /preset\.motion === "wordPunch"/.test(source) &&
  /word\.style\.animationName = "lcpWordPunch"/.test(source));
check("a card shows its preset's glow",
  /glowShadow\(CARD_TEXT_PX, settings\)/.test(source));
check("the cards wait for layout before scaling",
  /requestAnimationFrame\(function \(\) \{ applyCardStyle\(frame, preset\); \}\)/.test(source));

console.log("");
console.log("the caption keeps its share of the frame on any comp width");
// The host draws text at fontSize * compWidth/1920. A preview frame frameWidth
// wide must therefore put the same share of its own width into that text.
function frameShare(compWidth, frameWidth, fontSize) {
  return (fontSize * P.sizeFactor(frameWidth)) / frameWidth;
}
function compShare(compWidth, fontSize) {
  return (fontSize * (compWidth / 1920)) / compWidth;
}
[[1920, 1080], [1080, 1920], [3840, 2160], [720, 1280], [1440, 1080]].forEach(function (c) {
  var compWidth = c[0];
  var label = "comp " + c[0] + "x" + c[1];
  var same = Math.abs(frameShare(compWidth, 340, 84) - compShare(compWidth, 84)) < 1e-12;
  check(label + ": preview text holds the comp's share of the width", same,
    frameShare(compWidth, 340, 84) + " vs " + compShare(compWidth, 84));
  check(label + ": a wider preview frame keeps that share",
    Math.abs(frameShare(compWidth, 900, 84) - compShare(compWidth, 84)) < 1e-12);
});
check("a 1920-wide frame is 1:1 with the authoring reference",
  P.sizeFactor(1920) === 1, String(P.sizeFactor(1920)));
check("a 1080x1920 stage gets the 169px-wide frame's own factor",
  Math.abs(P.sizeFactor(169) - 169 / 1920) < 1e-12, String(P.sizeFactor(169)));
check("an unlaid-out stage falls back instead of producing NaN",
  P.sizeFactor(0) === P.FALLBACK_FRAME_WIDTH / 1920 && P.sizeFactor(undefined) === P.FALLBACK_FRAME_WIDTH / 1920);
// Counterfactual: the old factor was frameWidth/compWidth, which on a 1080 comp
// is 1920/1080 = 1.78x too large. This is the bug that was reported.
var oldFactorShare = function (compWidth, frameWidth, fontSize) {
  return (fontSize * (frameWidth / compWidth)) / frameWidth;
};
var ratio = oldFactorShare(1080, 169, 84) / compShare(1080, 84);
check("the old formula was 1920/1080 too large on a 1080-wide comp",
  Math.abs(ratio - 1920 / 1080) < 1e-9, ratio.toFixed(4) + "x");
check("the old formula was not wrong on a 1920-wide comp",
  Math.abs(oldFactorShare(1920, 169, 84) / compShare(1920, 84) - 1) < 1e-9);

console.log("");
console.log("in and out animation lengths drive the preview cycle");
check("a longer In gives a longer cycle",
  P.motionCycleMs(1200, 180) > P.motionCycleMs(250, 180),
  P.motionCycleMs(1200, 180) + " vs " + P.motionCycleMs(250, 180));
check("a longer Out gives a longer cycle",
  P.motionCycleMs(250, 1200) > P.motionCycleMs(250, 180),
  P.motionCycleMs(250, 1200) + " vs " + P.motionCycleMs(250, 180));
check("both at maximum is the slowest",
  P.motionCycleMs(1200, 1200) > P.motionCycleMs(1200, 180) &&
  P.motionCycleMs(1200, 1200) > P.motionCycleMs(250, 1200));
check("the cycle never collapses below a third of a second",
  P.motionCycleMs(0, 0) >= 300, String(P.motionCycleMs(0, 0)));
check("missing values use the defaults",
  P.motionCycleMs(undefined, undefined) === P.motionCycleMs(250, 180));

console.log("");
console.log("glow geometry responds to the amount slider");
var g0 = P.glowRadii(13, 0);
var g50 = P.glowRadii(13, 50);
var g100 = P.glowRadii(13, 100);
check("near grows with the amount", g0.near < g50.near && g50.near < g100.near,
  JSON.stringify([g0.near, g50.near, g100.near]));
check("far grows with the amount", g0.far < g50.far && g50.far < g100.far,
  JSON.stringify([g0.far, g50.far, g100.far]));
check("near never exceeds far", g100.near <= g100.far, g100.near + " vs " + g100.far);
check("a small preview still gets a visible halo", g0.far >= 5, String(g0.far));
check("a bigger preview gets a bigger halo", P.glowRadii(33, 50).far > g50.far,
  P.glowRadii(33, 50).far + " vs " + g50.far);
check("a missing amount uses the default",
  P.glowRadii(20, undefined).far === P.glowRadii(20, 40).far);

console.log("");
console.log("resolution status is reported, not assumed");
var resolved = P.resolvePreviewFont("BebasNeue-Bold");
eq("family resolved", resolved.family, "Bebas Neue");
check("an installed font is marked ok", resolved.ok === true);
check("status text names the font", P.fontStatusText("Arial-BoldMT").indexOf("Arial") >= 0);

console.log("");
console.log("a missing font falls back to Arial, in the preview and the comp alike");
var missingAnton = P.resolvePreviewFont("Anton");
eq("falls back to Arial", missingAnton.family, "Arial");
check("is marked not ok", missingAnton.ok === false);
eq("records what was missing", missingAnton.missing, "Anton");
eq("remembers what was asked for", missingAnton.requested, "Anton");
check("the status line says so", P.fontStatusText("Anton").indexOf("Arial") >= 0 &&
  P.fontStatusText("Anton").indexOf("not installed") >= 0, P.fontStatusText("Anton"));

var installedAnton = P.resolvePreviewFont("Arial-BoldMT");
check("an installed font is not swapped out", installedAnton.family !== "Arial" ? false : installedAnton.ok === true);

console.log("");
console.log("");
console.log("every style draws its stage, including the bar");

// This suite never loaded the preset table; bind it, because the styles are what
// decide which drawing paths exist - the background bar only exists for some.
var presetsSource = fs.readFileSync(path.join(__dirname, "..", "client", "presets.js"), "utf8");
vm.runInContext(presetsSource, sandbox);
var PRESETS = sandbox.LcpPresets.PRESETS;
var BASE_DEFAULTS = sandbox.LcpPresets.BASE_DEFAULTS;

// Enough of an element for the drawing code: applyTextStyle sets attributes and
// class names, and the bar path reads and writes styles.
// The karaoke styles set a CSS variable for the highlight, so style needs the
// property methods, not just the camelCase fields.
function fakeStyle() {
  var s = {};
  s.setProperty = function (k, v) { s[k] = v; };
  s.getPropertyValue = function (k) { return s[k] === undefined ? "" : s[k]; };
  s.removeProperty = function (k) { delete s[k]; };
  return s;
}

function fakeElement(cls) {
  var el = {
    className: cls || "",
    style: fakeStyle(),
    textContent: "",
    innerHTML: "",
    children: [],
    attrs: {},
    setAttribute: function (k, v) { el.attrs[k] = v; },
    getAttribute: function (k) { return el.attrs[k] === undefined ? null : el.attrs[k]; },
    removeAttribute: function (k) { delete el.attrs[k]; },
    appendChild: function (child) { el.children.push(child); return child; },
    removeChild: function (child) { return child; },
    getElementsByClassName: function (name) {
      var found = [];
      (function walk(node) {
        for (var i = 0; i < (node.children || []).length; i++) {
          var child = node.children[i];
          if (String(child.className).split(/\s+/).indexOf(name) >= 0) found.push(child);
          walk(child);
        }
      })(el);
      return found;
    },
    querySelector: function () { return null; },
    addEventListener: function () {},
    classList: {
      add: function () {}, remove: function () {},
      toggle: function () {}, contains: function () { return false; }
    }
  };
  return el;
}

function fakeStage() {
  var frame = fakeElement("pv");
  var anchor = fakeElement("stage-anchor");
  var label = fakeElement("pv-text");
  var map = { "pv": frame, "stage-anchor": anchor, "pv-text": label };
  var stage = { clientWidth: 236 };
  stage.getElementsByClassName = function (name) { return map[name] ? [map[name]] : []; };
  return { stage: stage, frame: frame, anchor: anchor, label: label };
}

function settingsFor(preset, boxOn) {
  var out = {};
  var key;
  for (key in BASE_DEFAULTS) { if (BASE_DEFAULTS.hasOwnProperty(key)) out[key] = BASE_DEFAULTS[key]; }
  var defaults = (preset && preset.defaults) || {};
  for (key in defaults) { if (defaults.hasOwnProperty(key)) out[key] = defaults[key]; }
  if (boxOn) out.applyBox = true;
  return out;
}

var threw = [];
PRESETS.forEach(function (preset) {
  var f = fakeStage();
  try {
    P.applyStageSettings(f.stage, preset, settingsFor(preset, true), {});
  } catch (err) {
    threw.push(preset.name + " (" + err.message + ")");
  }
});
check("every style draws its stage with a bar, without throwing",
  threw.length === 0, threw.join(" | "));

var bar = fakeStage();
P.applyStageSettings(bar.stage, { motion: "popIn" },
  settingsFor({ defaults: { applyBox: true, boxPadding: 24, boxOpacity: 80, boxColor: "#101010" } }, true), {});
check("the bar is actually drawn", !!(bar.anchor.style.background && bar.anchor.style.padding),
  "background=" + bar.anchor.style.background + " padding=" + bar.anchor.style.padding);
check("and cleared again when the style has no bar",
  (function () {
    var f = fakeStage();
    P.applyStageSettings(f.stage, { motion: "popIn" }, settingsFor({ defaults: {} }, false), {});
    return f.anchor.style.background === "" && f.anchor.style.padding === "";
  })());
console.log("");
console.log("the stage shows what the comp would build");

function stageLabel(settings, words) {
  var preset = { id: "probe", name: "probe", motion: "popIn", previewLine: "sample line" };
  var s = P.buildStage(preset, settings, {
    disableMedia: true,
    compWidth: 1080, compHeight: 1920,
    caption: { text: "Dolly writes now", words: words }
  });
  var anchor = s.getElementsByClassName("stage-anchor")[0];
  return anchor ? anchor.children[0] : null;
}

function spanCount(label) {
  var n = 0;
  for (var i = 0; i < (label.children || []).length; i++) {
    if (label.children[i].className === "pv-word") n++;
  }
  return n;
}

var words = [{ text: "Dolly" }, { text: "writes" }, { text: "now" }];

var plain = stageLabel({ karaoke: false, wordByWord: false }, words);
check("a plain caption draws the whole line", /Dolly writes now/.test(plain.textContent),
  JSON.stringify(plain.textContent));

var karaokeLabel = stageLabel({ karaoke: true, wordByWord: false }, words);
check("karaoke marks the line so words are lit",
  /pv-karaoke-words/.test(karaokeLabel.className), JSON.stringify(karaokeLabel.className));
check("karaoke keeps every word, so the phrase stays readable",
  spanCount(karaokeLabel) === 3, "spans: " + spanCount(karaokeLabel));

var wordLabel = stageLabel({ karaoke: false, wordByWord: true }, words);
check("word by word shows one word, as the comp does",
  spanCount(wordLabel) === 1, "spans: " + spanCount(wordLabel));
check("and it is the first word of the caption",
  wordLabel.children.length === 1 && /Dolly/.test(wordLabel.children[0].textContent),
  JSON.stringify(wordLabel.children.map(function (c) { return c.textContent; })));

var bothLabel = stageLabel({ karaoke: true, wordByWord: true }, words);
check("karaoke wins when both are on, since the phrase is the karaoke look",
  spanCount(bothLabel) === 3 && /pv-karaoke-words/.test(bothLabel.className),
  "spans: " + spanCount(bothLabel));
console.log("");
console.log("the stage shows the power word, whatever the mode");

var pwStage = P.buildStage({ id: "probe", name: "probe", motion: "popIn", previewLine: "sample line" },
  { karaoke: false, wordByWord: false, emphasisColor: "#f57f7f", emphasisScale: 200, fontSize: 150 },
  { disableMedia: true, compWidth: 1080, compHeight: 1920,
    caption: { text: "dolly parton writes", words: [{ text: "dolly" }, { text: "parton" }, { text: "writes" }], emphasis: [1] } });
var pwAnchor = pwStage.getElementsByClassName("stage-anchor")[0];
var pwLabel = pwAnchor ? pwAnchor.children[0] : null;
var spans = pwLabel ? (pwLabel.children || []) : [];
// The splitter gives the spaces their own spans so the words can be positioned, so this
// counts words rather than spans.
check("a caption with a marked power word is split into words",
  spans.length >= 3, "spans: " + spans.length);
var markedSpan = null;
for (var s = 0; s < spans.length; s++) { if (String(spans[s].textContent).indexOf("parton") >= 0) markedSpan = spans[s]; }
check("and the marked word is coloured and enlarged",
  !!markedSpan && String(markedSpan.style.color).indexOf("245, 127, 127") >= 0 && !!markedSpan.style.fontSize,
  markedSpan ? (markedSpan.style.color + " at " + markedSpan.style.fontSize) : "not found");
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " preview checks passed");
process.exit(0);
