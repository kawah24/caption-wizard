/**
 * Smoke test for client/fonts.js
 *
 * The panel decides whether it may render text bold from what After Effects
 * reports about each family. Getting that wrong is visible: Chromium will fake a
 * bold for a single-weight font, and the preview then looks heavier and wider
 * than the generated captions.
 *
 * Run from the extension root:   node tests/fonts.smoke.js
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var source = fs.readFileSync(path.join(__dirname, "..", "client", "fonts.js"), "utf8");

var sandbox = { document: { createElement: function () { return {}; } } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

var F = sandbox.LcpFonts;

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

/** Feed the control a canned host response. */
function loadFonts(response) {
  F.load(function (fnName, arg, done) { done(response); }, function () {});
}

console.log("fonts.js smoke test");
console.log("");

console.log("real font list from the host");
loadFonts({
  ok: true,
  source: "app.fonts",
  fonts: [
    { family: "Arial", regularPS: "ArialMT", boldPS: "Arial-BoldMT" },
    { family: "Bangers", regularPS: "Bangers-Regular", boldPS: "Bangers-Regular" },
    { family: "Impact", regularPS: "Impact", boldPS: "Impact" },
    { family: "Montserrat", regularPS: "Montserrat-Regular", boldPS: "Montserrat-Bold" }
  ]
});
eq("families sorted", F.families().join(","), "Arial,Bangers,Impact,Montserrat");
eq("source is the host", F.source(), "app.fonts");
check("single-weight font reports no bold", F.hasBold("Bangers") === false);
check("Impact has no bold either", F.hasBold("Impact") === false);
check("Arial has a bold", F.hasBold("Arial") === true);
check("Montserrat has a bold", F.hasBold("Montserrat") === true);
check("unknown family is optimistic", F.hasBold("Not A Real Font") === true);
check("face info is exposed", F.faceInfo("Arial").boldPS === "Arial-BoldMT");

console.log("");
console.log("family availability and the Arial fallback");
check("Anton is not in this list", F.hasFamily("Anton") === false);
check("Arial is", F.hasFamily("Arial") === true);
check("case does not matter", F.hasFamily("arial") === true);
check("an empty name matches nothing", F.hasFamily("") === false);
eq("a missing family resolves to Arial", F.resolveFamily("Anton"), "Arial");
eq("an installed family is kept", F.resolveFamily("Montserrat"), "Montserrat");
eq("a caller can ask for another fallback", F.resolveFamily("Anton", "Verdana"), "Verdana");
eq("the fallback constant is Arial", F.FALLBACK_FAMILY, "Arial");

console.log("");
console.log("host returns nothing usable");
loadFonts({ ok: true, source: "builtin", shape: "app.fonts=undefined", fonts: [] });
check("falls back to the built-in list", F.families().length === F.FALLBACK.length);
eq("source reports builtin", F.source(), "builtin");
check("status explains why, with the host's own description",
  F.statusText().indexOf("app.fonts=undefined") >= 0, F.statusText());
check("with no data, bold is assumed available", F.hasBold("Arial") === true);

console.log("");
console.log("host reports a failure");
loadFonts({ ok: false, error: "no font api" });
check("still gives a usable list", F.families().length > 0);
check("status still explains", F.statusText().indexOf("built-in") >= 0, F.statusText());

console.log("");
console.log("the font list is not capped");

check("no row cap is left in the picker",
  !/ROW_CAP/.test(fs.readFileSync(path.join(__dirname, "..", "client", "fonts.js"), "utf8")),
  "the picker used to stop at 200 and say how many were hidden");
check("nothing in the picker hides families behind a hint",
  !/more - keep typing/.test(fs.readFileSync(path.join(__dirname, "..", "client", "fonts.js"), "utf8")));
console.log("");
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " font checks passed");
process.exit(0);
