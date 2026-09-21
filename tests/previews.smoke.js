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
var stageSource = source.slice(source.indexOf("function buildStage"), source.indexOf("function applyStageSettings"));

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

var sandbox = {
  document: {
    createElement: function () { return {}; }   // no canvas -> fontAvailable() returns true
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
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " preview checks passed");
process.exit(0);
