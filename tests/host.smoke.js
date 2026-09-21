/**
 * Smoke test for host/host.jsx
 *
 * The host script cannot run without After Effects, but its pure helpers can:
 * this loads the real file into a VM and calls them directly. That covers the
 * font enumeration shape (the API returns an Array of Arrays), the text case
 * and line-break helpers, and the colour parser.
 *
 * Run from the extension root:   node tests/host.smoke.js
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var previewModule = { document: { createElement: function () { return {}; } } };
previewModule.window = previewModule;
vm.createContext(previewModule);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "client", "fonts.js"), "utf8"), previewModule);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "client", "previews.js"), "utf8"), previewModule);
var lcpPreview = previewModule.LcpPreviews;
var hostPath = path.join(__dirname, "..", "host", "host.jsx");
var sandbox = { app: null };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(hostPath, "utf8"), sandbox);

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

/** The enumeration caches, so each case starts from a clean slate. */
function reset() {
  sandbox._lcpFontFamilies = null;
}

function font(family, style, ps, substitute) {
  return {
    familyName: family,
    styleName: style,
    postScriptName: ps,
    isSubstitute: !!substitute
  };
}

console.log("host.jsx smoke test");
console.log("");

console.log("font enumeration: documented shape (Array of Arrays)");
sandbox.app = {
  fonts: {
    allFonts: [
      [font("Arial", "Regular", "ArialMT"), font("Arial", "Bold", "Arial-BoldMT")],
      [font("Impact", "Regular", "Impact")]
    ]
  }
};
reset();
var list = sandbox.lcp_enumerateFonts();
check("returns a list", !!list && list.length === 2, list ? list.length : list);
eq("sorted by family", list[0].family, "Arial");
eq("bold PostScript name", list[0].boldPS, "Arial-BoldMT");
eq("regular PostScript name", list[0].regularPS, "ArialMT");
eq("single-style family serves both roles", list[1].regularPS, "Impact");
eq("single-style family bold too", list[1].boldPS, "Impact");

console.log("");
console.log("font enumeration: defensive shapes");
sandbox.app = { fonts: { allFonts: [font("Verdana", "Regular", "Verdana")] } };
reset();
var flat = sandbox.lcp_enumerateFonts();
check("a flat array of Font objects still works", !!flat && flat.length === 1, flat ? flat.length : flat);
eq("family read from a bare object", flat ? flat[0].family : null, "Verdana");

sandbox.app = { fonts: { allFonts: [[font("Georgia", "Regular", "Georgia"), font("Georgia", "Italic", "Georgia-Italic")]] } };
reset();
var italicOnly = sandbox.lcp_enumerateFonts();
eq("italics are not chosen as the bold face", italicOnly[0].boldPS, "Georgia");

console.log("");
console.log("font enumeration: awkward cases");
sandbox.app = {
  fonts: {
    allFonts: [
      [font("Roboto", "Light Italic", "Roboto-LightItalic")],
      [font("Arial", "Regular", "ArialMT"), font("Arial", "Bold Italic", "Arial-BoldItalicMT")],
      [font("Missing Font", "Regular", "MissingFont", true)]
    ]
  }
};
reset();
var awkward = sandbox.lcp_enumerateFonts();
var byFamily = {};
for (var a = 0; a < awkward.length; a++) byFamily[awkward[a].family] = awkward[a];

eq("substituted fonts are dropped", awkward.length, 2);
check("odd-style family is kept", !!byFamily.Roboto);
eq("odd-style family resolves to its only face",
  byFamily.Roboto ? byFamily.Roboto.regularPS : null, "Roboto-LightItalic");
eq("bold-italic is not used as the bold face",
  byFamily.Arial ? byFamily.Arial.boldPS : null, "ArialMT");

sandbox.app = { fonts: { allFonts: [] } };
reset();
eq("empty font environment returns null", sandbox.lcp_enumerateFonts(), null);
sandbox.app = {};
reset();
eq("AE without a fonts object returns null", sandbox.lcp_enumerateFonts(), null);

sandbox.app = { fonts: { allFonts: [[font("Arial", "Regular", "ArialMT")]] } };
reset();
var shape = sandbox.lcp_fontShape();
check("shape probe describes the API", typeof shape === "string" && shape.indexOf("groups=1") >= 0, shape);

console.log("");
console.log("font resolution");
reset();
eq("known family + bold", sandbox.lcp_resolvePostScriptName("Arial", true), "ArialMT");
eq("unknown family falls back to the built-in table", sandbox.lcp_resolvePostScriptName("No Such Font", false), "ArialMT");

console.log("");
console.log("text case");
eq("uppercase", sandbox.lcp_applyCase("hello there", { transform: "uppercase" }), "HELLO THERE");
eq("lowercase", sandbox.lcp_applyCase("Hello There", { transform: "lowercase" }), "hello there");
eq("as typed", sandbox.lcp_applyCase("Hello There", { transform: "none" }), "Hello There");
eq("missing setting is as typed", sandbox.lcp_applyCase("Hello", {}), "Hello");
eq("null input is safe", sandbox.lcp_applyCase(null, { transform: "uppercase" }), "");

console.log("");
console.log("line breaks");
eq("single line is untouched", sandbox.lcp_splitLines("one two three", "1"), "one two three");
eq("two lines splits in half", sandbox.lcp_splitLines("one two three four", "2"), "one two\rthree four");
eq("three lines over six words", sandbox.lcp_splitLines("a b c d e f", "3"), "a b\rc d\re f");
eq("three lines over four words spreads 2/1/1", sandbox.lcp_splitLines("a b c d", "3"), "a b\rc\rd");
eq("three lines over seven words spreads 3/2/2", sandbox.lcp_splitLines("a b c d e f g", "3"), "a b c\rd e\rf g");
eq("more lines than words puts one word per line", sandbox.lcp_splitLines("a b", "3"), "a\rb");
eq("single word is untouched", sandbox.lcp_splitLines("alone", "2"), "alone");
eq("extra whitespace is normalised", sandbox.lcp_splitLines("a   b  c d", "2"), "a b\rc d");

console.log("");
console.log("colours");
eq("white", JSON.stringify(sandbox.lcp_hexToRgb("#ffffff")), JSON.stringify([1, 1, 1]));
eq("black", JSON.stringify(sandbox.lcp_hexToRgb("#000000")), JSON.stringify([0, 0, 0]));
eq("red", JSON.stringify(sandbox.lcp_hexToRgb("#ff0000")), JSON.stringify([1, 0, 0]));
eq("short form", JSON.stringify(sandbox.lcp_hexToRgb("#0f0")), JSON.stringify([0, 1, 0]));
eq("junk falls back to white", JSON.stringify(sandbox.lcp_hexToRgb("not a colour")), JSON.stringify([1, 1, 1]));

console.log("");
console.log("auto caption source: which layer to transcribe");

function FakeAVLayer(name, filePath, hasAudio, startTime) {
  this.name = name;
  this.hasAudio = !!hasAudio;
  this.startTime = startTime || 0;
  this.inPoint = 0;
  this.outPoint = 10;
  this.index = 1;
  this.source = { file: { fsName: filePath, toString: function () { return filePath; } } };
}
function FakeLayerNoSource(name) {
  this.name = name;
  this.source = null;
}

var AVLayer = FakeAVLayer;
sandbox.AVLayer = AVLayer;

function fakeComp(layers, selectedIndexes) {
  var selected = [];
  for (var s = 0; s < (selectedIndexes || []).length; s++) {
    selected.push(layers[selectedIndexes[s] - 1]);
  }
  return {
    numLayers: layers.length,
    selectedLayers: selected,
    layer: function (i) { return layers[i - 1]; }
  };
}

var videoWithAudio = new FakeAVLayer("video.mp4", "C:\\media\\video.mp4", true, 2.5);
var silentVideo = new FakeAVLayer("silent.mov", "C:\\media\\silent.mov", false, 0);
var noSource = new FakeLayerNoSource("shape layer");

// No comp at all.
eq("no comp -> nothing picked", sandbox.lcp_pickMediaLayer(null), null);

// Nothing with a file.
eq("a comp with no media picks nothing",
  sandbox.lcp_pickMediaLayer(fakeComp([noSource])), null);

eq("a non-AV layer is skipped",
  sandbox.lcp_pickMediaLayer(fakeComp([noSource, silentVideo])) === silentVideo, true);

// Prefers audio.
var prefersAudio = sandbox.lcp_pickMediaLayer(fakeComp([silentVideo, videoWithAudio]));
check("prefers a layer that has audio", prefersAudio === videoWithAudio,
  prefersAudio ? prefersAudio.name : "null");

// A selected layer wins when it has audio.
var selectedWins = sandbox.lcp_pickMediaLayer(fakeComp([videoWithAudio, new FakeAVLayer("b.mp4", "C:\\b.mp4", true, 0)], [2]));
check("a selected audio layer wins", selectedWins.name === "b.mp4", selectedWins.name);

// A selected layer without audio does not win over the rest.
var silentSelected = sandbox.lcp_pickMediaLayer(fakeComp([videoWithAudio, silentVideo], [2]));
check("a selected silent layer falls back to audio", silentSelected === videoWithAudio,
  silentSelected.name);

// Falls back to the first file when nothing has audio.
var noAudioAnywhere = sandbox.lcp_pickMediaLayer(fakeComp([silentVideo, new FakeAVLayer("c.mp4", "C:\\c.mp4", false, 0)]));
check("falls back to the first file", noAudioAnywhere === silentVideo, noAudioAnywhere.name);

console.log("");
console.log("line breaking matches the panel preview");
// The preview and the host must divide a caption identically, or what you judge
// in the panel is not what lands in the comp.
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "client", "transcript.js"), "utf8"), sandbox);
var T = sandbox.LcpTranscript;

var splitCases = ["one two three four", "Dolly Parton writes", "a b c d e f g", "a b", "alone", "one two three four five", ""];
var splitLimits = [["1", "6"], ["2", "3"], ["3", "6"], ["3", "3"], ["3", "12"], ["3", ""]];
for (var ci = 0; ci < splitCases.length; ci++) {
  for (var li = 0; li < splitLimits.length; li++) {
    var lines = splitLimits[li][0];
    var max = splitLimits[li][1];
    var hostLines = sandbox.lcp_splitLines(splitCases[ci], lines, max).split("\r");
    var previewLines = T.splitIntoLines(splitCases[ci], lines, max);
    check("same division for " + JSON.stringify(splitCases[ci]) + " at " + lines +
      " line(s) / " + (max === "" ? "no limit" : max + " words"),
      hostLines.join("|") === previewLines.join("|"),
      hostLines.join("|") + "  vs  " + previewLines.join("|"));
  }
}

console.log("");
console.log("numbers");
eq("parses numeric strings", sandbox.lcp_num("42", 7), 42);
eq("uses the fallback for junk", sandbox.lcp_num("junk", 7), 7);
eq("uses the fallback for undefined", sandbox.lcp_num(undefined, 7), 7);

/* ------------------------------------------------------------------ */
/* generating: how many layers, and what replacing does                 */
/*                                                                     */
/* lcp_create and lcp_clear need a composition, so these run them against */
/* a fake one. Only what the host actually touches is stubbed - enough  */
/* to pin the layer arithmetic without After Effects.                   */
/* ------------------------------------------------------------------ */

sandbox.CompItem = function CompItem() {};
sandbox.ParagraphJustification = { LEFT_JUSTIFY: 1, CENTER_JUSTIFY: 2, RIGHT_JUSTIFY: 3, FULL_JUSTIFY_LASTLINE_LEFT: 4 };

function fakeCreateComp(width, height, duration) {
  var layers = [];

  function textDocument() {
    return {
      resetCharStyle: function () {},
      font: "ArialMT",
      fontSize: 72,
      fillColor: [1, 1, 1],
      strokeColor: [0, 0, 0]
    };
  }

  function add(text) {
    var doc = textDocument();
    var props = {};
    var layer = {
      name: String(text),
      comment: "",
      inPoint: 0,
      outPoint: 1,
      startTime: 0,
      containingComp: comp,
      _doc: doc,
      _positions: [],
      property: function (name) {
        if (name === "Source Text") {
          return {
            get value() { return doc; },
            setValue: function (next) { doc = next; },
            setValueAtTime: function (time, next) { doc = next; }
          };
        }
        if (name === "Position") {
          if (!props[name]) {
            props[name] = {
              numProperties: 0,
              property: function () { return null; },
              setValue: function (value) { layer._positions.push(value); },
              setValueAtTime: function (time, value) { layer._positions.push(value); }
            };
          }
          return props[name];
        }
        if (name === "Effects") {
          return {
            numProperties: 0,
            property: function () { return null; },
            addProperty: function (effectName) {
              comp._effects.push(effectName);
              var effectProps = {};
              return {
                matchName: effectName,
                property: function (propName) {
                  if (!effectProps[propName]) {
                    effectProps[propName] = {
                      setValue: function (value) {
                        comp._glowProps[effectName + "." + propName] = value;
                      }
                    };
                  }
                  return effectProps[propName];
                },
                remove: function () {}
              };
            }
          };
        }
        if (!props[name]) {
          props[name] = {
            numProperties: 0,
            property: function () { return null; },
            setValue: function () {},
            setValueAtTime: function () {}
          };
        }
        return props[name];
      },
      duplicate: function () {
        // After Effects copies the layer's properties, keyframes included - which
        // is what makes the karaoke glow backdrop follow its word.
        var copy = add(layer.name);
        copy._positions = layer._positions.slice(0);
        copy.comment = layer.comment;
        return copy;
      },
      moveAfter: function () {},
      remove: function () {
        var at = layers.indexOf(layer);
        if (at >= 0) layers.splice(at, 1);
      },
      sourceRectAtTime: function () {
        // Models After Effects: the anchor is at the text's origin, so the box
        // starts above it (top is negative) and is 40 tall.
        return { left: 0, top: -30, width: String(text).length * 10, height: 40 };
      }
    };
    layers.push(layer);
    return layer;
  }

  var comp = Object.create(sandbox.CompItem.prototype);
  comp.width = width;
  comp.height = height;
  comp.duration = duration;
  comp._effects = [];
  comp._glowProps = {};
  comp.effectsAdded = function () { return comp._effects.slice(0); };
  comp.glowProps = function () { return comp._glowProps; };
  Object.defineProperty(comp, "numLayers", { get: function () { return layers.length; } });
  comp.layer = function (index) { return layers[index - 1]; };
  comp.layers = { addText: function (text) { return add(text); } };
  comp.addUntagged = function (text) { return add(text); };
  comp.allLayers = function () { return layers.slice(0); };
  comp.taggedLayers = function () {
    return layers.filter(function (l) { return String(l.comment).indexOf("LCP::created") === 0; });
  };
  return comp;
}

function baseStyle(overrides) {
  var style = {
    motion: "none",
    fontSize: 72,
    fill: "#ffffff",
    karaoke: false,
    wordByWord: false,
    applyGlow: false,
    applyShadow: false,
    applyStroke: false,
    applyBox: false,
    karaokeDim: "#ffffff",
    karaokeHighlight: "#ffd400",
    posX: 50,
    posY: 78,
    inDurMs: 200,
    outDurMs: 150
  };
  for (var key in overrides) { style[key] = overrides[key]; }
  return style;
}

/** Run lcp_create against a comp, with the app stub it needs. */
function runCreate(comp, captions, style, replacePrevious) {
  sandbox.app = {
    project: { activeItem: comp },
    beginUndoGroup: function () {},
    endUndoGroup: function () {},
    fonts: { allFonts: [] }
  };
  return JSON.parse(sandbox.lcp_create(JSON.stringify({
    captions: captions,
    style: style,
    replacePrevious: !!replacePrevious
  })));
}

/** One caption with per-word timings, the way the panel sends it. */
function phrase(text, startMs, endMs) {
  var parts = text.split(" ");
  var span = (endMs - startMs) / parts.length;
  return {
    text: text,
    startMs: startMs,
    endMs: endMs,
    words: parts.map(function (word, index) {
      return {
        text: word,
        startMs: Math.round(startMs + index * span),
        endMs: Math.round(startMs + (index + 1) * span)
      };
    })
  };
}

console.log("");
console.log("generating layers: counts and replacing");

var two = [phrase("Dolly writes", 0, 1000), phrase("always love", 1000, 2000)];

var karaokeOff = fakeCreateComp(1080, 1920, 10);
var offResult = runCreate(karaokeOff, two, baseStyle({ karaoke: true }), true);
eq("karaoke, glow off: one layer per word", offResult.created, 4);
eq("karaoke, glow off: all text", offResult.text, 4);
eq("karaoke, glow off: no backdrops", offResult.backdrops, 0);
eq("karaoke, glow off: the comp holds exactly that", karaokeOff.numLayers, 4);
eq("karaoke, glow off: no probe layer left behind", karaokeOff.numLayers, 4);

var karaokeOn = fakeCreateComp(1080, 1920, 10);
var onResult = runCreate(karaokeOn, two, baseStyle({ karaoke: true, applyGlow: true }), true);
eq("karaoke, glow on: a backdrop behind every word", onResult.backdrops, 4);
eq("karaoke, glow on: text layers unchanged", onResult.text, 4);
eq("karaoke, glow on: created counts both", onResult.created, 8);
eq("karaoke, glow on: the comp really holds both", karaokeOn.numLayers, 8);
eq("karaoke, glow on: backdrops are tagged for clearing", karaokeOn.taggedLayers().length, 8);

var wordByWordComp = fakeCreateComp(1920, 1080, 10);
var wordByWordResult = runCreate(wordByWordComp, two, baseStyle({ wordByWord: true }), true);
eq("word by word: one layer per word", wordByWordResult.created, 4);

var perCaptionComp = fakeCreateComp(1920, 1080, 10);
var perCaptionResult = runCreate(perCaptionComp, two, baseStyle({}), true);
eq("one layer per caption: one layer per caption", perCaptionResult.created, 2);

var replaceComp = fakeCreateComp(1920, 1080, 10);
runCreate(replaceComp, two, baseStyle({}), true);
var secondRun = runCreate(replaceComp, two, baseStyle({}), true);
eq("replacing: reports what it removed", secondRun.removed, 2);
eq("replacing: the comp is not stacked", replaceComp.numLayers, 2);

var stackComp = fakeCreateComp(1920, 1080, 10);
runCreate(stackComp, two, baseStyle({}), false);
runCreate(stackComp, two, baseStyle({}), false);
eq("without replacing: layers stack", stackComp.numLayers, 4);

var mixedComp = fakeCreateComp(1920, 1080, 10);
mixedComp.addUntagged("my own title");
runCreate(mixedComp, two, baseStyle({}), true);
sandbox.app = {
  project: { activeItem: mixedComp },
  beginUndoGroup: function () {},
  endUndoGroup: function () {},
  fonts: { allFonts: [] }
};
var cleared = JSON.parse(sandbox.lcp_clear());
eq("clear: removes the generated layers", cleared.removed, 2);
eq("clear: leaves untagged layers alone", mixedComp.numLayers, 1);
eq("clear: the survivor is the user's layer", mixedComp.allLayers()[0].name, "my own title");

console.log("");
console.log("karaoke layout: the phrase follows Align, and every word follows the phrase");

function karaokePositions(align, posX) {
  var comp = fakeCreateComp(1080, 1920, 10);
  var caption = phrase("Dolly Parton writes", 0, 2000);
  runCreate(comp, [caption], baseStyle({ karaoke: true, align: align, posX: posX }), true);
  var layers = comp.allLayers();
  return {
    xs: layers.map(function (l) { return l._positions[0][0]; }),
    ys: layers.map(function (l) { return l._positions[0][1]; }),
    widths: layers.map(function (l) { return String(l.name).length * 10; }),
    leftJustified: layers.every(function (l) { return l._doc.justification === 1; })
  };
}

var anchor = 1080 * 0.5;
var centred = karaokePositions("center", 50);
var left = karaokePositions("left", 50);
var right = karaokePositions("right", 50);

check("karaoke words are always left-justified in the comp", centred.leftJustified,
  "so a position value is the word's left edge");
check("centred: the phrase straddles the horizontal position",
  Math.abs((centred.xs[0] + centred.xs[2] + centred.widths[2]) / 2 - anchor) < 0.001,
  (centred.xs[0] + centred.xs[2] + centred.widths[2]) / 2 + " vs " + anchor);
check("left: the phrase starts on the horizontal position",
  Math.abs(left.xs[0] - anchor) < 0.001, left.xs[0] + " vs " + anchor);
check("right: the phrase ends on the horizontal position",
  Math.abs(right.xs[2] + right.widths[2] - anchor) < 0.001,
  (right.xs[2] + right.widths[2]) + " vs " + anchor);
check("align moves the phrase without changing its length",
  Math.abs((centred.xs[2] + centred.widths[2] - centred.xs[0]) -
           (right.xs[2] + right.widths[2] - right.xs[0])) < 0.001);
check("word order is preserved", centred.xs[0] < centred.xs[1] && centred.xs[1] < centred.xs[2],
  centred.xs.join(", "));
check("words keep their spacing on screen",
  Math.abs((centred.xs[1] - centred.xs[0]) - (centred.widths[0] + 10)) < 0.001,
  (centred.xs[1] - centred.xs[0]) + " for a word " + centred.widths[0] + " wide");

// The fake reports a 40-tall box whose top is 30 above the anchor, so its centre
// is 10 below the anchor. The layer has to move down by that much for the text's
// box to sit on the requested position, which is where the preview draws it.
check("karaoke words centre their own box on the vertical position",
  centred.ys.every(function (y) { return Math.abs(y - (1920 * 0.78 + 10)) < 0.001; }),
  centred.ys.join(", ") + " vs " + (1920 * 0.78 + 10));

var settledComp = fakeCreateComp(1920, 1080, 10);
runCreate(settledComp, two, baseStyle({ motion: "slideUp" }), true);
var settledLayer = settledComp.allLayers()[0];
var settled = settledLayer._positions[settledLayer._positions.length - 1];
check("a plain caption settles with its box centred on the vertical position",
  Math.abs(settled[1] - (1080 * 0.78 + 10)) < 0.001, settled[1] + " vs " + (1080 * 0.78 + 10));

console.log("");
console.log("the host reports where it actually put the caption");

var placedComp = fakeCreateComp(1920, 1080, 10);
var placed = runCreate(placedComp, two, baseStyle({}), true);
check("the result carries a placement", !!placed.placement);
check("the placement matches the Vertical setting",
  Math.abs(placed.placement.fraction - 0.78) < 1e-6, String(placed.placement.fraction));
check("it reports the text offset it applied",
  Math.abs(placed.placement.textOffsetY - (-10)) < 0.001, String(placed.placement.textOffsetY));
check("the layer position is that offset away from the requested position",
  Math.abs(placed.placement.layerY - (1080 * 0.78 + 10)) < 0.001, String(placed.placement.layerY));
check("the reported comp height is the comp's own",
  placed.placement.compHeight === 1080, String(placed.placement.compHeight));
check("the reported comp size follows the authoring scale",
  Math.abs(placed.placement.fontDrawnPx - placed.placement.fontSetting * (placed.placement.compWidth / 1920)) < 0.001,
  placed.placement.fontDrawnPx + " vs " + (placed.placement.fontSetting * placed.placement.compWidth / 1920));
check("it names the font face it asked After Effects for",
  typeof placed.placement.fontFace === "string" && placed.placement.fontFace.length > 0,
  String(placed.placement.fontFace));

// The invariant that matters: whatever the frame size, the caption takes the same
// share of it in the preview as in the comp. This is the comparison the panel now
// prints as numbers, so it is asserted here rather than left to the eye.
var compShare = (150 * (1080 / 1920)) / 1080;
var previewShare = (150 * lcpPreview.sizeFactor(236)) / 236;
check("preview and comp draw the caption at the same share of the frame",
  Math.abs(compShare - previewShare) < 1e-12, compShare + " vs " + previewShare);
check("a portrait comp previews at 236px wide at the current cap",
  Math.round(420 * 1080 / 1920) === 236, String(Math.round(420 * 1080 / 1920)));

sandbox.app = {
  project: { activeItem: placedComp },
  beginUndoGroup: function () {},
  endUndoGroup: function () {},
  fonts: { allFonts: [] }
};
var compInfo = JSON.parse(sandbox.lcp_compInfo());
check("the comp info counts the layers this panel made",
  compInfo.generated === placedComp.numLayers, compInfo.generated + " vs " + placedComp.numLayers);
check("and still reports the comp's total layer count",
  compInfo.layers === placedComp.numLayers, String(compInfo.layers));

console.log("");
console.log("every preset positions its layers (this is what caught the neon bug)");

var presetSandbox = { window: {} };
vm.createContext(presetSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "client", "presets.js"), "utf8"), presetSandbox);
var lcpPresets = presetSandbox.window.LcpPresets;

var unpositioned = [];
var misplaced = [];
var motionsSeen = {};

lcpPresets.PRESETS.forEach(function (preset) {
  var comp = fakeCreateComp(1080, 1920, 10);
  var settings = lcpPresets.resolveSettings(preset.id, {}, lcpPresets.TIMING_DEFAULTS);
  motionsSeen[String(settings.motion)] = true;

  runCreate(comp, [phrase("Dolly writes now", 0, 2000)], settings, true);

  // The fake reports a box whose centre sits 10px below the anchor, so a layer
  // that is placed correctly ends up 10px past the requested position.
  var wantY = (lcpPresets.BASE_DEFAULTS.posY === undefined ? 78 : settings.posY) / 100 * 1920 + 10;

  comp.allLayers().forEach(function (layer) {
    if (!layer._positions.length) {
      unpositioned.push(preset.id + " (" + settings.motion + ") layer \"" + layer.name + "\"");
      return;
    }
    var settled = layer._positions[layer._positions.length - 1];
    if (Math.abs(settled[1] - wantY) > 0.001) {
      misplaced.push(preset.id + " y=" + Math.round(settled[1]) + " wanted " + Math.round(wantY));
    }
  });
});

check("no style leaves a layer unpositioned", unpositioned.length === 0,
  unpositioned.slice(0, 4).join(" | "));
check("every style settles on its own Vertical setting", misplaced.length === 0,
  misplaced.slice(0, 4).join(" | "));
check("all the presets were exercised", Object.keys(motionsSeen).length >= 10,
  Object.keys(motionsSeen).sort().join(", "));

console.log("");
console.log("glow: what the host actually asks After Effects for");

var glowComp = fakeCreateComp(1080, 1920, 10);
var glowSettings = baseStyle({
  applyGlow: true, glowColor: "#1b2bff", glowAmount: 40, fontSize: 80, applyStroke: true, strokeWidth: 12
});
var glowResult = runCreate(glowComp, two, glowSettings, true);
var glowProps = glowComp.glowProps();
console.log("  effects requested : " + JSON.stringify(glowComp.effectsAdded().filter(function (e) { return e !== "ADBE Drop Shadow"; })));
console.log("  Glow Threshold    : " + glowProps["ADBE Glo2.Glow Threshold"]);
console.log("  Glow Radius       : " + glowProps["ADBE Glo2.Glow Radius"]);
console.log("  Glow Intensity    : " + glowProps["ADBE Glo2.Glow Intensity"]);
console.log("  layers with glow  : " + (glowComp.effectsAdded().filter(function (e) { return e === "ADBE Glo2"; }).length));
console.log("  backdrop layers   : " + glowResult.backdrops);

check("the glow effect is requested when the style asks for it",
  glowComp.effectsAdded().indexOf("ADBE Glo2") >= 0, JSON.stringify(glowComp.effectsAdded()));
check("a glow backdrop is created", glowResult.backdrops > 0, String(glowResult.backdrops));

// The comp's halo has to reach as far as the preview's, or the panel promises a
// glow that After Effects does not draw. Both use 0.20 + 0.80x the text size.


var glowFontPx = 80 * (1080 / 1920);
var previewFar = lcpPreview.glowRadii(glowFontPx, 40).far;
check("the comp's halo radius matches the preview's, within rounding",
  Math.abs(glowProps["ADBE Glo2.Glow Radius"] - previewFar) <= 1,
  "comp " + glowProps["ADBE Glo2.Glow Radius"] + "px vs preview " + previewFar + "px");
check("the glow is bright enough to see",
  glowProps["ADBE Glo2.Glow Intensity"] >= 1, String(glowProps["ADBE Glo2.Glow Intensity"]));
check("the threshold is not so high that the text cannot bloom",
  glowProps["ADBE Glo2.Glow Threshold"] <= 60, String(glowProps["ADBE Glo2.Glow Threshold"]));

var brighterComp = fakeCreateComp(1080, 1920, 10);
runCreate(brighterComp, two, baseStyle({ applyGlow: true, glowAmount: 100, fontSize: 80 }), true);
check("a higher amount gives a wider halo",
  brighterComp.glowProps()["ADBE Glo2.Glow Radius"] > glowProps["ADBE Glo2.Glow Radius"],
  brighterComp.glowProps()["ADBE Glo2.Glow Radius"] + "px vs " + glowProps["ADBE Glo2.Glow Radius"] + "px");

console.log("");
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " host checks passed");
process.exit(0);
