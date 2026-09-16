/**
 * Smoke test for the panel markup and the code that drives it
 *
 * The panel is plain DOM with no framework, so nothing but this file stops
 * client/main.js from looking up an element that was renamed or moved in
 * client/index.html. It also pins the part of the footer that has to survive a
 * tab switch: Refresh, Clear Generated and the status line must stay visible on
 * every tab, while Generate is only shown for the Style tab.
 *
 * Run from the extension root:   node tests/panel.smoke.js
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "client", "index.html"), "utf8");
var js = fs.readFileSync(path.join(root, "client", "main.js"), "utf8");
var css = fs.readFileSync(path.join(root, "client", "style.css"), "utf8");

var failures = 0;
var checks = 0;

function check(label, condition, detail) {
  checks++;
  if (!condition) {
    failures++;
    console.log("  FAIL  " + label + (detail === undefined ? "" : "  -> " + detail));
  }
}

function matches(text, pattern) {
  var out = [];
  var re = new RegExp(pattern, "g");
  var m = re.exec(text);
  while (m) {
    out.push(m[1]);
    m = re.exec(text);
  }
  return out;
}

function unique(list) {
  return list.filter(function (value, index) { return list.indexOf(value) === index; });
}

/** The markup of one <div id="...">, found by counting nested divs. */
function divBlock(source, id) {
  var start = source.indexOf('<div id="' + id + '"');
  if (start < 0) return "";

  var depth = 0;
  var cursor = start;
  var open = /<div\b/g;
  var close = /<\/div>/g;
  while (cursor < source.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    var nextOpen = open.exec(source);
    var nextClose = close.exec(source);
    if (!nextClose) return "";

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + 4;
    } else {
      depth--;
      cursor = nextClose.index + 6;
      if (depth === 0) return source.slice(start, cursor);
    }
  }
  return "";
}

/* ------------------------------------------------------------------ */

console.log("");
console.log("panel markup and wiring");

var asked = unique(matches(js, 'byId\\("([^"]+)"\\)'));
var defined = unique(matches(html, 'id="([^"]+)"'));
check("main.js asks for a sane number of elements", asked.length > 20, String(asked.length));

var missing = asked.filter(function (id) { return defined.indexOf(id) < 0; });
check("every element main.js looks up exists in the markup", missing.length === 0, missing.join(", "));

var declared = matches(html, 'id="([^"]+)"');
var duplicates = declared.filter(function (id, index) { return declared.indexOf(id) !== index; });
check("no id is declared twice", unique(duplicates).length === 0, unique(duplicates).join(", "));

console.log("");
console.log("tabs");

var tabIds = unique(matches(html, 'data-tab="([^"]+)"'));
check("there are tabs to switch between", tabIds.length >= 4, String(tabIds.length));
tabIds.forEach(function (tabId) {
  check("tab '" + tabId + "' has a section", html.indexOf('id="view-' + tabId + '"') >= 0);
});

var viewIds = unique(matches(html, 'id="view-([^"]+)"'));
var orphanViews = viewIds.filter(function (viewId) { return tabIds.indexOf(viewId) < 0; });
check("every section belongs to a tab", orphanViews.length === 0, orphanViews.join(", "));

check("showTab looks up each section",
  matches(js, 'el\\.view([A-Z][a-zA-Z]*)\\.style\\.display').length === viewIds.length,
  matches(js, 'el\\.view([A-Z][a-zA-Z]*)\\.style\\.display').join(", "));

console.log("");
console.log("the footer across tabs");

var generateArea = divBlock(html, "generateArea");
check("the footer has a Generate area", generateArea.length > 0);
check("Generate lives in it", generateArea.indexOf('id="generateBtn"') >= 0);
check("the replace switch lives in it", generateArea.indexOf('id="replacePrevious"') >= 0);
check("Clear Generated is outside it, so it survives a tab switch",
  generateArea.indexOf('id="clearGeneratedBtn"') < 0 && html.indexOf('id="clearGeneratedBtn"') > 0);
check("Refresh is outside it, so it survives a tab switch",
  generateArea.indexOf('id="refreshBtn"') < 0 && html.indexOf('id="refreshBtn"') > 0);
check("the status line is outside it, so messages show on every tab",
  generateArea.indexOf('id="status"') < 0 && html.indexOf('id="status"') > 0);
check("the Generate area starts hidden, so it cannot flash on another tab",
  /<div id="generateArea"[^>]*style="display:none"/.test(html));

check("showTab shows the Generate area only for the style tab",
  /el\.generateArea\.style\.display\s*=\s*tabId === "style"/.test(js));
check("showTab is given the style tab's id", tabIds.indexOf("style") >= 0);

console.log("");
console.log("coming back to the panel");

var focusHandler = "";
var focusAt = js.indexOf("root.onfocus");
if (focusAt >= 0) {
  var end = js.indexOf("\n    };", focusAt);
  focusHandler = js.slice(focusAt, end < 0 ? focusAt + 500 : end);
}
check("the panel listens for focus", focusAt >= 0);
check("it re-reads the active comp", focusHandler.indexOf("refreshCompInfo()") >= 0);
check("it stands down while a job is running", focusHandler.indexOf("state.busy") >= 0);
check("it throttles repeated focus events", focusHandler.indexOf("lastFocusCheck") >= 0);
check("it never touches the chosen audio path", focusHandler.indexOf("useCompMedia") < 0);
check("it does not re-enumerate fonts", focusHandler.indexOf("loadFonts") < 0);

console.log("");
console.log("styling for the markup");

["\\.footer", "\\.control-toggle", "\\.btn", "\\.status"].forEach(function (selector) {
  check("style.css has " + selector, new RegExp(selector + "\\s*[,{]").test(css));
});

console.log("");
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
}
console.log("all " + checks + " panel checks passed");
process.exit(0);
