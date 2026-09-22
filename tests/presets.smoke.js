/**
 * Smoke test for client/presets.js
 *
 * The host script reads a fixed set of keys off the style object it is sent.
 * If resolveSettings() ever stops producing one of them, generation degrades
 * silently: a missing `motion` animates nothing, a missing `karaoke` builds one
 * plain layer instead of a highlighted phrase, and so on. This test pins that
 * contract for every preset.
 *
 * Run from the extension root:   node tests/presets.smoke.js
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var target = path.join(__dirname, "..", "client", "presets.js");
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(target, "utf8"), sandbox);

var P = sandbox.window.LcpPresets;

/** Every style key host/host.jsx reads. Keep in step with the host script. */
var HOST_KEYS = [
  "motion", "fontFamily", "fontSize", "bold", "fill", "filled", "applyStroke",
  "strokeColor", "strokeWidth", "applyShadow", "shadowColor", "shadowAmount",
  "applyGlow", "glowColor", "glowAmount",
  "tracking", "transform", "lines", "maxWords", "autoSpaceOutline",
  "align", "posX", "posY", "applyBox", "boxColor", "boxOpacity", "boxPadding",
  "emphasisWords", "emphasisAuto", "emphasisColor", "emphasisScale", "emphasisFamily", "linePadding", "fillOpacity", "emphasisOpacity",
  "wordByWord", "inDurMs", "outDurMs",
  "karaoke", "karaokeHighlight", "karaokeDim", "karaokePop"
];

/** Types the host relies on when it coerces each value. */
var EXPECTED_TYPE = {
  motion: "string",
  fontFamily: "string",
  align: "string",
  transform: "string",
  lines: "string",
  emphasisWords: "string",
  shadowColor: "string",
  glowColor: "string",
  bold: "boolean",
  filled: "boolean",
  applyStroke: "boolean",
  applyShadow: "boolean",
  applyGlow: "boolean",
  applyBox: "boolean",
  emphasisAuto: "boolean",
  wordByWord: "boolean",
  karaoke: "boolean",
  karaokePop: "boolean"
};

var failures = 0;
var checks = 0;

function check(label, condition, detail) {
  checks++;
  if (!condition) {
    failures++;
    console.log("  FAIL  " + label + (detail === undefined ? "" : "  -> " + detail));
  }
}

console.log("presets.js smoke test");
console.log("");

var presets = P.PRESETS;
console.log("presets: " + presets.length);
console.log("host keys pinned: " + HOST_KEYS.length);
console.log("");

for (var i = 0; i < presets.length; i++) {
  var preset = presets[i];
  var settings = P.resolveSettings(preset.id, {});

  for (var k = 0; k < HOST_KEYS.length; k++) {
    var key = HOST_KEYS[k];
    var value = settings[key];

    check(preset.id + ": " + key + " present",
      value !== undefined && value !== null,
      JSON.stringify(value));

    if (EXPECTED_TYPE[key]) {
      check(preset.id + ": " + key + " is " + EXPECTED_TYPE[key],
        typeof value === EXPECTED_TYPE[key],
        typeof value);
    }
  }

  // The preset's own motion must survive into the resolved settings.
  check(preset.id + ": motion resolves to the preset motion",
    settings.motion === preset.motion,
    settings.motion + " vs " + preset.motion);

  // Karaoke must reach the host as a flag, not just as a preview decoration.
  check(preset.id + ": karaoke flag matches the preset",
    settings.karaoke === !!preset.karaoke,
    String(settings.karaoke));

  // Word-by-word presets must ask for word timings.
  if (preset.forceWordByWord) {
    check(preset.id + ": wordByWord forced on", settings.wordByWord === true);
  }

  // Numbers must be usable by lcp_num().
  var numerics = ["fontSize", "strokeWidth", "tracking", "posX", "posY", "inDurMs", "outDurMs",
                  "boxOpacity", "boxPadding", "emphasisScale", "shadowAmount", "glowAmount", "maxWords"];
  for (var n = 0; n < numerics.length; n++) {
    check(preset.id + ": " + numerics[n] + " is numeric",
      typeof settings[numerics[n]] === "number" && isFinite(settings[numerics[n]]),
      String(settings[numerics[n]]));
  }

  // Enumerated values must stay inside what the host understands.
  check(preset.id + ": transform is known",
    ["none", "uppercase", "lowercase"].indexOf(settings.transform) >= 0,
    settings.transform);
  check(preset.id + ": lines is 1-3",
    ["1", "2", "3"].indexOf(String(settings.lines)) >= 0,
    String(settings.lines));
}

console.log("");
console.log("shipping defaults");
check("Anton is the default font", P.BASE_DEFAULTS.fontFamily === "Anton",
  P.BASE_DEFAULTS.fontFamily);
check("every preset starts on Anton",
  P.PRESETS.every(function (p) { return P.resolveSettings(p.id, {}).fontFamily === "Anton"; }));
check("the preset list starts with a usable id",
  P.PRESETS.some(function (p) { return p.id === "karaoke"; }));
check("bold is off by default", P.BASE_DEFAULTS.bold === false, String(P.BASE_DEFAULTS.bold));
check("every preset starts with bold off",
  P.PRESETS.every(function (p) { return P.resolveSettings(p.id, {}).bold === false; }),
  JSON.stringify(P.PRESETS.map(function (p) { return p.id + "=" + P.resolveSettings(p.id, {}).bold; })));

console.log("");
console.log("Reset to default relies on overrides not sticking");
var changed = P.resolveSettings("karaoke", { fontSize: 199, glowAmount: 90 });
var restored = P.resolveSettings("karaoke", {});
check("an override applies", changed.fontSize === 199 && changed.glowAmount === 90,
  changed.fontSize + " / " + changed.glowAmount);
check("an override does not leak into the preset",
  restored.fontSize !== 199 && restored.glowAmount !== 90,
  restored.fontSize + " / " + restored.glowAmount);
check("clearing overrides brings the shipped value back",
  restored.fontSize === P.getPreset("karaoke").defaults.fontSize,
  restored.fontSize + " vs " + P.getPreset("karaoke").defaults.fontSize);
check("one preset resetting does not touch another",
  P.resolveSettings("viral-pop", {}).fontSize === P.getPreset("viral-pop").defaults.fontSize);

console.log("");
console.log("caption length sits with the style, not the timing tab");
check("every preset defaults to 3 words per caption",
  P.PRESETS.every(function (p) {
    return P.resolveSettings(p.id, {}).maxWords === 3;
  }),
  JSON.stringify(P.PRESETS.map(function (p) { return P.resolveSettings(p.id, {}).maxWords; })));
check("maxWords is a style control", !!P.CONTROL_DEFS.maxWords);
check("the timing tab no longer carries it", !P.TIMING_DEFS.wordsPerCaption);
check("timing defaults no longer carry it",
  P.TIMING_DEFAULTS.wordsPerCaption === undefined);
var maxWordsOverride = P.resolveSettings("karaoke", { maxWords: 5 });
check("a per-style override still wins", maxWordsOverride.maxWords === 5,
  String(maxWordsOverride.maxWords));

console.log("");
console.log("power words");
var base = P.resolveSettings("viral-pop", {});
check("numbers are emphasised", P.isEmphasisWord("2024", base, true) === true);
check("prices are emphasised", P.isEmphasisWord("$1,200", base, true) === true);
check("shouted words are emphasised", P.isEmphasisWord("EVERYTHING", base, true) === true);
check("ordinary words are not", P.isEmphasisWord("changed", base, true) === false);
check("shouting is ignored in an all-caps caption",
  P.isEmphasisWord("EVERYTHING", base, false) === false);
check("explicit list matches whole words",
  P.isEmphasisWord("secret", P.resolveSettings("viral-pop", { emphasisWords: "secret, free" }), true) === true);
check("explicit list does not match part of a word",
  P.isEmphasisWord("secretly", P.resolveSettings("viral-pop", { emphasisWords: "secret" }), true) === false);
check("auto can be switched off",
  P.isEmphasisWord("2024", P.resolveSettings("viral-pop", { emphasisAuto: false }), true) === false);

var marked = P.markEmphasis([{ text: "this changed EVERYTHING in 2024", startMs: 0, endMs: 1000,
  words: [
    { text: "this", startMs: 0, endMs: 200 },
    { text: "changed", startMs: 200, endMs: 400 },
    { text: "EVERYTHING", startMs: 400, endMs: 800 },
    { text: "in", startMs: 800, endMs: 900 },
    { text: "2024", startMs: 900, endMs: 1000 }
  ] }], base);
var flags = [];
for (var f = 0; f < marked[0].words.length; f++) flags.push(!!marked[0].words[f].emphasis);
check("markEmphasis flags exactly the power words",
  JSON.stringify(flags) === JSON.stringify([false, false, true, false, true]),
  JSON.stringify(flags));

console.log("");
console.log("overrides still win");
var withOverride = P.resolveSettings("karaoke", { fontSize: 123, karaokeDim: "#123456" });
check("override applies", withOverride.fontSize === 123);
check("override keeps flags", withOverride.karaoke === true && withOverride.motion === "karaoke");

console.log("");
console.log("every preset is reachable by id");
for (var p = 0; p < presets.length; p++) {
  check("getPreset(" + presets[p].id + ")",
    P.getPreset(presets[p].id).id === presets[p].id);
}

console.log("");
check("every style offers the sentence split",
  P.PRESETS.every(function (p) { return (p.controls || []).indexOf("splitBySentence") >= 0; }),
  P.PRESETS.filter(function (p) { return (p.controls || []).indexOf("splitBySentence") < 0; })
    .map(function (p) { return p.id; }).join(", "));
check("every control explains itself in a tooltip",
  Object.keys(P.CONTROL_DEFS).every(function (k) { return typeof P.CONTROL_DEFS[k].help === "string" && P.CONTROL_DEFS[k].help.length > 12; }),
  Object.keys(P.CONTROL_DEFS).filter(function (k) { return !P.CONTROL_DEFS[k].help; }).join(", "));

console.log("the neon styles ship with a glow");

["neon", "neon-karaoke"].forEach(function (id) {
  var shipped = P.resolveSettings(id, {});
  check(id + " has a glow by default", shipped.applyGlow === true, String(shipped.applyGlow));
  check(id + " glows in a colour of its own",
    typeof shipped.glowColor === "string" && shipped.glowColor.length > 0, String(shipped.glowColor));
  check(id + " glows enough to see",
    shipped.glowAmount >= 25 && shipped.glowAmount <= 100, String(shipped.glowAmount));
});

console.log("");
console.log("");
console.log("the Power Word card");

var pwPreset = null;
for (var pwi = 0; pwi < P.PRESETS.length; pwi++) {
  if (P.PRESETS[pwi].id === "power-word") pwPreset = P.PRESETS[pwi];
}
check("the Power Word card exists", !!pwPreset);
if (pwPreset) {
  var pwSettings = P.resolveSettings("power-word", {});
  // The mechanism changed: the comp now draws a caption as one layer per line and
  // sizes the line that holds a power word, so word by word is no longer what makes
  // emphasis appear. This pins the shape the reference asks for instead.
  check("it asks for three lines, so the power word can have one to itself",
    String(pwSettings.lines) === "3", "lines = " + pwSettings.lines);
  check("and it is not word by word, which would lose the lines",
    pwSettings.wordByWord !== true, "wordByWord = " + pwSettings.wordByWord);
  check("the emphasis is size, not a second colour",
    String(pwSettings.emphasisColor).toLowerCase() === "#ffffff" && pwSettings.emphasisScale > 130,
    pwSettings.emphasisColor + " at " + pwSettings.emphasisScale + "%");
  check("its controls expose the emphasis keys",
    pwPreset.controls.indexOf("emphasisScale") >= 0 &&
    pwPreset.controls.indexOf("emphasisAuto") >= 0 &&
    pwPreset.controls.indexOf("emphasisWords") >= 0);
  check("and it keeps the house rule on bold", pwSettings.bold === false);
  check("it has a blurb and preview text, like every card",
    !!pwPreset.blurb && !!pwPreset.previewLine);
}
console.log('');
console.log('the random pick');

var randStyle = P.resolveSettings('power-word', {});
check('the card asks for the random pick', randStyle.emphasisRandom === true);
check('and not the automatic rules, so only the pick shows', randStyle.emphasisAuto === false, 'emphasisAuto = ' + randStyle.emphasisAuto);

var picked = P.markEmphasis([
  { text: 'because everything that I did myself', words: null },
  { text: 'the rain started just after midnight', words: null }
], randStyle);
check('one word is picked for each caption', picked[0].emphasis.length === 1 && picked[1].emphasis.length === 1, JSON.stringify([picked[0].emphasis, picked[1].emphasis]));

var again = P.markEmphasis([{ text: 'because everything that I did myself', words: null }], randStyle);
check('the same caption always picks the same word, so the preview cannot flicker', again[0].emphasis[0] === picked[0].emphasis[0], picked[0].emphasis[0] + ' vs ' + again[0].emphasis[0]);

check('the card lets the line count be changed, since that is its whole look', pwPreset.controls.indexOf('lines') >= 0);

check('the power word size can be pushed to 250%', /emphasisScale:[^}]*max: 250/.test(fs.readFileSync(path.join(__dirname, '..', 'client', 'presets.js'), 'utf8')));

check('the card can reach drop shadow and glow', pwPreset.controls.indexOf('applyShadow') >= 0 && pwPreset.controls.indexOf('applyGlow') >= 0);
check('the card can reach the padding slider', pwPreset.controls.indexOf('linePadding') >= 0);
check('and every style carries a padding value', typeof P.resolveSettings('karaoke', {}).linePadding === 'number', String(P.resolveSettings('karaoke', {}).linePadding));

check('the card can reach both opacities', pwPreset.controls.indexOf('fillOpacity') >= 0 && pwPreset.controls.indexOf('emphasisOpacity') >= 0);

if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " checks passed (" + presets.length +
  " presets x " + HOST_KEYS.length + " host keys)");
process.exit(0);
