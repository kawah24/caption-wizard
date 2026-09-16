/**
 * Caption Wizard - transcript parsing and timing.
 *
 * Pure functions: no DOM, no network. Turns pasted text or an SRT file into a
 * normalised caption list with explicit millisecond timings, plus a
 * deterministic per-word estimate when a cue has no word-level data.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    wpm: 165,            // reading speed used to size a generated cue
    minCueMs: 600,       // a cue is never shorter than this
    gapMs: 80,           // silence inserted between generated cues
    offsetMs: 0,         // global shift applied to every cue
    wordsPerCaption: 0   // 0 = derive from the style's max words per line
  };

  function normalizeNewlines(value) {
    return String(value === null || value === undefined ? "" : value).replace(/\r\n?/g, "\n");
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function looksLikeSrt(text) {
    return /-->/.test(normalizeNewlines(text));
  }

  /** "00:00:01,250" (or with a dot, or without ms) -> milliseconds, else null. */
  function timeToMs(stamp) {
    var match = /(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/.exec(String(stamp || ""));
    if (!match) return null;
    var fraction = match[4] || "0";
    while (fraction.length < 3) fraction += "0";
    return (parseInt(match[1], 10) * 3600000) +
           (parseInt(match[2], 10) * 60000) +
           (parseInt(match[3], 10) * 1000) +
           parseInt(fraction, 10);
  }

  function padNumber(value, size) {
    var out = String(value);
    while (out.length < size) out = "0" + out;
    return out;
  }

  function msToTime(ms) {
    var total = Math.max(0, Math.round(ms));
    var hours = Math.floor(total / 3600000);
    var minutes = Math.floor((total % 3600000) / 60000);
    var seconds = Math.floor((total % 60000) / 1000);
    var millis = total % 1000;
    return padNumber(hours, 2) + ":" + padNumber(minutes, 2) + ":" +
           padNumber(seconds, 2) + "," + padNumber(millis, 3);
  }

  function splitWords(text) {
    var parts = normalizeNewlines(text).replace(/\n/g, " ").split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var word = parts[i].replace(/^\s+|\s+$/g, "");
      if (word.length) out.push(word);
    }
    return out;
  }

  function countWords(text) {
    return splitWords(text).length;
  }

  /** Split one word list into chunks of at most `size` words. */
  function chunkWords(words, size) {
    if (!size || size < 1) return [words.slice(0)];
    var chunks = [];
    for (var i = 0; i < words.length; i += size) {
      chunks.push(words.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Parse SRT (or any subtitle body using the same "-->" timecode lines).
   * Cue text keeps internal line breaks as spaces, so one cue becomes one
   * text layer and wrapping is left to After Effects.
   */
  function parseSrt(text) {
    var body = normalizeNewlines(text);
    var blocks = body.split(/\n{2,}/);
    var cues = [];

    for (var i = 0; i < blocks.length; i++) {
      var lines = [];
      var rawLines = blocks[i].split("\n");
      for (var r = 0; r < rawLines.length; r++) {
        if (String(rawLines[r]).replace(/^\s+|\s+$/g, "").length) lines.push(rawLines[r]);
      }
      if (!lines.length) continue;

      var timingIndex = -1;
      for (var t = 0; t < lines.length; t++) {
        if (lines[t].indexOf("-->") >= 0) { timingIndex = t; break; }
      }
      if (timingIndex < 0) continue;

      var parts = lines[timingIndex].split("-->");
      if (parts.length < 2) continue;

      var startMs = timeToMs(parts[0]);
      var endMs = timeToMs(parts[1]);
      if (startMs === null || endMs === null) continue;

      var textLines = lines.slice(timingIndex + 1);
      for (var c = 0; c < textLines.length; c++) {
        textLines[c] = String(textLines[c]).replace(/^\s+|\s+$/g, "").replace(/<[^>]*>/g, "");
      }
      var cueText = textLines.join(" ").replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "");
      if (!cueText.length) continue;

      cues.push({ startMs: startMs, endMs: Math.max(endMs, startMs + 1), text: cueText, explicit: true });
    }

    return cues;
  }

  /**
   * Sequence used when the input has no timings: size each cue from the
   * reading speed and lay them out back to back with a fixed gap.
   */
  function sequenceCues(cues, options) {
    var opts = options || {};
    var wpm = (isFiniteNumber(opts.wpm) && opts.wpm > 20) ? opts.wpm : DEFAULTS.wpm;
    var gapMs = isFiniteNumber(opts.gapMs) ? opts.gapMs : DEFAULTS.gapMs;
    var minCueMs = isFiniteNumber(opts.minCueMs) ? opts.minCueMs : DEFAULTS.minCueMs;
    var msPerWord = 60000 / wpm;
    var cursor = 0;
    var out = [];

    for (var i = 0; i < cues.length; i++) {
      var wordCount = Math.max(1, countWords(cues[i].text));
      var duration = Math.max(minCueMs, Math.round(wordCount * msPerWord));
      out.push({
        startMs: cursor,
        endMs: cursor + duration,
        text: cues[i].text,
        explicit: !!cues[i].explicit
      });
      cursor += duration + gapMs;
    }

    return out;
  }

  /**
   * Distribute a cue's duration across its words: 40% equal share, 60%
   * weighted by word length, so long words hold the frame longer. The last
   * word always ends exactly on the cue end, so timing never drifts.
   */
  function estimateWords(text, startMs, endMs) {
    var words = splitWords(text);
    if (!words.length) return [];

    var totalWeight = 0;
    var i;
    for (i = 0; i < words.length; i++) totalWeight += Math.max(1, words[i].length);

    var duration = Math.max(1, endMs - startMs);
    var equalShare = duration / words.length;
    var cursor = startMs;
    var out = [];

    for (i = 0; i < words.length; i++) {
      var weighted = duration * (Math.max(1, words[i].length) / totalWeight);
      var span = Math.max(1, Math.round(equalShare * 0.4 + weighted * 0.6));
      var wordEnd = (i === words.length - 1) ? endMs : Math.min(endMs, cursor + span);
      if (wordEnd <= cursor) wordEnd = Math.min(endMs, cursor + 1);
      out.push({ text: words[i], startMs: cursor, endMs: wordEnd });
      cursor = wordEnd;
    }

    return out;
  }

  function applyOffset(cues, offsetMs) {
    if (!isFiniteNumber(offsetMs) || offsetMs === 0) return cues;
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      out.push({
        startMs: cues[i].startMs + offsetMs,
        endMs: cues[i].endMs + offsetMs,
        text: cues[i].text,
        explicit: cues[i].explicit
      });
    }
    return out;
  }

  /** Drop cues pushed before zero and re-clamp so nothing starts negative. */
  function clampToZero(cues) {
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var start = Math.max(0, cues[i].startMs);
      var end = Math.max(start + 1, cues[i].endMs);
      out.push({ startMs: start, endMs: end, text: cues[i].text, explicit: cues[i].explicit });
    }
    return out;
  }

  function withWords(cues, options) {
    var opts = options || {};
    var wordByWord = !!opts.wordByWord;
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      out.push({
        text: cues[i].text,
        startMs: cues[i].startMs,
        endMs: cues[i].endMs,
        words: wordByWord ? estimateWords(cues[i].text, cues[i].startMs, cues[i].endMs) : []
      });
    }
    return out;
  }

  /** Join a run of words back into caption text. */
  function joinWords(words) {
    var parts = [];
    for (var i = 0; i < words.length; i++) parts.push(words[i].text);
    return parts.join(" ");
  }

  /**
   * Wrap cues that are longer than the style allows into several cues.
   *
   * Speech segments and subtitle cues are good sentence units but often too long
   * for a caption style, and this used to be skipped for anything carrying real
   * timings - so Max words quietly did nothing for a transcription or an SRT.
   * Splitting happens on real word timings when they exist, which keeps each new
   * cue's in and out points exact rather than proportional.
   */
  function wrapCuesWithWords(cues, maxWords, wordByWord) {
    if (!maxWords || maxWords < 1) return cues;

    var out = [];
    var i;

    for (i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var words = (cue.words && cue.words.length)
        ? cue.words
        : estimateWords(cue.text, cue.startMs, cue.endMs);

      if (words.length <= maxWords) {
        out.push({
          text: cue.text,
          startMs: cue.startMs,
          endMs: cue.endMs,
          words: wordByWord ? words : [],
          explicit: true
        });
        continue;
      }

      for (var p = 0; p < words.length; p += maxWords) {
        var piece = words.slice(p, p + maxWords);
        out.push({
          text: joinWords(piece),
          startMs: piece[0].startMs,
          endMs: piece[piece.length - 1].endMs,
          words: wordByWord ? piece : [],
          explicit: true
        });
      }
    }

    return out;
  }

  /**
   * Plan from cues that already carry real timings - the offline transcriber
   * produces these, and so does an SRT. Cue boundaries are respected as produced
   * up to the style's word limit.
   */
  function planFromCues(cues, options) {
    var opts = options || {};
    var offsetMs = isFiniteNumber(opts.offsetMs) ? opts.offsetMs : 0;
    var wordByWord = !!opts.wordByWord;
    var maxWords = (isFiniteNumber(opts.wordsPerCaption) && opts.wordsPerCaption > 0)
      ? opts.wordsPerCaption
      : 0;

    cues = wrapCuesWithWords(cues, maxWords, wordByWord);

    var captions = [];
    var i;
    var w;

    for (i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var startMs = Math.max(0, cue.startMs + offsetMs);
      var endMs = Math.max(startMs + 1, cue.endMs + offsetMs);
      var words = null;

      // Word data is only carried when the style actually uses it, which keeps
      // the payload that crosses evalScript as small as possible.
      if (wordByWord && cue.words && cue.words.length) {
        words = [];
        for (w = 0; w < cue.words.length; w++) {
          var wordStart = Math.max(0, cue.words[w].startMs + offsetMs);
          var wordEnd = Math.max(wordStart + 1, cue.words[w].endMs + offsetMs);
          words.push({ text: cue.words[w].text, startMs: wordStart, endMs: wordEnd });
        }
      } else if (wordByWord) {
        words = estimateWords(cue.text, startMs, endMs);
      }

      captions.push({ text: cue.text, startMs: startMs, endMs: endMs, words: words || [] });
    }

    var durationMs = 0;
    for (i = 0; i < captions.length; i++) {
      if (captions[i].endMs > durationMs) durationMs = captions[i].endMs;
    }

    return { captions: captions, mode: "asr", durationMs: durationMs };
  }

  /** Wrap an over-long cue into several evenly-timed cues. */
  function wrapLongCues(cues, maxWords) {
    var wrapped = [];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var cueWords = splitWords(cue.text);
      if (cueWords.length <= maxWords) {
        wrapped.push(cue);
        continue;
      }
      var pieces = chunkWords(cueWords, maxWords);
      var span = (cue.endMs - cue.startMs) / pieces.length;
      for (var p = 0; p < pieces.length; p++) {
        wrapped.push({
          text: pieces[p].join(" "),
          startMs: Math.round(cue.startMs + span * p),
          endMs: Math.round(cue.startMs + span * (p + 1)),
          explicit: cue.explicit
        });
      }
    }
    return wrapped;
  }

  /**
   * Main entry point.
   *
   * planCaptions(rawText, { wpm, gapMs, offsetMs, minCueMs, wordsPerCaption, wordByWord })
   *   -> { captions: [...], mode: "srt" | "plain", durationMs: n }
   */
  function planCaptions(rawText, options) {
    var opts = options || {};
    var source = normalizeNewlines(rawText);
    var mode = looksLikeSrt(source) ? "srt" : "plain";
    var rawCues = [];
    var i;

    if (mode === "srt") {
      rawCues = parseSrt(source);
    } else {
      var lines = source.split("\n");
      var pending = [];
      for (i = 0; i < lines.length; i++) {
        var line = String(lines[i]).replace(/^\s+|\s+$/g, "");
        if (!line.length) continue;
        pending.push({ text: splitWords(line).join(" "), explicit: false });
      }
      rawCues = sequenceCues(pending, opts);
    }

    var maxWords = (isFiniteNumber(opts.wordsPerCaption) && opts.wordsPerCaption > 0)
      ? opts.wordsPerCaption
      : 6;
    var wrapped = wrapLongCues(rawCues, maxWords);

    var offsetMs = isFiniteNumber(opts.offsetMs) ? opts.offsetMs : 0;
    var timed = clampToZero(applyOffset(wrapped, offsetMs));
    var captions = withWords(timed, opts);

    var durationMs = 0;
    for (i = 0; i < captions.length; i++) {
      if (captions[i].endMs > durationMs) durationMs = captions[i].endMs;
    }

    return { captions: captions, mode: mode, durationMs: durationMs };
  }

  /**
   * Pick a caption worth judging a style with.
   *
   * The first caption whose word count sits in a representative range wins, so a
   * style is not previewed on a single word or on a very long line. Falls back to
   * the first caption, or null when there is nothing loaded.
   */
  function pickPreviewCaption(captions, options) {
    if (!captions || !captions.length) return null;

    var opts = options || {};
    var min = isFiniteNumber(opts.minWords) ? opts.minWords : 2;
    var max = isFiniteNumber(opts.maxWords) ? opts.maxWords : 6;
    var i;

    for (i = 0; i < captions.length; i++) {
      var count = countWords(captions[i].text);
      if (count >= min && count <= max) return captions[i];
    }
    return captions[0];
  }

  /**
   * Break a caption across lines, balancing the words with the earlier lines
   * taking the remainder (4 words over 3 lines becomes 2/1/1).
   *
   * "Lines per caption" is a maximum, and Max words decides how much text a
   * caption holds, so the two together set the words per line: with a 6-word
   * caption limit and 3 lines, a 3-word caption takes two lines, not three.
   * Mirrors the host's lcp_splitLines exactly.
   */
  function splitIntoLines(text, lineCount, maxWords) {
    var value = normalizeNewlines(text).replace(/\n/g, " ");
    var target = parseInt(lineCount, 10);
    if (isNaN(target) || target < 2) return [value];

    var words = splitWords(value);
    if (words.length < 2) return [value];

    var limit = parseInt(maxWords, 10);
    if (!isNaN(limit) && limit > 0) {
      var perLine = Math.max(1, Math.ceil(limit / target));
      var needed = Math.ceil(words.length / perLine);
      if (needed < target) target = needed;
    }

    if (target > words.length) target = words.length;
    if (target < 2) return [value];

    var base = Math.floor(words.length / target);
    var extra = words.length % target;
    var lines = [];
    var index = 0;

    for (var line = 0; line < target; line++) {
      var count = base + (line < extra ? 1 : 0);
      var parts = [];
      for (var i = 0; i < count; i++) {
        parts.push(words[index]);
        index++;
      }
      lines.push(parts.join(" "));
    }
    return lines;
  }

  root.LcpTranscript = {
    DEFAULTS: DEFAULTS,
    planCaptions: planCaptions,
    planFromCues: planFromCues,
    pickPreviewCaption: pickPreviewCaption,
    splitIntoLines: splitIntoLines,
    wrapCuesWithWords: wrapCuesWithWords,
    parseSrt: parseSrt,
    splitWords: splitWords,
    countWords: countWords,
    estimateWords: estimateWords,
    timeToMs: timeToMs,
    msToTime: msToTime,
    looksLikeSrt: looksLikeSrt,
    normalizeNewlines: normalizeNewlines,
    clamp: clamp
  };
})(window);
