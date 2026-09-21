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
console.log("");
console.log("");
console.log("");
console.log("a style can be backed up and brought back");

check("export writes a portable payload", /captionWizard: 1,/.test(js) && /overrides: state\.overrides/.test(js));
check("import refuses text that is not a style",
  /does not look like a style/.test(js) && /missing the settings/.test(js));
check("import refuses a style built on a preset this panel does not have",
  /is not in this panel/.test(js));
check("import renames rather than overwriting", /the name was taken/.test(js));
check("the box and both buttons exist",
  /id="styleIO"/.test(html) && /id="exportStyleBtn"/.test(html) && /id="importStyleBtn"/.test(html));
console.log("saved styles sit in their own section");

check("the grid builds a Custom heading", /heading\.textContent = "Custom"/.test(js));
check("and a Default heading for the shipped styles", /shipped\.textContent = "Default"/.test(js));
check("only when there are saved styles",
  (function () {
    var guard = js.indexOf("if (state.customStyles.length) {");
    var heading = js.indexOf('heading.textContent = "Custom"');
    return guard > 0 && heading > guard;
  })(),
  "an empty section would be clutter");
check("the heading spans the grid rather than filling a cell",
  /\.grid-section\s*\{[\s\S]{0,80}grid-column: 1 \/ -1;/.test(
    fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8")));
console.log("");
console.log("the clamp is actually called, not just available");

check("the clamp runs on the segments before the SRT and the cues are derived",
  /var segments = root\.LcpTranscript\.clampFirstCue\(result\.segments, result\.onsetMs\);/.test(js) &&
  /segmentsToSrt\(segments\)/.test(js) && /segmentsToCues\(segments\)/.test(js),
  "clamping the cues alone left the exported SRT late, which is what the panel showed");
check("the model default is small, not whatever the markup lists first",
  /var DEFAULT_MODEL = "small";/.test(js) &&
  /MODELS\.indexOf\(savedModel\) >= 0 \? savedModel : DEFAULT_MODEL/.test(js),
  "the select kept the first option, which is tiny");
console.log("");
console.log("the transcribe tab explains itself");

check("the model dropdown has a tooltip and a hint line",
  /id="modelSelect"[\s\S]{0,300}?title=/.test(html) && /id="modelHint"/.test(html));
check("the download checkbox says when it is needed",
  /id="allowDownload"[\s\S]{0,200}?title=/.test(html) && /say \(cached\)|says \(cached\)/.test(html));
check("the language and audio controls have tooltips",
  /id="languageSelect"[\s\S]{0,200}?title=/.test(html) && /id="audioPath"[\s\S]{0,200}?title=/.test(html));

var modelsList = (js.match(/var MODELS = \[([^\]]+)\]/) || [])[1] || "";
var notesBlock = (js.match(/var MODEL_NOTES = \{([\s\S]*?)\n  \};/) || [])[1] || "";
var missing = [];
modelsList.split(",").forEach(function (raw) {
  var name = raw.replace(/["'\s]/g, "");
  if (name && notesBlock.indexOf('"' + name + '"') < 0) missing.push(name);
});
check("every model in the list has a note, so a new one cannot ship silent",
  missing.length === 0, "no note for: " + missing.join(", "));
check("the hint is updated when the model changes",
  /updateModelHint\(\)[\s\S]{0,120}?onchange/.test(js.replace(/\n/g, " ")) || (js.match(/updateModelHint\(\);/g) || []).length >= 3);
console.log("");
console.log("the timing tab explains itself and can be reset");

var presetsSrc = fs.readFileSync(path.join(__dirname, "..", "client", "presets.js"), "utf8");
var timingDefsBlock = (presetsSrc.match(/var TIMING_DEFS = \{([\s\S]*?)\n  \};/) || [])[1] || "";
var timingHelpBlock = (presetsSrc.match(/var TIMING_HELP = \{([\s\S]*?)\n  \};/) || [])[1] || "";
var timingKeys = (timingDefsBlock.match(/^\s{4}(\w+):/gm) || []).map(function (s) { return s.replace(/[:\s]/g, ""); });
var missingTimingHelp = timingKeys.filter(function (k) { return timingHelpBlock.indexOf(k + ":") < 0; });
check("every timing control has a tooltip",
  timingKeys.length >= 3 && missingTimingHelp.length === 0,
  "no help for: " + missingTimingHelp.join(", "));
check("the timing help is stamped onto the defs, the way control help is",
  /TIMING_DEFS\[timingHelpKey\]\.help = TIMING_HELP\[timingHelpKey\]/.test(presetsSrc),
  "the table alone would not reach the rows");
check("the reset button is in the markup", /id="resetTimingBtn"/.test(html));
check("the reset clears the panel's own timing values",
  /function resetTiming\(\)/.test(js) && /state\.timing = \{\};/.test(js));
check("the reset button is wired", /resetTimingBtn\.onclick = resetTiming/.test(js));
console.log("");
console.log("the text section tells you how to use it");

var tipsBlock = (html.match(/<ul class="tips">([\s\S]*?)<\/ul>/) || [])[1] || "";
check("the text section has a how-to list", tipsBlock.length > 0);
check("it names all four routes in", /One caption per line/.test(tipsBlock) &&
  /Load an SRT/.test(tipsBlock) && /Pick a style, then generate/.test(tipsBlock) &&
  /Auto section/.test(tipsBlock));
check("the list sits above the transcript box, not below it",
  html.indexOf('class="tips"') < html.indexOf('id="transcriptInput"'));
check("the tips are styled so they read as help, not content",
  /\.tips \{/.test(fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8")));
console.log("");
console.log("the sample text is a demo, not a second copy of the tips");

var sampleBlock = (js.match(/var SAMPLE_TEXT = \[([\s\S]*?)\]\.join/) || [])[1] || "";
var tipsHtml = (html.match(/<ul class="tips">([\s\S]*?)<\/ul>/) || [])[1] || "";
var tipSentences = (tipsHtml.match(/<li>[^<]*<\/li>/g) || []).map(function (s) {
  return s.replace(/<\/?li>/g, "").replace(/\.$/, "");
});
var echoes = tipSentences.filter(function (t) { return sampleBlock.indexOf(t) >= 0; });
var tipOrder = (tipsHtml.match(/<li>([^<]*)<\/li>/g) || []).map(function (s) { return s.replace(/<\/?li>/g, ""); });
check("the how-to list keeps the order that was asked for",
  tipOrder.length === 5 &&
  tipOrder[0] === "One caption per line." &&
  tipOrder[1] === "Load an SRT to keep your own timecodes." &&
  tipOrder[2] === "Use the Auto section to create captions from your video file." &&
  tipOrder[3] === "Pick a style, then generate." &&
  tipOrder[4] === "Press Sample to try it with a built-in example.",
  "got: " + tipOrder.join(" | "));
var cssSrc = fs.readFileSync(path.join(__dirname, "..", "client", "style.css"), "utf8");
var boxRule = (cssSrc.match(/#transcriptInput \{([\s\S]*?)\}/) || [])[1] || "";
var boxFloor = parseInt((boxRule.match(/min-height:\s*(\d+)px/) || [])[1] || "0", 10);
check("the transcript box takes the leftover height",
  /flex:\s*1 1 auto/.test(boxRule) && /#view-text \{[\s\S]{0,300}?flex-direction:\s*column/.test(cssSrc),
  "the box must flex, or the buttons fall out of view when the panel is short");
check("the view is allowed to shrink to the height it is given",
  /#view-text \{[\s\S]{0,400}?min-height:\s*0/.test(cssSrc),
  "without min-height 0 the view keeps its content height and the buttons leave the window");
check("the box keeps a usable floor", boxFloor >= 120 && boxFloor <= 200,
  "found " + boxFloor + "px; it must shrink on a short panel but not vanish");
check("the box is still resizable by hand", /resize:\s*vertical/.test(cssSrc));
check("the transcript buttons are pinned, so a short panel cannot hide them",
  /#view-text \.row \{[\s\S]{0,200}?position:\s*sticky/.test(cssSrc) &&
  /#view-text \.row \{[\s\S]{0,200}?bottom:\s*0/.test(cssSrc),
  "placing them below the box is not enough when the content is taller than the panel");check("the tips and the button row sit outside the box, so they cannot scroll away with it",
  /<ul class="tips">/.test(html) && html.indexOf('class="tips"') < html.indexOf('id="transcriptInput"') &&
  html.indexOf('id="transcriptInput"') < html.indexOf('id="loadSrtBtn"'));
check("the sample transcript does not repeat the tips above it",
  echoes.length === 0, "repeated: " + echoes.join(" | "));
check("the sample is an actual demo transcript",
  /rain started/i.test(sampleBlock) && sampleBlock.split("\n").length >= 3,
  "the sample should show what captions look like");
check("the placeholder does not repeat them either",
  !/placeholder="[^"]*One caption per line[^"]*"/.test(html),
  "the tip itself contains that sentence, so scope this to the placeholder attribute");
check("the status reports the pull so it is not a silent change",
  /First caption pulled back from/.test(js) && /var wasAt = /.test(js),
  "a correction the user cannot see is indistinguishable from no correction");
check("no path builds the SRT from the raw segments any more",
  !/segmentsToSrt\(result\.segments\)/.test(js));
check("the transcriber reports the onset it measured",
  /"onsetMs": detect_speech_onset/.test(fs.readFileSync(path.join(__dirname, "..", "tools", "transcribe.py"), "utf8")));
console.log("saved styles");

check("the panel persists the session under named keys",
  /lcp\.overrides/.test(js) && /lcp\.presetId/.test(js) && /lcp\.customStyles/.test(js));
check("it restores before the grid is built, inside init",
  (function () {
    var initAt = js.indexOf("function init()");
    if (initAt < 0) return false;
    var body = js.slice(initAt);
    var load = body.indexOf("loadSession();");
    var grid = body.indexOf("renderStyleGrid();");
    return load > 0 && grid > 0 && load < grid;
  })(),
  "restoring after the grid would show the wrong selection");
check("every edit is saved as it happens",
  (function () {
    var onSetting = js.indexOf("function onSettingChanged");
    var save = js.indexOf("saveSession();", onSetting);
    var end = js.indexOf("function ", onSetting + 10);
    return save > onSetting && save < end;
  })());
check("a name is required, and duplicates are refused",
  /Name the style before saving/.test(js) && /already exists/.test(js));
check("saved styles can be deleted", /function deleteCustomStyle/.test(js));
check("the grid offers a way to save and to name",
  /id="saveStyleBtn"/.test(html) && /id="customStyleName"/.test(html));
check("the renderer puts the help text on the row", /if \(def\.help\) wrap\.title = def\.help;/.test(
  fs.readFileSync(path.join(__dirname, "..", "client", "controls.js"), "utf8")));
check("the tabs explain themselves",
  (html.match(/data-tab="[a-z]+"[^>]*title="/g) || []).length === 4,
  String((html.match(/data-tab="[a-z]+"[^>]*title="/g) || []).length));

check("the storage helpers guard against a hostile localStorage",
  /catch \(err\) \{ \/\* private mode etc \*\/ \}/.test(js));
check("switching to the style tab re-fits the stage",
  /if \(tabId === "style"\) \{\s*resizeStage\(\);/.test(js));
check("re-fitting also re-applies the caption's scale",
  /function resizeStage[\s\S]{0,700}applyStageSettings/.test(js));

console.log("the preview is a scaled view, and says so");

check("the stage cap is one named constant",
  /var STAGE_MAX_HEIGHT = \d+;/.test(js), "so the two call sites cannot drift apart");
check("no bare 300 is left for the stage height",
  !/sizeStage\(stage, comp\.width, comp\.height, 300\)/.test(js) && !/maxHeight: 300,/.test(js));
check("both call sites use the constant",
  (js.match(/STAGE_MAX_HEIGHT/g) || []).length >= 3,
  (js.match(/STAGE_MAX_HEIGHT/g) || []).length + " uses");
check("the note prints the frame width and the drawn size",
  /draws a " \+ Math\.round\(settings\.fontSize\)/.test(js) &&
  /root\.LcpPreviews\.sizeFactor\(frameWidth\)/.test(js));
check("the note explains that the share is what matches",
  /same share of the frame as the comp/.test(js));

console.log("");
check("the status names the comp caption's size",
  /Comp caption: /.test(js) && /place\.fontDrawnPx/.test(js) && /place\.fontFace/.test(js));
check("it gives that size as a share of the comp width",
  /place\.fontDrawnPx \/ place\.compWidth \* 100/.test(js));
console.log("the panel reports what the host actually did");

check("the generate message says where the caption was placed",
  /Placed at " \+ Math\.round\(place\.fraction \* 100\)/.test(js));
check("it warns when that disagrees with the Vertical setting",
  /does not match the Vertical setting/.test(js));
check("the comp line counts the layers this panel put there",
  /info\.generated/.test(js) && /from this panel/.test(js));

console.log("");
console.log("the panel can tell a stale comp from a fresh one");

check("it records what the comp was built from",
  /state\.generatedFingerprint = generationFingerprint\(\);/.test(js));
check("it compares that with the settings showing now",
  /state\.generatedFingerprint !== generationFingerprint\(\)/.test(js));
check("it says so under the preview", /press Generate Captions/.test(js));
check("it stays quiet before anything has been generated",
  /state\.generatedFingerprint && state\.generatedFingerprint !==/.test(js));
check("the fingerprint covers the style, the timing and the captions themselves",
  /style: currentSettings\(\)/.test(js) && /timing: currentTiming\(\)/.test(js) && /captions: plan\.captions/.test(js));

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
