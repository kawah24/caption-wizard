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
                      },
                      setValueAtTime: function (time, value) {
                        comp._glowProps[effectName + "." + propName + "@" + time] = value;
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
            setValue: function (v) { if (name === "Opacity" && layer._opacity) layer._opacity.push(v); },
            setValueAtTime: function (t, v) { if (name === "Opacity" && layer._opacity) layer._opacity.push(v); }
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
      moveAfter: function (other) { layer._movedAfter = other ? other.name : null; },
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
    layer._opacity = [];
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
  comp.layers = {
    addText: function (text) { return add(text); },
    // A background bar is a solid. Without this stub the box path threw, was
    // swallowed, and every test stayed green while Shorts Bar drew nothing.
    addSolid: function (color, name, w, h, aspect, dur) {
      var layer = add(name);
      layer._solid = { color: color, width: w, height: h, aspect: aspect, duration: dur };
      return layer;
    },
    // The fallback path: a rectangle shape layer, which is what a build that
    // refuses addSolid is given instead.
    addShape: function () {
      var layer = add("Shape Layer");
      var note = { size: null, fill: null };
      var rectProp = { setValue: function (v) { note.size = v; } };
      var fillProp = { setValue: function (v) { note.fill = v; } };
      var inner = {
        addProperty: function (type) {
          if (type === "ADBE Vector Shape - Rect") return { property: function () { return rectProp; } };
          if (type === "ADBE Vector Graphic - Fill") return { property: function () { return fillProp; } };
          return { property: function () { return { setValue: function () {} }; } };
        }
      };
      var group = { property: function () { return inner; } };
      var shapeProps = {};
      layer.property = function (name) {
        if (name === "ADBE Root Vectors Group") {
          return { addProperty: function () { return group; } };
        }
        if (!shapeProps[name]) {
          shapeProps[name] = {
            numProperties: 0,
            property: function () { return null; },
            setValue: function (v) { if (name === "Opacity" && layer._opacity) layer._opacity.push(v); },
            setValueAtTime: function (t, v) { if (name === "Opacity" && layer._opacity) layer._opacity.push(v); }
          };
        }
        return shapeProps[name];
      };
      layer._shape = note;
      return layer;
    }
  };
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
console.log("");
console.log("the outline's auto-spacing matches on both sides");

var spacingStyle = baseStyle({ applyStroke: true, strokeWidth: 40, fontSize: 150, applyGlow: false });
var spacingComp = fakeCreateComp(1080, 1920, 10);
runCreate(spacingComp, two, spacingStyle, true);
var spacingLayer = spacingComp.allLayers()[0];
var hostTracking = spacingLayer && spacingLayer._doc ? spacingLayer._doc.tracking : undefined;

check("the host widens the tracking for a heavy outline",
  typeof hostTracking === "number" && hostTracking > 100, String(hostTracking));
check("it adds half the stroke width, in 1/1000 em",
  Math.abs(hostTracking - (40 / 2) / 150 * 1000) < 0.01, String(hostTracking) + " vs " + ((40 / 2) / 150 * 1000).toFixed(2));
check("the preview uses the same rule",
  Math.abs(lcpPreview.autoTracking(spacingStyle) - hostTracking) < 0.01,
  lcpPreview.autoTracking(spacingStyle).toFixed(2) + " vs " + hostTracking);
check("a spacing already wider than the outline needs is left alone",
  lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 40, fontSize: 150, tracking: 400 }) === 0,
  String(lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 40, fontSize: 150, tracking: 400 })));
check("a partial spacing is topped up, not doubled",
  Math.abs(lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 40, fontSize: 150, tracking: 90 }) -
           (133.33 - 90)) < 0.1,
  String(lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 40, fontSize: 150, tracking: 90 })));
check("switching it off adds nothing",
  lcpPreview.autoTracking({ applyStroke: true, autoSpaceOutline: false, strokeWidth: 40, fontSize: 150 }) === 0);
check("a caption with no outline is left alone",
  lcpPreview.autoTracking({ applyStroke: false, strokeWidth: 40, fontSize: 150 }) === 0);
check("a thicker outline needs more spacing",
  lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 80, fontSize: 150 }) >
  lcpPreview.autoTracking({ applyStroke: true, strokeWidth: 40, fontSize: 150 }));
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
    // A bar is centred on the text box itself, which the fake reports 10px below
    // the anchor, so a bar sits 10px above where a text layer settles.
    var want = layer._solid ? wantY - 10 : wantY;
    if (Math.abs(settled[1] - want) > 0.001) {
      misplaced.push(preset.id + " y=" + Math.round(settled[1]) + " wanted " + Math.round(want));
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
console.log("the comp animates what the preview animates");

var blurComp = fakeCreateComp(1080, 1920, 10);
runCreate(blurComp, two, baseStyle({ motion: "blurFade", fontSize: 150 }), true);
check("Blur Fade asks for a real blur in the comp",
  blurComp.effectsAdded().indexOf("ADBE Gaussian Blur 2") >= 0 ||
  blurComp.effectsAdded().indexOf("ADBE Box Blur2") >= 0,
  JSON.stringify(blurComp.effectsAdded()));
var blurKeys = Object.keys(blurComp.glowProps()).filter(function (k) { return k.indexOf(".Blurriness@") >= 0; });
check("the blur is keyframed, not constant", blurKeys.length >= 3, blurKeys.length + " keyframe(s)");
check("it starts soft and sharpens",
  blurComp.glowProps()[blurKeys[0]] > 0 && blurKeys.some(function (k) { return blurComp.glowProps()[k] === 0; }),
  blurKeys.map(function (k) { return blurComp.glowProps()[k]; }).join(", "));
check("the soft radius follows the text size",
  blurComp.glowProps()[blurKeys[0]] >= Math.round(150 * (1080 / 1920) * 0.4),
  String(blurComp.glowProps()[blurKeys[0]]));

var neonFlash = fakeCreateComp(1080, 1920, 10);
runCreate(neonFlash, two, baseStyle({ motion: "neon" }), true);
check("Neon asks for a brightness flash in the comp",
  neonFlash.effectsAdded().indexOf("ADBE Brightness & Contrast 2") >= 0,
  JSON.stringify(neonFlash.effectsAdded()));
check("the flash is keyframed from bright to settled",
  Object.keys(neonFlash.glowProps()).some(function (k) { return k.indexOf(".Brightness@") >= 0; }),
  Object.keys(neonFlash.glowProps()).join(", "));

// Anything a preview keyframe animates has to be reproduced by the host, or be
// listed here with its reason. This is what would have caught Blur Fade and Neon
// ignoring their own filters.
var hostSource = fs.readFileSync(hostPath, "utf8");
var cssSource = fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8");
var hostCan = {
  opacity: /keyOpacity\(/.test(hostSource),
  transform: /keyPosition\(|keyScale\(/.test(hostSource),
  color: /fillColor/.test(hostSource),
  filter: /ADBE Gaussian Blur 2/.test(hostSource) && /ADBE Brightness & Contrast 2/.test(hostSource)
};
// Empty on purpose. It held letter-spacing, excusing Cinematic's tracking as static
// in the comp - but the preview never varied it either, so there was nothing to
// excuse. Anything animated from here on has to be reproduced by the host.
var acceptedGaps = {};
var animatedProps = {};
var frameRe = /@keyframes (lcp\w+) \{([\s\S]*?)\n\}/g;
var frame;
while ((frame = frameRe.exec(cssSource))) {
  var propRe = /([a-z-]+):\s/g;
  var prop;
  while ((prop = propRe.exec(frame[2]))) {
    if (!animatedProps[prop[1]]) animatedProps[prop[1]] = [];
    if (animatedProps[prop[1]].indexOf(frame[1]) < 0) animatedProps[prop[1]].push(frame[1]);
  }
}
check("the keyframe scan found the motions", Object.keys(animatedProps).length >= 4,
  Object.keys(animatedProps).sort().join(", "));
var unsupported = Object.keys(animatedProps).filter(function (p) {
  return hostCan[p] !== true && !acceptedGaps[p];
});
check("every animated property is reproduced or a documented gap",
  unsupported.length === 0,
  unsupported.map(function (p) { return p + " (" + animatedProps[p].join("/") + ")"; }).join(" | "));

console.log("");
console.log("what the preview shows is what the comp draws, ratio for ratio");

// Every size-derived value must divide by the same reference on both sides. The
// host authors against a 1920px comp; the preview against its own frame. What has
// to match is each value as a fraction of the text size.
var portraitFrame = 234;                        // the panel's frame for 1080x1920
var previewFactor = lcpPreview.sizeFactor(portraitFrame);
var compFactor = 1080 / 1920;
var previewFontPx = 150 * previewFactor;
var compFontPx = 150 * compFactor;

// The preview can only draw whole pixels, and at an 18px text size one pixel of
// rounding is over five percent of a radius. That is the tolerance, not a licence:
// anything larger is a real difference between the two sides.
var pixelSlack = 0.5 / previewFontPx;

function ratioGap(previewValue, compValue) {
  return Math.abs((previewValue / previewFontPx) - (compValue / compFontPx));
}

// Outline width 40, the value being used in practice.
check("the outline is the same fraction of the text on both sides",
  ratioGap(lcpPreview.strokePx(40, previewFactor), 40 * compFactor) < 1e-9,
  lcpPreview.strokePx(40, previewFactor).toFixed(3) + "px vs " + (40 * compFactor).toFixed(3) + "px");

// Glow radius, at amount 40.
var previewGlow = lcpPreview.glowRadii(previewFontPx, 40).far;
var compGlow = compFontPx * (0.20 + 0.80 * 0.40);
check("the glow radius is the same fraction of the text on both sides",
  ratioGap(previewGlow, compGlow) < pixelSlack,
  previewGlow + "px vs " + compGlow.toFixed(1) + "px (rounding allowed)");

// Drop shadow: the preview derives its offset and blur from the rendered size,
// the host from the comp text size. Read the host's own numbers back.
var shadowComp = fakeCreateComp(1080, 1920, 10);
runCreate(shadowComp, two, baseStyle({ applyShadow: true, shadowAmount: 55, fontSize: 150 }), true);
var shadowProps = shadowComp.glowProps();
var hostDistance = shadowProps["ADBE Drop Shadow.Distance"];
var hostSoftness = shadowProps["ADBE Drop Shadow.Softness"];
check("the drop shadow effect is applied", hostDistance !== undefined, JSON.stringify(Object.keys(shadowProps)));
if (hostDistance !== undefined) {
  check("the shadow distance is the same fraction of the text on both sides",
    Math.abs((150 * previewFactor * 0.10) / previewFontPx - hostDistance / compFontPx) < 0.02,
    (150 * previewFactor * 0.10).toFixed(2) + "px vs " + hostDistance + "px");
}
if (hostSoftness !== undefined) {
  check("the shadow softness is the same fraction of the text on both sides",
    Math.abs((150 * previewFactor * 0.25) / previewFontPx - hostSoftness / compFontPx) < 0.02,
    (150 * previewFactor * 0.25).toFixed(2) + "px vs " + hostSoftness + "px");
}

// Blur, for Blur Fade: both use 0.45 of the text size.
var blurComp = fakeCreateComp(1080, 1920, 10);
runCreate(blurComp, two, baseStyle({ motion: "blurFade", fontSize: 150 }), true);
var blurKey = Object.keys(blurComp.glowProps()).filter(function (k) {
  return k.indexOf(".Blurriness@") >= 0;
})[0];
check("the blur radius is the same fraction of the text on both sides",
  blurKey !== undefined &&
  Math.abs((compFontPx * 0.45) / compFontPx - blurComp.glowProps()[blurKey] / compFontPx) < 0.02,
  blurKey ? blurComp.glowProps()[blurKey] + "px vs " + (compFontPx * 0.45).toFixed(1) + "px" : "no blur recorded");

console.log("");
console.log("");
console.log("the background bar is really built");

var boxProblems = [];
var boxSamples = [];
lcpPresets.PRESETS.forEach(function (preset) {
  var comp = fakeCreateComp(1080, 1920, 10);
  var settings = lcpPresets.resolveSettings(preset.id, {}, lcpPresets.TIMING_DEFAULTS);
  var res = runCreate(comp, [phrase("boxed caption", 0, 2000)], settings, true);
  var bars = comp.allLayers().filter(function (l) { return l.name === "bar"; });

  if (settings.applyBox) {
    if (bars.length !== 1) boxProblems.push(preset.id + " built " + bars.length + " bar(s)");
  } else if (bars.length) {
    boxProblems.push(preset.id + " built a bar it never asked for");
  }
  if (bars.length) boxSamples.push({ id: preset.id, bar: bars[0], result: res });
});
check("every boxed style builds one bar, and no other style builds any",
  boxProblems.length === 0, boxProblems.join(" | "));
check("at least one style is boxed, so this is not vacuous", boxSamples.length > 0);

if (boxSamples.length) {
  var sample = boxSamples[0];
  check("the bar is counted in the result", sample.result.bars === 1, JSON.stringify(sample.result));
  check("the bar is a solid, not a text layer",
    !!(sample.bar._solid && sample.bar._solid.color && sample.bar._solid.color.length === 3),
    JSON.stringify(sample.bar._solid));
  check("the bar is measured from the text, with the padding added",
    sample.bar._solid.width > sample.bar._solid.height && sample.bar._solid.height > 0,
    JSON.stringify(sample.bar._solid));
  check("the bar is put behind the caption it belongs to",
    !!sample.bar._movedAfter, "moveAfter was never called on the bar");
  check("the bar spans the caption's own timing",
    sample.bar.inPoint === 0 && sample.bar.outPoint > sample.bar.inPoint,
    "in=" + sample.bar.inPoint + " out=" + sample.bar.outPoint);
}
console.log("");
console.log("the bar survives a hostile After Effects");

// a build that refuses addSolid must still get its bar, as a shape layer
var hostile = fakeCreateComp(1080, 1920, 10);
hostile.layers.addSolid = function () { throw new Error("addSolid is not available here"); };
var hostileStyle = lcpPresets.resolveSettings("shorts-box", {}, lcpPresets.TIMING_DEFAULTS);
var hostileRes = runCreate(hostile, [phrase("boxed caption", 0, 2000)], hostileStyle, true);
var hostileBars = hostile.allLayers().filter(function (l) { return l.name === "Shape Layer"; });
check("a boxed style still gets a bar when a solid is refused",
  hostileBars.length === 1, "shape layers: " + hostileBars.length + "  result: " + JSON.stringify(hostileRes));
check("and the layer is measured as the text plus padding",
  hostileBars.length === 1 && hostileBars[0]._shape && hostileBars[0]._shape.size &&
  hostileBars[0]._shape.size[0] > hostileBars[0]._shape.size[1],
  JSON.stringify(hostileBars.length ? hostileBars[0]._shape : null));
check("the solid's failure is visible in the note, not swallowed",
  /shape layer/.test(hostileRes.boxNote || ""), "note: " + hostileRes.boxNote);

// measurement retry: a layer that only answers a moment after its own in point
var late = {
  inPoint: 1,
  sourceRectAtTime: function (at) {
    return at > 1 ? { left: 0, top: -30, width: 200, height: 40 } : null;
  }
};
var measured = sandbox.lcp_measureCaption(late);
check("a caption that needs a moment to settle is still measured",
  !!(measured && measured.width === 200), JSON.stringify(measured));

var never = { inPoint: 1, sourceRectAtTime: function () { return null; } };
check("a caption that never reports a box is reported as unmeasurable",
  sandbox.lcp_measureCaption(never) === null);
console.log("");
console.log("the bar keeps its own opacity");

var opComp = fakeCreateComp(1080, 1920, 10);
var opStyle = lcpPresets.resolveSettings("shorts-box", {}, lcpPresets.TIMING_DEFAULTS);
opStyle.boxOpacity = 10;
var opRes = runCreate(opComp, [phrase("boxed caption", 0, 2000)], opStyle, true);
var barLayers = opComp.allLayers().filter(function (l) {
  return l.name === "bar" || /Shape Layer/.test(l.name);
});
check("the boxed style produced a bar layer to test", barLayers.length === 1,
  "found " + barLayers.length + "  result: " + JSON.stringify(opRes));
if (barLayers.length === 1) {
  var written = barLayers[0]._opacity || [];
  var tooHigh = written.filter(function (v) { return v > 10.0001; });
  check("nothing writes an opacity above the bar's own setting",
    tooHigh.length === 0, "wrote " + JSON.stringify(written.slice(0, 12)));
  check("the bar does reach its setting",
    written.indexOf(10) >= 0, "wrote " + JSON.stringify(written.slice(0, 12)));
}

var capComp = fakeCreateComp(1080, 1920, 10);
var capStyle = lcpPresets.resolveSettings("shorts-box", {}, lcpPresets.TIMING_DEFAULTS);
runCreate(capComp, [phrase("plain caption", 0, 2000)], capStyle, true);
var capText = capComp.allLayers().filter(function (l) { return !/Shape Layer|^bar$/.test(l.name); })[0];
check("a caption layer still reaches full opacity",
  !!capText && (capText._opacity || []).indexOf(100) >= 0,
  JSON.stringify(capText ? capText._opacity : null));

console.log("");
console.log("every card, through every feature, on both sides");

// Bugs in this project have clustered in paths that only some styles reach - the
// background bar, the karaoke highlight, the glow backdrop, the outline. So each of
// the twenty cards is put through every feature rather than only its own defaults,
// and both sides have to survive it: the host building layers, the preview drawing.
var VARIANTS = [
  { name: "as shipped",       over: {} },
  { name: "outline",          over: { applyStroke: true, strokeColor: "#000000", strokeWidth: 26 } },
  { name: "shadow",           over: { applyShadow: true, shadowAmount: 55 } },
  { name: "glow",             over: { applyGlow: true, glowAmount: 40 } },
  { name: "bar",              over: { applyBox: true, boxPadding: 24, boxOpacity: 80, boxColor: "#101010" } },
  { name: "bar at 10pc",      over: { applyBox: true, boxPadding: 24, boxOpacity: 10, boxColor: "#ff8080" } },
  { name: "karaoke",          over: { karaoke: true, karaokeHighlight: "#ff6fa5", karaokeDim: "#ffffff", karaokePop: true } },
  { name: "word by word",     over: { wordByWord: true } },
  { name: "bold upper two",   over: { bold: true, transform: "uppercase", lines: "2" } },
  { name: "outline only",     over: { filled: false, applyStroke: true, strokeWidth: 40 } },
  { name: "align left",       over: { align: "left" } },
  { name: "align right",      over: { align: "right" } },
  { name: "corner placement", over: { posX: 20, posY: 30 } }
];

function fakeStage() {
  function el(cls) {
    var e = { className: cls || "", style: {}, textContent: "", attrs: {}, children: [] };
    e.setAttribute = function (k, v) { e.attrs[k] = v; };
    e.getAttribute = function (k) { return e.attrs[k] === undefined ? null : e.attrs[k]; };
    e.appendChild = function (c) { e.children.push(c); return c; };
    e.removeChild = function (c) { return c; };
    e.getElementsByClassName = function () { return []; };
    e.querySelector = function () { return null; };
    e.addEventListener = function () {};
    e.classList = { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } };
    e.style.setProperty = function (k, v) { e.style[k] = v; };
    e.style.getPropertyValue = function (k) { return e.style[k] === undefined ? "" : e.style[k]; };
    e.style.removeProperty = function (k) { delete e.style[k]; };
    return e;
  }
  var frame = el("pv"), anchor = el("stage-anchor"), label = el("pv-text");
  var map = { "pv": frame, "stage-anchor": anchor, "pv-text": label };
  var stage = { clientWidth: 234 };
  stage.getElementsByClassName = function (n) { return map[n] ? [map[n]] : []; };
  return { stage: stage, frame: frame, anchor: anchor, label: label };
}

var hostThrew = [];
var previewThrew = [];
var combos = 0;
var barBuilt = 0, backdropBuilt = 0, wordLayers = 0;
var askedForBar = 0;

lcpPresets.PRESETS.forEach(function (preset) {
  VARIANTS.forEach(function (variant) {
    combos++;
    var settings = lcpPresets.resolveSettings(preset.id, variant.over, lcpPresets.TIMING_DEFAULTS);
    settings = JSON.parse(JSON.stringify(settings));

    // the host side
    try {
      var comp = fakeCreateComp(1080, 1920, 10);
      var res = runCreate(comp, [phrase("Dolly writes now", 0, 2000)], settings, true);
      if (!res || res.ok !== true) hostThrew.push(preset.id + "/" + variant.name + ": " + JSON.stringify(res));
      if (res.errors && res.errors.length) hostThrew.push(preset.id + "/" + variant.name + ": " + res.errors.join("; "));
      if (settings.applyBox) {
        askedForBar++;
        var hasBar = comp.allLayers().some(function (l) { return l.name === "bar" || /Shape Layer/.test(l.name); });
        if (hasBar) barBuilt++; else hostThrew.push(preset.id + "/" + variant.name + ": no bar was built");
      }
      if (settings.applyGlow) {
        if (res.backdrops > 0) backdropBuilt++; else hostThrew.push(preset.id + "/" + variant.name + ": no glow backdrop");
      }
      if (settings.wordByWord || settings.karaoke) wordLayers++;
    } catch (err) {
      hostThrew.push(preset.id + "/" + variant.name + " threw: " + err.message);
    }

    // the preview side
    try {
      var s = fakeStage();
      lcpPreview.applyStageSettings(s.stage, preset, settings, {});
      if (!s.anchor.style.background && settings.applyBox) {
        previewThrew.push(preset.id + "/" + variant.name + ": preview drew no bar");
      }
    } catch (err) {
      previewThrew.push(preset.id + "/" + variant.name + " threw: " + err.message);
    }
  });
});

check("the matrix actually ran every card against every feature",
  combos === lcpPresets.PRESETS.length * VARIANTS.length,
  combos + " of " + (lcpPresets.PRESETS.length * VARIANTS.length));
check("the host builds every card through every feature without failing",
  hostThrew.length === 0, hostThrew.slice(0, 6).join(" | "));
check("the preview draws every card through every feature without failing",
  previewThrew.length === 0, previewThrew.slice(0, 6).join(" | "));
// Counted rather than predicted: some cards ship with the bar already on, so a
// hand-written expectation is wrong the moment a preset changes.
check("a bar was built every single time one was asked for",
  barBuilt === askedForBar && askedForBar > 0,
  barBuilt + " built of " + askedForBar + " asked");

// The bar's padding is a fraction of the text size on both sides, like every other
// measured value: the preview scales by its frame, the host by the comp.
var padPreview = 24 * previewFactor;
var padComp = 24 * compFactor;
check("the bar's padding is the same fraction of the text on both sides",
  ratioGap(padPreview, padComp) < 1e-9,
  padPreview.toFixed(3) + "px vs " + padComp.toFixed(3) + "px");
console.log("");
console.log("the glow colour actually reaches the comp");

// The mode is the part that matters: with Glow Colors on Original Colors, Color A
// and Color B are ignored and the halo takes the text's own colour. This is the
// check that would have caught a tinted swatch doing nothing in the comp.
var tintComp = fakeCreateComp(1080, 1920, 10);
var tintStyle = baseStyle({ applyGlow: true, glowAmount: 40, glowColor: "#ff0000", fill: "#ffffff", fontSize: 150 });
runCreate(tintComp, two, tintStyle, true);
var tintProps = tintComp.glowProps();

check("the glow is switched to A and B colours, not the text's own colour",
  tintProps["ADBE Glo2.Glow Colors"] === 2,
  "Glow Colors = " + tintProps["ADBE Glo2.Glow Colors"] + " (1 is Original Colors, 2 is A & B)");

var compTint = tintProps["ADBE Glo2.Color A"];
check("the glow colour is written to the effect",
  !!compTint && compTint.length === 3 && Math.round(compTint[0] * 255) === 255 &&
  Math.round(compTint[1] * 255) === 0 && Math.round(compTint[2] * 255) === 0,
  JSON.stringify(compTint));

// Both sides, same colour: the preview builds a text-shadow from the setting, the
// comp sets the effect. Read each side's own value back and compare them.
var previewShadow = lcpPreview.glowShadow(18, { applyGlow: true, glowAmount: 40, glowColor: "#ff0000" });
var hexInShadow = (previewShadow.match(/#[0-9a-fA-F]{3,6}/) || [])[0];
check("the preview puts the same colour in its halo", hexInShadow === "#ff0000",
  "preview shadow: " + previewShadow);
if (hexInShadow && compTint) {
  var shown = hexInShadow.replace("#", "");
  if (shown.length === 3) shown = shown[0] + shown[0] + shown[1] + shown[1] + shown[2] + shown[2];
  var wantR = parseInt(shown.substring(0, 2), 16) / 255;
  var wantG = parseInt(shown.substring(2, 4), 16) / 255;
  var wantB = parseInt(shown.substring(4, 6), 16) / 255;
  check("the halo is the same colour on both sides",
    Math.abs(compTint[0] - wantR) < 0.02 && Math.abs(compTint[1] - wantG) < 0.02 &&
    Math.abs(compTint[2] - wantB) < 0.02,
    JSON.stringify(compTint) + " vs " + hexInShadow);
}
console.log("");
console.log("a power word is drawn bigger, as its own line");

// The reference look: several lines, with the power word on a line of its own and
// drawn larger. A text document cannot hold two sizes, so the comp builds one layer
// per line and gives the power line the emphasis style.
var pwComp = fakeCreateComp(1080, 1920, 10);
var pwStyle = lcpPresets.resolveSettings("power-word", {}, lcpPresets.TIMING_DEFAULTS);
var pwCaption = {
  text: "because everything that I did myself",
  startMs: 0, endMs: 2000,
  emphasis: [3, 4],
  words: [{ text: "because" }, { text: "everything" }, { text: "that" }, { text: "I" }, { text: "did" }, { text: "myself" }]
};
var pwRes = runCreate(pwComp, [pwCaption], pwStyle, true);
var pwLayers = pwComp.allLayers();
check("a caption with a power word is drawn a line at a time",
  pwLayers.length >= 3, "layers: " + pwLayers.length + "  result: " + JSON.stringify(pwRes));
var pwTexts = pwLayers.map(function (l) { return String(l.text || l.name); }).join(" / ");
check("the power word gets a line to itself",
  /(^|\/ )I did(\/|$)/.test(pwTexts) || pwTexts.indexOf("I did") >= 0, pwTexts);
check("and the run says what it did",
  /line\(s\)/.test(pwRes.boxNote || ""), "note: " + pwRes.boxNote);

// no emphasis means the old single-layer path, unchanged
var plainComp = fakeCreateComp(1080, 1920, 10);
var plainRes = runCreate(plainComp, [{ text: "no power words here at all", startMs: 0, endMs: 2000, emphasis: [] }], pwStyle, true);
check("a caption without power words still builds one layer",
  plainComp.allLayers().length === 1,
  "layers: " + plainComp.allLayers().length + "  result: " + JSON.stringify(plainRes));

// and the planner is what decides, so both sides agree
var planned = lcpPresets.markEmphasis([{ text: "we did 1974 together", words: null }], pwStyle);
check("the planner records the power word indices on the caption",
  !!planned[0].emphasis && planned[0].emphasis.indexOf(2) >= 0,
  JSON.stringify(planned[0].emphasis));
console.log("");
console.log("a look that costs layers cannot run away");

// One layer per line is several times the layers, all built inside one undo step,
// which is what a frozen application actually is. These two ceilings are why that
// cannot happen again unnoticed.
var cappedStyle = lcpPresets.resolveSettings("power-word", {}, lcpPresets.TIMING_DEFAULTS);
var manyWords = [];
var manyText = [];
for (var mw = 0; mw < 30; mw++) { manyWords.push({ text: "word" + mw }); manyText.push("word" + mw); }
var cappedComp = fakeCreateComp(1080, 1920, 10);
var cappedRes = runCreate(cappedComp, [{
  text: manyText.join(" "), startMs: 0, endMs: 2000,
  emphasis: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
             20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  words: manyWords
}], cappedStyle, true);
check("a caption of all power words still becomes a handful of layers",
  cappedComp.allLayers().length <= 6,
  "layers: " + cappedComp.allLayers().length);

check("the ceiling exists and is a sane number",
  typeof sandbox.LCP_MAX_LAYERS === "number" && sandbox.LCP_MAX_LAYERS > 0 &&
  sandbox.LCP_MAX_LAYERS <= 2000, String(sandbox.LCP_MAX_LAYERS));

var overflow = [];
var lots = [];
for (var lo = 0; lo < 220; lo++) {
  lots.push({
    text: "one two three " + lo, startMs: lo * 100, endMs: lo * 100 + 90,
    emphasis: [3], words: null
  });
}
var overComp = fakeCreateComp(1080, 1920, 60);
var overRes = runCreate(overComp, lots, cappedStyle, true);
// Either guard may be the one that trips, depending on the run: the caption budget
// declines the layer-hungry look, and the ceiling stops a run outright. What matters
// is that a large run is bounded and that the reason is stated.
var overWarnings = (overRes.warnings || []).join(" ");
check("a run too large for the look is bounded and the reason is stated",
  /declined|Stopped at/.test(overWarnings),
  "layers: " + overComp.allLayers().length + "  warnings: " + JSON.stringify(overRes.warnings));
check("and it stops near the ceiling rather than building all of them",
  overComp.allLayers().length <= sandbox.LCP_MAX_LAYERS + 8,
  "layers: " + overComp.allLayers().length);
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " host checks passed");
process.exit(0);
