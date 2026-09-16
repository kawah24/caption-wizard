/**
 * Consistency check for Caption Wizard.
 *
 * Verifies that every preset's motion profile is implemented in the host
 * script and has a preview class, and that every preview class has CSS.
 *
 * Usage: node tests/consistency.js <extension root>
 * Exits 0 when consistent, 1 otherwise.
 */
var fs = require("fs");
var path = require("path");

var root = process.argv[2] || path.join(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

var presets = read("client/presets.js");
var previews = read("client/previews.js");
var css = read("client/style.css");
var host = read("host/host.jsx");

var problems = 0;

function fail(message) {
  problems++;
  console.log("  FAIL  " + message);
}

function unique(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!seen[list[i]]) {
      seen[list[i]] = true;
      out.push(list[i]);
    }
  }
  return out;
}

function matches(text, pattern) {
  var out = [];
  var match;
  var re = new RegExp(pattern, "g");
  while ((match = re.exec(text)) !== null) out.push(match[1]);
  return out;
}

var motions = unique(matches(presets, 'motion:\\s*"([A-Za-z]+)"'));
var presetIds = matches(presets, 'id:\\s*"([a-z0-9-]+)"');

console.log("presets: " + presetIds.length + " (" + presetIds.join(", ") + ")");
console.log("distinct motion profiles: " + motions.length + " (" + motions.join(", ") + ")");
console.log("");

console.log("motion -> host script");

// Motions that are handled before applyMotion runs, with the reason why.
var HANDLED_ELSEWHERE = {
  karaoke: {
    marker: "lcp_addKaraokePhrase",
    why: "karaoke builds one layer per word and never reaches applyMotion"
  }
};

for (var m = 0; m < motions.length; m++) {
  var motion = motions[m];
  if (motion === "none") continue; // falls through to the static default

  if (HANDLED_ELSEWHERE[motion]) {
    var entry = HANDLED_ELSEWHERE[motion];
    if (host.indexOf(entry.marker) < 0) {
      fail("host/host.jsx has no " + entry.marker + " for motion " + motion + " (" + entry.why + ")");
    } else {
      console.log("  ok    " + motion + " -> " + entry.marker + " (" + entry.why + ")");
    }
    continue;
  }

  if (host.indexOf('motion === "' + motion + '"') < 0) {
    fail("host/host.jsx has no branch for motion " + motion);
  } else {
    console.log("  ok    " + motion);
  }
}

console.log("");
console.log("motion -> preview class -> css");
var classPairs = matches(previews, '"([A-Za-z]+)":\\s*"(pv-[a-z-]+)"');
var previewSource = previews.slice(previews.indexOf("var MOTION_CLASS"));
for (var p = 0; p < motions.length; p++) {
  var wanted = motions[p];
  if (previewSource.indexOf('"' + wanted + '"') < 0) {
    fail("previews.js MOTION_CLASS is missing " + wanted);
    continue;
  }
  var classMatch = new RegExp('"' + wanted + '":\\s*"(pv-[a-z-]+)"').exec(previews);
  if (!classMatch) {
    fail("could not resolve preview class for " + wanted);
    continue;
  }
  var className = classMatch[1];
  if (css.indexOf("." + className) < 0) {
    fail("style.css has no rule for ." + className);
  } else {
    console.log("  ok    " + wanted + " -> ." + className);
  }
}

console.log("");
console.log("preset controls exist in CONTROL_DEFS");
// Load presets.js for real rather than pattern-matching it: a preset naming a
// control that does not exist would silently render nothing at all.
var vm = require("vm");
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(presets, sandbox);
var P = sandbox.window.LcpPresets;

for (var c = 0; c < P.PRESETS.length; c++) {
  var presetDef = P.PRESETS[c];
  for (var d = 0; d < presetDef.controls.length; d++) {
    if (!P.CONTROL_DEFS[presetDef.controls[d]]) {
      fail("preset " + presetDef.id + " uses unknown control '" + presetDef.controls[d] + "'");
    }
  }
}
console.log("  checked " + P.PRESETS.length + " presets");

console.log("");
console.log("select controls: option shapes and preset values");
var selectKeys = [];
for (var ck in P.CONTROL_DEFS) {
  if (!P.CONTROL_DEFS.hasOwnProperty(ck)) continue;
  var cdef = P.CONTROL_DEFS[ck];
  if (cdef.type !== "select") continue;
  selectKeys.push(ck);

  if (!cdef.options || !cdef.options.length) {
    fail("select '" + ck + "' has no options");
    continue;
  }

  var allowed = [];
  for (var oi = 0; oi < cdef.options.length; oi++) {
    var entry = cdef.options[oi];
    if (entry && typeof entry === "object") {
      if (entry.value === undefined || entry.label === undefined) {
        fail("select '" + ck + "' option " + oi + " needs both value and label");
      } else {
        allowed.push(String(entry.value));
      }
    } else if (typeof entry === "string") {
      allowed.push(entry);
    } else {
      fail("select '" + ck + "' option " + oi + " is neither a string nor {value,label}");
    }
  }

  // Every preset's resolved value for this select must be one of its options,
  // otherwise the dropdown silently selects nothing.
  for (var pc = 0; pc < P.PRESETS.length; pc++) {
    var resolved = P.resolveSettings(P.PRESETS[pc].id, {});
    if (P.PRESETS[pc].controls.indexOf(ck) < 0) continue;
    if (allowed.indexOf(String(resolved[ck])) < 0) {
      fail("preset " + P.PRESETS[pc].id + " value '" + resolved[ck] +
           "' is not an option of " + ck);
    }
  }
}
console.log("  checked " + selectKeys.length + " selects: " + selectKeys.join(", "));

console.log("");
console.log("font picker: classes used in JS must exist in CSS");
var fontJs = read("client/fonts.js");
var fontClasses = ["font-current", "font-list", "font-row", "font-empty", "font-filter"];
for (var fc = 0; fc < fontClasses.length; fc++) {
  var cls = fontClasses[fc];
  if (fontJs.indexOf(cls) < 0) {
    fail("fonts.js never uses " + cls);
  } else if (css.indexOf("." + cls) < 0) {
    fail("style.css has no rule for ." + cls);
  }
}
console.log("  checked " + fontClasses.length + " classes");

console.log("");
console.log("dependent controls: dependsOn wiring");
// A control with dependsOn only appears while its switch is on, so a preset
// that exposes the detail without the switch would hide it forever.
var depCount = 0;
for (var dk in P.CONTROL_DEFS) {
  if (!P.CONTROL_DEFS.hasOwnProperty(dk)) continue;
  var dd = P.CONTROL_DEFS[dk];
  if (!dd.dependsOn) continue;
  depCount++;

  if (!P.CONTROL_DEFS[dd.dependsOn]) {
    fail("'" + dk + "' depends on unknown control '" + dd.dependsOn + "'");
  } else if (P.CONTROL_DEFS[dd.dependsOn].type !== "toggle") {
    fail("'" + dk + "' depends on '" + dd.dependsOn + "', which is not a toggle");
  }

  for (var pi = 0; pi < P.PRESETS.length; pi++) {
    var listed = P.PRESETS[pi].controls;
    if (listed.indexOf(dk) >= 0 && listed.indexOf(dd.dependsOn) < 0) {
      fail("preset " + P.PRESETS[pi].id + " lists '" + dk +
           "' without its switch '" + dd.dependsOn + "'");
    }
  }
}
console.log("  checked " + depCount + " dependent controls");

console.log("");
console.log("every preset has preview text and a blurb");
var presetBlocks = presets.split("{\n      id:");
for (var b = 1; b < presetBlocks.length; b++) {
  var block = presetBlocks[b];
  var id = (/^\s*"([a-z0-9-]+)"/.exec(block) || [])[1];
  // Either a single preview line, or per-word preview text (karaoke).
  if (!/previewLine:/.test(block) && !/previewWords:/.test(block)) {
    fail("preset " + id + " has neither previewLine nor previewWords");
  }
  if (!/blurb:/.test(block)) fail("preset " + id + " has no blurb");
}

console.log("");
console.log("every preset exposes at least one control");
for (var g = 0; g < P.PRESETS.length; g++) {
  if (!P.PRESETS[g].controls.length) {
    fail("preset " + P.PRESETS[g].id + " has no controls");
  }
}

console.log("");
if (problems) {
  console.log(problems + " consistency problem(s) found");
  process.exit(1);
}
console.log("consistent: " + presetIds.length + " presets, " + motions.length + " motions");
process.exit(0);
