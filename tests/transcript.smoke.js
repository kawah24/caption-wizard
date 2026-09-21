/**
 * Smoke test for client/transcript.js
 *
 * Exercises the pure parsing/timing logic outside After Effects.
 * Run from the extension root:   node tests/transcript.smoke.js
 * Exits 0 when every check passes, 1 otherwise.
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var target = path.join(__dirname, "..", "client", "transcript.js");
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(target, "utf8"), sandbox);

var T = sandbox.window.LcpTranscript;

var failures = 0;
var checks = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    console.log("  PASS  " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + (detail === undefined ? "" : "  -> " + detail));
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

console.log("transcript.js smoke test");
console.log("");

console.log("timecode parsing");
eq("timeToMs mm:ss,ms", T.timeToMs("00:00:01,250"), 1250);
eq("timeToMs hh:mm:ss.mmm", T.timeToMs("01:02:03.004"), 3723004);
eq("timeToMs without ms", T.timeToMs("00:00:07"), 7000);
eq("timeToMs rejects junk", T.timeToMs("not a time"), null);

console.log("");
console.log("SRT mode");
var srt = [
  "1",
  "00:00:01,000 --> 00:00:03,500",
  "Hello there world",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "<i>Second</i> line here",
  ""
].join("\n");

var srtPlan = T.planCaptions(srt, {});
eq("mode detected as srt", srtPlan.mode, "srt");
eq("cue count", srtPlan.captions.length, 2);
eq("first cue start", srtPlan.captions[0].startMs, 1000);
eq("first cue end", srtPlan.captions[0].endMs, 3500);
eq("markup tags stripped", srtPlan.captions[1].text, "Second line here");
eq("timeline duration", srtPlan.durationMs, 6000);

console.log("");
console.log("plain-text mode");
var plain = "One two three four five\nSix seven";
var plainPlan = T.planCaptions(plain, { wpm: 165, gapMs: 80, wordsPerCaption: 6 });
eq("mode detected as plain", plainPlan.mode, "plain");
eq("cue count", plainPlan.captions.length, 2);
eq("first cue starts at zero", plainPlan.captions[0].startMs, 0);

var ordered = true;
for (var i = 1; i < plainPlan.captions.length; i++) {
  if (plainPlan.captions[i].startMs <= plainPlan.captions[i - 1].startMs) ordered = false;
  if (plainPlan.captions[i].startMs < plainPlan.captions[i - 1].endMs + 79) ordered = false;
}
check("cues are ordered with the requested gap", ordered);

console.log("");
console.log("word wrap");
var longLine = "one two three four five six seven eight nine ten eleven twelve";
var wrapped = T.planCaptions(longLine, { wordsPerCaption: 6 });
eq("12 words at 6 per caption", wrapped.captions.length, 2);
eq("first wrapped cue", wrapped.captions[0].text, "one two three four five six");
eq("second wrapped cue", wrapped.captions[1].text, "seven eight nine ten eleven twelve");

console.log("");
console.log("offset");
var shifted = T.planCaptions(srt, { offsetMs: 500 });
eq("offset applied", shifted.captions[0].startMs, 1500);
var pulledBack = T.planCaptions(srt, { offsetMs: -2000 });
eq("negative offset clamped at zero", pulledBack.captions[0].startMs, 0);

console.log("");
console.log("per-word timing estimate");
var words = T.estimateWords("hello wonderful world", 1000, 4000);
eq("word count", words.length, 3);
eq("first word starts at cue start", words[0].startMs, 1000);
eq("last word ends at cue end", words[words.length - 1].endMs, 4000);

var monotonic = true;
for (var w = 0; w < words.length; w++) {
  if (words[w].endMs <= words[w].startMs) monotonic = false;
  if (w > 0 && words[w].startMs !== words[w - 1].endMs) monotonic = false;
}
check("word timings are contiguous and positive", monotonic);
check("longer word gets more time", (words[1].endMs - words[1].startMs) > (words[2].endMs - words[2].startMs));

console.log("");
console.log("word-by-word payload");
var wbw = T.planCaptions("alpha beta gamma", { wordByWord: true, wpm: 165 });
check("words attached when requested", wbw.captions[0].words.length === 3, JSON.stringify(wbw.captions[0].words));
check("words omitted when not requested",
  T.planCaptions("alpha beta", { wordByWord: false }).captions[0].words.length === 0);

console.log("");
console.log("transcriber cues (real timings preserved)");
var asrCues = [
  { text: "Hello there world", startMs: 1000, endMs: 4000, words: [
      { text: "Hello", startMs: 1000, endMs: 1700 },
      { text: "there", startMs: 1700, endMs: 2500 },
      { text: "world", startMs: 2500, endMs: 4000 }
  ] },
  { text: "Second cue", startMs: 5000, endMs: 6500, words: [] }
];

var asrPlan = T.planFromCues(asrCues, { wordByWord: true });
eq("asr mode", asrPlan.mode, "asr");
eq("asr cue count", asrPlan.captions.length, 2);
eq("real word timings kept", asrPlan.captions[0].words[2].endMs, 4000);
eq("cue boundaries kept", asrPlan.captions[1].endMs, 6500);
check("missing words estimated when word-by-word", asrPlan.captions[1].words.length === 2);

var asrOffset = T.planFromCues(asrCues, { offsetMs: -500, wordByWord: true });
eq("offset shifts cues", asrOffset.captions[0].startMs, 500);
eq("offset shifts words too", asrOffset.captions[0].words[0].startMs, 500);

eq("words omitted when not word-by-word", T.planFromCues(asrCues, {}).captions[0].words.length, 0);

console.log("");
console.log("lines and max words decide the break together");
eq("a 3-word caption with a 6-word limit takes two lines",
  T.splitIntoLines("Dolly Parton writes", 3, 6).join("|"), "Dolly Parton|writes");
eq("a 3-word caption with a 3-word limit uses all three lines",
  T.splitIntoLines("Dolly Parton writes", 3, 3).join("|"), "Dolly|Parton|writes");
eq("6 words with a 6-word limit fill three lines",
  T.splitIntoLines("a b c d e f", 3, 6).join("|"), "a b|c d|e f");
eq("4 words with a 12-word limit stay on one line",
  T.splitIntoLines("a b c d", 3, 12).join("|"), "a b c d");
eq("a missing limit keeps the old behaviour", T.splitIntoLines("a b c d", 3).join("|"), "a b|c|d");

console.log("");
console.log("max words applies to timecoded cues too");
var asrCues = [
  { text: "one two three four five", startMs: 0, endMs: 5000, words: [
      { text: "one", startMs: 0, endMs: 1000 },
      { text: "two", startMs: 1000, endMs: 2000 },
      { text: "three", startMs: 2000, endMs: 3000 },
      { text: "four", startMs: 3000, endMs: 4000 },
      { text: "five", startMs: 4000, endMs: 5000 }
  ] }
];
var wrappedAsr = T.planFromCues(asrCues, { wordsPerCaption: 3, wordByWord: true });
eq("a long cue is split", wrappedAsr.captions.length, 2);
eq("first piece", wrappedAsr.captions[0].text, "one two three");
eq("second piece", wrappedAsr.captions[1].text, "four five");
eq("the split uses the real word start", wrappedAsr.captions[1].startMs, 3000);
eq("the split uses the real word end", wrappedAsr.captions[1].endMs, 5000);
eq("word data follows each piece", wrappedAsr.captions[0].words.length, 3);
eq("the last piece keeps its words", wrappedAsr.captions[1].words.length, 2);

var shortCue = T.planFromCues([{ text: "one two", startMs: 0, endMs: 2000, words: [] }], { wordsPerCaption: 3 });
eq("a short cue is left alone", shortCue.captions.length, 1);
eq("a limit of 0 means leave everything alone",
  T.planFromCues(asrCues, { wordsPerCaption: 0 }).captions.length, 1);
eq("cues without word data are still wrapped",
  T.planFromCues([{ text: "one two three four", startMs: 0, endMs: 4000, words: [] }], { wordsPerCaption: 2 }).captions.length, 2);
var asrOffset = T.planFromCues(asrCues, { wordsPerCaption: 3, offsetMs: 500 });
eq("wrapping happens before the offset is applied", asrOffset.captions[1].startMs, 3500);

console.log("");
console.log("karaoke word data");
var karaokePlan = T.planCaptions("never give up now", { wpm: 165, wordByWord: true });
var karaokeCue = karaokePlan.captions[0];
eq("words present for karaoke", karaokeCue.words.length, 4);
check("word timings stay inside their cue",
  karaokeCue.words[0].startMs >= karaokeCue.startMs &&
  karaokeCue.words[karaokeCue.words.length - 1].endMs <= karaokeCue.endMs,
  JSON.stringify([karaokeCue.startMs, karaokeCue.endMs, karaokeCue.words]));

console.log("");
console.log("lines per caption");
eq("one line passes through", T.splitIntoLines("one two three", 1).join("|"), "one two three");
eq("two lines split evenly", T.splitIntoLines("one two three four", 2).join("|"), "one two|three four");
eq("four words over three lines is 2/1/1", T.splitIntoLines("a b c d", 3).join("|"), "a b|c|d");
eq("seven over three is 3/2/2", T.splitIntoLines("a b c d e f g", 3).join("|"), "a b c|d e|f g");
eq("six over three is even", T.splitIntoLines("a b c d e f", 3).join("|"), "a b|c d|e f");
eq("more lines than words gives one word each", T.splitIntoLines("a b", 3).join("|"), "a|b");
eq("a single word stays put", T.splitIntoLines("alone", 3).join("|"), "alone");
eq("blank input is safe", T.splitIntoLines("", 3).join("|"), "");
eq("extra whitespace is normalised", T.splitIntoLines("a   b  c d", 2).join("|"), "a b|c d");
check("the display text is preserved when joined",
  T.splitIntoLines("one two three four", 3).join(" ") === "one two three four");

console.log("");
console.log("preview caption choice");
var previewCues = [
  { text: "1974", startMs: 0, endMs: 1000, words: [] },
  { text: "Dolly Parton writes I will always love you", startMs: 1000, endMs: 2000, words: [] },
  { text: "Elvis hears it", startMs: 2000, endMs: 3000, words: [] }
];
var picked = T.pickPreviewCaption(previewCues, {});
check("skips a one-word caption", picked.text === "Elvis hears it", picked.text);
eq("falls back to the first when nothing fits",
  T.pickPreviewCaption([{ text: "one", words: [] }, { text: "two three four five six seven eight", words: [] }], {}).text,
  "one");
eq("nothing to preview returns null", T.pickPreviewCaption([], {}), null);
eq("null input is safe", T.pickPreviewCaption(null, {}), null);
check("the range is configurable",
  T.pickPreviewCaption(previewCues, { minWords: 1, maxWords: 1 }).text === "1974");

console.log("");
console.log("empty input");
var empty = T.planCaptions("   \n\n  ", {});
eq("no captions from whitespace", empty.captions.length, 0);

console.log("");
console.log("split captions by sentence");

var sentences = T.planCaptions("One thing. Two things! Three things?", { wordsPerCaption: 10, splitBySentence: true });
eq("one caption per sentence", sentences.captions.length, 3);
eq("the first sentence is intact", sentences.captions[0].text, "One thing.");
eq("the last sentence too", sentences.captions[2].text, "Three things?");

var sentenceOff = T.planCaptions("One thing. Two things! Three things?", { wordsPerCaption: 10, splitBySentence: false });
eq("with the setting off nothing changes", sentenceOff.captions.length, 1);

var longSentence = T.planCaptions("Dolly writes songs. She sings every single night.", { wordsPerCaption: 3, splitBySentence: true });
eq("a sentence inside the limit is not split", longSentence.captions[0].text, "Dolly writes songs.");
eq("a sentence over the limit is still wrapped", longSentence.captions.length, 3);
eq("the wrapped tail is right", longSentence.captions[2].text, "single night.");

var kept = T.planCaptions("First words here. Second words here.", { wordsPerCaption: 10, splitBySentence: true });
eq("no word is lost",
  kept.captions.map(function (c) { return c.text; }).join(" "), "First words here. Second words here.");
check("every caption still has a real window",
  kept.captions.every(function (c) { return c.endMs > c.startMs; }));
check("captions stay in order",
  kept.captions[1].startMs >= kept.captions[0].endMs);

console.log("");
console.log("the first cue is pulled back to where the speech starts");

var lateCues = [{ text: "In 1974", startMs: 700, endMs: 6100, words: [{ text: "In", startMs: 700, endMs: 900 }] }];
T.clampFirstCue(lateCues, 294);
eq("a late first cue moves to the onset", lateCues[0].startMs, 294);
eq("its first word moves with it", lateCues[0].words[0].startMs, 294);
eq("the end is left alone", lateCues[0].endMs, 6100);

var closeCues = [{ text: "x", startMs: 350, endMs: 900 }];
T.clampFirstCue(closeCues, 294);
eq("a cue already close enough is left alone", closeCues[0].startMs, 350);

var laterCues = [{ text: "a", startMs: 900, endMs: 1200 }, { text: "b", startMs: 1300, endMs: 1600 }];
T.clampFirstCue(laterCues, 500);
eq("only the first cue moves", laterCues[1].startMs, 1300);

var noOnset = [{ text: "x", startMs: 900, endMs: 1200 }];
T.clampFirstCue(noOnset, undefined);
eq("no onset from the transcriber means no change", noOnset[0].startMs, 900);
T.clampFirstCue(noOnset, -1);
eq("a nonsense onset is ignored", noOnset[0].startMs, 900);
check("an empty plan is safe", T.clampFirstCue([], 100).length === 0);
console.log("");
if (failures) {
  console.log(failures + " of " + checks + " checks FAILED");
  process.exit(1);
} else {
  console.log("all " + checks + " checks passed");
  process.exit(0);
}
