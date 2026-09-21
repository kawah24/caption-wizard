/**
 * Caption Wizard - After Effects host script.
 *
 * ExtendScript (ES3) only. Local only: this file performs no network access,
 * talks to no account system, and contains no licence logic. It just builds
 * an animation preset it understands and creates text layers in the active
 * composition.
 *
 * Public entry points (called from the panel through evalScript):
 *   lcp_ping()        -> {"ok":true,"version":"1.3.5"}
 *   lcp_compInfo()    -> active composition summary, or {"ok":false,...}
 *   lcp_listFonts()   -> the fonts After Effects has available, for the picker
 *   lcp_create(json)  -> creates caption layers from a payload
 *   lcp_clear()       -> removes the layers this panel created
 *
 * No #target directive on purpose: the file is loaded by CEP, and staying
 * directive-free keeps it checkable with a plain JavaScript parser.
 */

var LCP_VERSION = "1.3.5";
var LCP_TAG = "LCP::created";

/**
 * What the first text layer of the last generate actually got.
 *
 * Positions depend on where After Effects anchors text, which cannot be checked
 * from outside the app: reporting the numbers back lets the panel show what it
 * really did instead of what it intended.
 */
var _lcpLastPlacement = null;

// What an unknown font family falls back to. Arial ships everywhere, so a style
// can never end up with no usable font. The panel preview falls back to the same
// family, so the two stay in step.
var LCP_FALLBACK_FONT_REGULAR = "ArialMT";
var LCP_FALLBACK_FONT_BOLD = "Arial-BoldMT";

/* ------------------------------------------------------------------ */
/* small helpers                                                      */
/* ------------------------------------------------------------------ */

function lcp_esc(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function lcp_jsonStringArray(list) {
  var parts = [];
  var i;
  for (i = 0; i < list.length; i++) {
    parts.push('"' + lcp_esc(list[i]) + '"');
  }
  return "[" + parts.join(",") + "]";
}

function lcp_ok(extra) {
  return '{"ok":true' + (extra ? "," + extra : "") + "}";
}

function lcp_error(message) {
  return '{"ok":false,"error":"' + lcp_esc(message) + '"}';
}

function lcp_num(value, fallback) {
  var n = parseFloat(value);
  if (isNaN(n) || !isFinite(n)) return fallback;
  return n;
}

/** "#rrggbb" (or "#rgb") -> [r, g, b] in the 0..1 range After Effects wants. */
function lcp_hexToRgb(hex) {
  var text = String(hex === null || hex === undefined ? "#ffffff" : hex).replace("#", "");
  if (text.length === 3) {
    text = text.charAt(0) + text.charAt(0) +
           text.charAt(1) + text.charAt(1) +
           text.charAt(2) + text.charAt(2);
  }
  var value = parseInt(text, 16);
  if (isNaN(value)) return [1, 1, 1];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  ];
}

/**
 * Map a friendly family name onto the PostScript names After Effects expects.
 * Falls back to Arial when the family is unknown.
 */
function lcp_fontPostScript(family, bold) {
  var map = {
    "Arial": ["ArialMT", "Arial-BoldMT"],
    "Arial Black": ["Arial-Black", "Arial-Black"],
    "Segoe UI": ["SegoeUI", "SegoeUI-Bold"],
    "Verdana": ["Verdana", "Verdana-Bold"],
    "Tahoma": ["Tahoma", "Tahoma-Bold"],
    "Trebuchet MS": ["TrebuchetMS", "TrebuchetMS-Bold"],
    "Impact": ["Impact", "Impact"],
    "Georgia": ["Georgia", "Georgia-Bold"],
    "Times New Roman": ["TimesNewRomanPSMT", "TimesNewRomanPS-BoldMT"],
    "Courier New": ["CourierNewPSMT", "CourierNewPS-BoldMT"],
    "Comic Sans MS": ["ComicSansMS", "ComicSansMS-Bold"]
  };

  var entry = map[String(family)];
  if (!entry) {
    // Unknown family: Arial rather than nothing.
    return bold ? LCP_FALLBACK_FONT_BOLD : LCP_FALLBACK_FONT_REGULAR;
  }
  return bold ? entry[1] : entry[0];
}

/* ------------------------------------------------------------------ */
/* font enumeration - app.fonts (After Effects 24.0 and newer)        */
/* ------------------------------------------------------------------ */

var _lcpFontFamilies = null;

// Effect application tally for the current generate run, so the panel can say
// when a shadow or glow could not be added instead of failing silently.
var _lcpEffectLog = null;

var _lcpBuiltinFamilies = [
  "Arial", "Arial Black", "Segoe UI", "Verdana", "Tahoma", "Trebuchet MS",
  "Impact", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"
];

function lcp_isBoldStyle(styleName) {
  var style = String(styleName || "").toLowerCase();
  return style.indexOf("bold") >= 0 ||
         style.indexOf("heavy") >= 0 ||
         style.indexOf("black") >= 0;
}

function lcp_isRegularStyle(styleName) {
  var style = String(styleName || "").toLowerCase();
  return style === "regular" || style === "roman" || style === "book" ||
         style === "normal" || style === "text" || style === "medium";
}

/**
 * Enumerate the fonts After Effects can actually use.
 * Returns [{family, regularPS, boldPS}] sorted by family, or null when the
 * font API is unavailable (older AE) so callers can fall back.
 * Result is cached for the life of the host session.
 */
function lcp_isItalicStyle(styleName) {
  var style = String(styleName || "").toLowerCase();
  return style.indexOf("italic") >= 0 || style.indexOf("oblique") >= 0;
}

/**
 * Flatten one entry of app.fonts.allFonts into individual Font objects.
 *
 * The scripting guide documents allFonts as an "Array of Arrays of Font
 * objects": each entry is a family group. Substituted fonts can arrive as a
 * bare Font object instead of a group, so both shapes are accepted here.
 */
function lcp_flattenFontGroup(group, out) {
  if (!group) return;
  if (group.length !== undefined && typeof group.length === "number") {
    for (var i = 0; i < group.length; i++) {
      if (group[i]) out.push(group[i]);
    }
    return;
  }
  out.push(group);
}

/**
 * Enumerate the fonts After Effects can actually use.
 * Returns [{family, regularPS, boldPS}] sorted by family, or null when the
 * font API is unavailable (older AE) so callers can fall back.
 * Result is cached for the life of the host session.
 */
function lcp_enumerateFonts() {
  if (_lcpFontFamilies) return _lcpFontFamilies;

  var families = [];
  var index = {};
  var fonts = [];
  var all = null;
  var i;

  try {
    if (!app.fonts || !app.fonts.allFonts) return null;
    all = app.fonts.allFonts;
  } catch (err) {
    return null;
  }

  try {
    for (i = 0; i < all.length; i++) {
      lcp_flattenFontGroup(all[i], fonts);
    }
  } catch (err2) {
    return null;
  }

  if (!fonts.length) return null;

  for (i = 0; i < fonts.length; i++) {
    var font = fonts[i];
    var family = "";
    var style = "";
    var ps = "";
    var substitute = false;

    try { family = String(font.familyName || font.nativeFamilyName || ""); } catch (e1) { family = ""; }
    try { style = String(font.styleName || font.nativeStyleName || ""); } catch (e2) { style = ""; }
    try { ps = String(font.postScriptName || ""); } catch (e3) { ps = ""; }
    try { substitute = (font.isSubstitute === true); } catch (e4) { substitute = false; }

    // A font that is only a substitute proxy for a missing font cannot be used.
    if (substitute) continue;
    if (!family || !ps) continue;

    var key = family.toLowerCase();
    var entry = index[key];
    if (!entry) {
      entry = { family: family, regularPS: "", boldPS: "", plainPS: "", firstPS: "" };
      index[key] = entry;
      families.push(entry);
    }

    if (!entry.firstPS) entry.firstPS = ps;
    if (!entry.plainPS && !lcp_isBoldStyle(style) && !lcp_isItalicStyle(style)) entry.plainPS = ps;
    if (!entry.regularPS && lcp_isRegularStyle(style)) entry.regularPS = ps;
    if (!entry.boldPS && lcp_isBoldStyle(style) && !lcp_isItalicStyle(style)) entry.boldPS = ps;
  }

  if (!families.length) return null;

  var usable = [];
  for (i = 0; i < families.length; i++) {
    var item = families[i];
    // A family whose styles are all unusual ("Light Italic" only, say) still
    // has to resolve to something, so fall back through plain then first.
    if (!item.regularPS) item.regularPS = item.plainPS || item.boldPS || item.firstPS;
    if (!item.boldPS) item.boldPS = item.regularPS || item.firstPS;
    if (item.regularPS || item.boldPS) usable.push(item);
  }

  if (!usable.length) return null;

  usable.sort(function (a, b) {
    var left = a.family.toLowerCase();
    var right = b.family.toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });

  _lcpFontFamilies = usable;
  return _lcpFontFamilies;
}

/**
 * A short description of what the font API actually looks like, reported to the
 * panel whenever enumeration fails so the cause is visible instead of guessed.
 */
function lcp_fontShape() {
  var parts = [];
  try {
    parts.push("app.fonts=" + (typeof app.fonts));
    if (!app.fonts) return parts.join("; ");

    var all = app.fonts.allFonts;
    parts.push("allFonts=" + (typeof all));
    if (!all) return parts.join("; ");

    parts.push("groups=" + all.length);
    var first = all[0];
    parts.push("group0=" + (typeof first));
    if (first && first.length !== undefined) parts.push("group0.len=" + first.length);

    var probe = (first && first.length !== undefined && first.length) ? first[0] : first;
    if (probe) {
      parts.push("sample.familyName=" + (probe.familyName || "?"));
      parts.push("sample.styleName=" + (probe.styleName || "?"));
      parts.push("sample.postScriptName=" + (probe.postScriptName || "?"));
    }
  } catch (err) {
    parts.push("err=" + err.toString());
  }
  return parts.join("; ");
}

/** Family + bold flag -> the PostScript name After Effects wants. */
function lcp_resolvePostScriptName(family, bold) {
  var list = lcp_enumerateFonts();
  var i;

  if (list) {
    var wanted = String(family || "").toLowerCase();
    for (i = 0; i < list.length; i++) {
      if (list[i].family.toLowerCase() === wanted) {
        var ps = bold ? list[i].boldPS : list[i].regularPS;
        if (!ps) ps = bold ? list[i].regularPS : list[i].boldPS;
        if (ps) return ps;
      }
    }
  }

  return lcp_fontPostScript(family, bold);
}

function lcp_builtinFontJson() {
  var parts = [];
  var i;
  for (i = 0; i < _lcpBuiltinFamilies.length; i++) {
    parts.push(
      '{"family":"' + lcp_esc(_lcpBuiltinFamilies[i]) + '"' +
      ',"regularPS":"' + lcp_esc(lcp_fontPostScript(_lcpBuiltinFamilies[i], false)) + '"' +
      ',"boldPS":"' + lcp_esc(lcp_fontPostScript(_lcpBuiltinFamilies[i], true)) + '"}'
    );
  }
  return "[" + parts.join(",") + "]";
}

function lcp_activeComp() {
  try {
    if (!app.project) return null;
    var item = app.project.activeItem;
    if (item && (item instanceof CompItem)) return item;
  } catch (err) {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* karaoke - the phrase stays on screen and the spoken word lights up   */
/* ------------------------------------------------------------------ */

/**
 * Lay the words of one phrase out as a single centred line and animate the
 * highlight word by word.
 *
 * One layer per word, all spanning the whole phrase. Word positions are
 * measured with sourceRectAtTime instead of guessed, and the gap between
 * words is derived by measuring the whole phrase, so the line reproduces the
 * spacing of a single text layer.
 *
 * This deliberately avoids text-animator range selectors: their match names
 * differ between AE versions and cannot be verified without a live host, while
 * addText / sourceRectAtTime / Source Text keyframes are long-standing API.
 */
function lcp_addKaraokePhrase(comp, caption, style) {
  var words = caption.words;
  var count = words.length;
  var i;

  var baseIn = Math.max(0, lcp_num(caption.startMs, 0) / 1000);
  var baseOut = lcp_num(caption.endMs, 1000) / 1000;
  if (baseOut > comp.duration) baseOut = comp.duration;
  if (baseOut <= baseIn) return 0;

  // The dim colour is the phrase's resting colour; the highlight is per word.
  var karaokeStyle = lcp_copyStyle(style);
  karaokeStyle.fill = style.karaokeDim || "#9a9a9a";

  // Each word is positioned from its measured width, so every word layer has to be
  // left-justified: with the anchor at the text's left edge, a position value is
  // the word's left edge. Align is applied to the phrase as a whole further down.
  // Inheriting the panel's Align here silently shifted every word by half its own
  // width whenever the style was not centred.
  karaokeStyle.align = "left";

  var layers = [];
  var widths = [];
  var total = 0;
  var backdrops = 0;

  for (i = 0; i < count; i++) {
    var wordText = lcp_applyCase(words[i].text, style);

    var layer = comp.layers.addText(wordText);
    try { layer.comment = LCP_TAG; } catch (e0) { /* tag is only for clear */ }
    layer.inPoint = baseIn;
    layer.outPoint = baseOut;
    layer.startTime = 0;
    lcp_buildTextDocument(layer, karaokeStyle);
    lcp_addShadow(layer, karaokeStyle);

    var width = 0;
    try { width = layer.sourceRectAtTime(baseIn, false).width; } catch (e1) { width = 0; }

    layers.push(layer);
    widths.push(width);
    total += width;
  }

  // Measure the same phrase as one line to recover the real space width.
  var spaceWidth = 0;
  if (count > 1) {
    var phraseText = lcp_applyCase(caption.text, style);

    var probe = comp.layers.addText(phraseText);
    try {
      lcp_buildTextDocument(probe, karaokeStyle);
      var phraseWidth = probe.sourceRectAtTime(baseIn, false).width;
      var gap = (phraseWidth - total) / (count - 1);
      if (gap > 0 && gap < comp.width * 0.5) spaceWidth = gap;
    } catch (e2) { spaceWidth = 0; }
    try { probe.remove(); } catch (e3) { /* leave it if it cannot be removed */ }
  }

  var anchorX = lcp_num(style.posX, 50) / 100 * comp.width;
  var baseY = lcp_num(style.posY, 78) / 100 * comp.height;
  var lineWidth = total + spaceWidth * (count - 1);

  // Where the phrase starts, measured from the same anchor the preview uses:
  // left starts on it, centre straddles it, right ends on it.
  var align = String(style.align || "center");
  var cursor = anchorX;
  if (align === "center") cursor = anchorX - lineWidth / 2;
  else if (align === "right") cursor = anchorX - lineWidth;

  for (i = 0; i < count; i++) {
    var x = cursor;
    lcp_animateKaraokeWord(layers[i], karaokeStyle, style, baseIn, baseOut, words[i], x, baseY);

    // The backdrop is taken after the colour keys are set, so its glow follows
    // the highlight, and it inherits the word's own position and timing keys.
    if (style.applyGlow && lcp_addGlowBackdrop(comp, layers[i], karaokeStyle)) backdrops++;

    cursor += widths[i] + spaceWidth;
  }

  return { text: count, backdrops: backdrops };
}

/** Colour highlight, optional pop, and the phrase's own fade for one word. */
function lcp_animateKaraokeWord(layer, karaokeStyle, style, baseIn, baseOut, word, x, y) {
  var wordStart = Math.max(baseIn, lcp_num(word.startMs, baseIn * 1000) / 1000);
  var wordEnd = Math.min(baseOut, lcp_num(word.endMs, baseOut * 1000) / 1000);
  if (wordEnd <= wordStart) wordEnd = Math.min(baseOut, wordStart + 0.05);

  var offset = lcp_textOffset(layer, baseIn);
  try { layer.property("Position").setValue([x, y - offset.y]); } catch (e0) { /* ignore */ }

  // Phrase fade in and out.
  var inDuration = Math.max(0, lcp_num(style.inDurMs, 200)) / 1000;
  var outDuration = Math.max(0, lcp_num(style.outDurMs, 200)) / 1000;
  var inEnd = Math.min(baseIn + inDuration, baseOut);
  var outStart = Math.max(inEnd, baseOut - outDuration);
  var opacity = layer.property("Opacity");
  try {
    opacity.setValueAtTime(baseIn, 0);
    opacity.setValueAtTime(inEnd, 100);
    if (outStart < baseOut) {
      opacity.setValueAtTime(outStart, 100);
      opacity.setValueAtTime(baseOut, 0);
    }
  } catch (e1) { /* ignore */ }

  // Colour: dim for the whole phrase, highlight across this word's window.
  var sourceText = layer.property("Source Text");
  var dim = lcp_hexToRgb(karaokeStyle.fill);
  var highlight = lcp_hexToRgb(style.karaokeHighlight || "#ffd400");

  try {
    var docDim = sourceText.value;
    docDim.fillColor = dim;
    sourceText.setValueAtTime(baseIn, docDim);

    var docOn = sourceText.value;
    docOn.fillColor = highlight;
    sourceText.setValueAtTime(wordStart, docOn);

    if (wordEnd < baseOut) {
      var docOff = sourceText.value;
      docOff.fillColor = dim;
      sourceText.setValueAtTime(wordEnd, docOff);
    }

    // Snap between colours instead of blending them.
    var key;
    for (key = 1; key <= sourceText.numKeys; key++) {
      sourceText.setInterpolationTypeAtKey(
        key, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD
      );
    }
  } catch (e2) { /* the highlight is cosmetic; keep the layer */ }

  // A small scale pop on the spoken word.
  if (style.karaokePop) {
    var scale = layer.property("Scale");
    var span = wordEnd - wordStart;
    try {
      scale.setValueAtTime(wordStart, [100, 100]);
      scale.setValueAtTime(wordStart + span * 0.4, [108, 108]);
      scale.setValueAtTime(wordEnd, [100, 100]);
      for (key = 1; key <= scale.numKeys; key++) {
        scale.setInterpolationTypeAtKey(
          key, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER
        );
      }
    } catch (e3) { /* ignore */ }
  }
}

/** Shallow copy of a style object, so karaoke can override the fill only. */
function lcp_copyStyle(style) {
  var out = {};
  var key;
  for (key in style) {
    if (style.hasOwnProperty(key)) out[key] = style[key];
  }
  return out;
}

/** A style with the power-word colour and size applied. */
function lcp_emphasisStyle(style) {
  var out = lcp_copyStyle(style);
  out.fill = style.emphasisColor || "#ffd400";
  out.fontSize = lcp_num(style.fontSize, 72) * (lcp_num(style.emphasisScale, 110) / 100);
  return out;
}

/** Text case, driven by the style's `transform` setting. */
function lcp_applyCase(text, style) {
  var value = String(text === null || text === undefined ? "" : text);
  var mode = String(style.transform || "none");
  if (mode === "uppercase") return value.toUpperCase();
  if (mode === "lowercase") return value.toLowerCase();
  return value;
}

/**
 * Break one caption across 1-3 lines using hard returns (\r), which is what an
 * After Effects text document uses for a line break.
 */
function lcp_splitLines(text, lineCount, maxWords) {
  var target = parseInt(lineCount, 10);
  var value = String(text === null || text === undefined ? "" : text);
  if (isNaN(target) || target < 2) return value;

  var raw = value.split(/\s+/);
  var words = [];
  var i;
  for (i = 0; i < raw.length; i++) {
    if (raw[i].length) words.push(raw[i]);
  }
  if (words.length < 2) return value;

  // "Lines per caption" is a maximum and Max words decides how much a caption
  // holds, so together they set the words per line. Without this a three-word
  // caption asked for three lines became one word per line.
  var limit = parseInt(maxWords, 10);
  if (!isNaN(limit) && limit > 0) {
    var perLine = Math.max(1, Math.ceil(limit / target));
    var needed = Math.ceil(words.length / perLine);
    if (needed < target) target = needed;
  }

  if (target > words.length) target = words.length;
  if (target < 2) return value;

  // Spread the words as evenly as possible, earlier lines taking the remainder,
  // so 4 words over 3 lines becomes 2/1/1 rather than 2/2.
  var base = Math.floor(words.length / target);
  var extra = words.length % target;

  var result = "";
  var index = 0;
  var line;

  for (line = 0; line < target; line++) {
    var count = base + (line < extra ? 1 : 0);
    if (line > 0) result += "\r";
    for (var part = 0; part < count; part++) {
      if (part > 0) result += " ";
      result += words[index];
      index++;
    }
  }
  return result;
}

/**
 * Comp-to-reference scale. Sizes are authored against a 1920px-wide comp, so a
 * 1080-wide vertical comp gets 0.5625x. Effects use the same scale as the text.
 */
function lcp_compScale(layer) {
  var compWidth = 1920;
  try { compWidth = lcp_num(layer.containingComp.width, 1920); } catch (e) { compWidth = 1920; }
  return (compWidth > 0) ? (compWidth / 1920) : 1;
}

function lcp_logEffect(name, result) {
  if (!_lcpEffectLog) return;
  if (!_lcpEffectLog[name]) _lcpEffectLog[name] = { ok: 0, failed: 0, skipped: 0 };
  if (result === "ok") _lcpEffectLog[name].ok++;
  else if (result === "skipped") _lcpEffectLog[name].skipped++;
  else _lcpEffectLog[name].failed++;
}

/**
 * Drop shadow as a layer effect. The effect is added by match name; the
 * individual properties are set by display name and skipped silently when the
 * host is not running an English UI, in which case the effect defaults apply.
 */
function lcp_addShadow(layer, style) {
  if (!style.applyShadow) return;
  try {
    var shadow = layer.property("Effects").addProperty("ADBE Drop Shadow");
    if (!shadow) { lcp_logEffect("shadow", "failed"); return; }
    lcp_logEffect("shadow", "ok");

    // Distance and softness are derived from the rendered font size using the
    // same ratios as the panel preview, so what the preview shows is what lands
    // in the comp.
    var fontPx = lcp_num(style.fontSize, 72) * lcp_compScale(layer);
    var amount = lcp_num(style.shadowAmount, 55);
    // AE's Drop Shadow opacity runs 0-255, not 0-100 like the slider.
    var opacity = Math.max(0, Math.min(255, Math.round(amount * 2.55)));
    var distance = Math.max(2, Math.round(fontPx * 0.10));
    var softness = Math.max(4, Math.round(fontPx * 0.25));

    try { shadow.property("Shadow Color").setValue(lcp_hexToRgb(style.shadowColor || "#000000")); } catch (e1) { /* defaults */ }
    try { shadow.property("Opacity").setValue(opacity); } catch (e2) { /* defaults */ }
    try { shadow.property("Direction").setValue(135); } catch (e3) { /* defaults */ }
    try { shadow.property("Distance").setValue(distance); } catch (e4) { /* defaults */ }
    try { shadow.property("Softness").setValue(softness); } catch (e5) { /* defaults */ }
  } catch (err) { /* a missing shadow is cosmetic, never fatal */ lcp_logEffect("shadow", "failed"); }
}

/**
 * Blur a layer over its life, the way the preview's Blur Fade does.
 *
 * After Effects has no per-layer blur property, so this is a blur effect with its
 * radius keyframed: soft on the way in, sharp while the caption is held, soft
 * again on the way out. The radius follows the text size, matching the preview,
 * which blurs 6px against a 13px caption - about 0.45 of the text.
 */
function lcp_blurLayer(layer, fontPx, sharpAt, softAgainAt) {
  var softIn = Math.max(1, Math.round(fontPx * 0.45));
  var softOut = Math.max(1, Math.round(fontPx * 0.38));

  try {
    var effects = layer.property("Effects");
    var blur = null;
    try { blur = effects.addProperty("ADBE Gaussian Blur 2"); } catch (e1) { blur = null; }
    if (!blur) { try { blur = effects.addProperty("ADBE Box Blur2"); } catch (e2) { blur = null; } }
    if (!blur) { lcp_logEffect("blur", "failed"); return; }
    lcp_logEffect("blur", "ok");

    var radius = null;
    try { radius = blur.property("Blurriness"); } catch (e3) { radius = null; }
    if (!radius) { try { radius = blur.property(1); } catch (e4) { radius = null; } }
    if (!radius) return;

    radius.setValueAtTime(layer.inPoint, softIn);
    radius.setValueAtTime(sharpAt, 0);
    radius.setValueAtTime(softAgainAt, 0);
    radius.setValueAtTime(layer.outPoint, softOut);
  } catch (err) { lcp_logEffect("blur", "failed"); }
}

/**
 * Flash a layer bright as it lands, for the neon motion.
 *
 * The preview raises the text's brightness as the caption appears; a scale-in on
 * its own is a different look. Brightness & Contrast takes a percentage, so the
 * preview's 2.2x multiplier becomes +120 and its 1.6x exit becomes +60.
 */
function lcp_flashLayer(layer, settleAt, fadeAt) {
  try {
    var flash = layer.property("Effects").addProperty("ADBE Brightness & Contrast 2");
    if (!flash) { lcp_logEffect("brightness", "failed"); return; }
    lcp_logEffect("brightness", "ok");

    var brightness = null;
    try { brightness = flash.property("Brightness"); } catch (e1) { brightness = null; }
    if (!brightness) { try { brightness = flash.property(1); } catch (e2) { brightness = null; } }
    if (!brightness) return;

    brightness.setValueAtTime(layer.inPoint, 120);
    brightness.setValueAtTime(settleAt, 0);
    brightness.setValueAtTime(fadeAt, 0);
    brightness.setValueAtTime(layer.outPoint, 60);
  } catch (err) { lcp_logEffect("brightness", "failed"); }
}

/**
 * The Glow effect itself ("ADBE Glo2").
 *
 * The numbers here deliberately mirror the panel preview, which draws the halo as
 * two blurred shadows at radii of 0.08 + 0.30x and 0.20 + 0.80x the rendered text
 * size. An earlier set of values - threshold 70, a quarter of the text size, and
 * intensity 0.6 - produced a halo so small and faint next to a 12px outline that
 * the effect was invisible, while the preview showed a generous one. Threshold 60
 * is After Effects' own default, and the intensity is built around its default of
 * 1, so the effect behaves like a glow at its middle settings.
 */
function lcp_applyGlowEffect(layer, style) {
  try {
    var amount = lcp_num(style.glowAmount, 40);

    // At zero the effect would be a no-op; skip it and say so, rather than
    // leaving the panel to warn about an effect that was never wanted.
    if (amount <= 0) {
      lcp_logEffect("glow", "skipped");
      return;
    }

    var glow = layer.property("Effects").addProperty("ADBE Glo2");
    if (!glow) { lcp_logEffect("glow", "failed"); return; }
    lcp_logEffect("glow", "ok");

    var fontPx = lcp_num(style.fontSize, 72) * lcp_compScale(layer);
    var strength = amount / 100;

    // Radius follows the same curve as the preview's outer halo, so the comp and
    // the panel agree on how far the light reaches.
    var radius = Math.max(4, Math.round(fontPx * (0.20 + 0.80 * strength)));
    var intensity = 0.8 + 1.2 * strength;

    try { glow.property("Glow Threshold").setValue(60); } catch (e1) { /* defaults */ }
    try { glow.property("Glow Radius").setValue(radius); } catch (e2) { /* defaults */ }
    try { glow.property("Glow Intensity").setValue(intensity); } catch (e3) { /* defaults */ }

    // Tint the glow with an explicit colour, so it reads as a halo in the style's
    // own colour rather than a white bloom. Best effort: on a localised UI these
    // lookups fail and the effect keeps its own defaults.
    var tint = String(style.glowColor || "");
    if (tint) {
      try { glow.property("Glow Colors").setValue(1); } catch (e4) { /* A & B Colors unsupported */ }
      try { glow.property("Color A").setValue(lcp_hexToRgb(tint)); } catch (e5) { /* ignore */ }
      try { glow.property("Color B").setValue(lcp_hexToRgb(tint)); } catch (e6) { /* ignore */ }
    }
  } catch (err) { /* a missing glow is cosmetic, never fatal */ lcp_logEffect("glow", "failed"); }
}

/**
 * Glow, drawn on a duplicate of the layer placed BEHIND it.
 *
 * AE's Glow effect composites its bloom over the layer's own pixels, so at high
 * intensities it brightens the glyphs themselves - which is what made the
 * karaoke highlight vanish at 100%. Putting the glow on a duplicate underneath
 * means the halo can never wash out the text, and it is how the panel preview
 * draws it too.
 *
 * Returns the backdrop layer, or null.
 */
function lcp_addGlowBackdrop(comp, textLayer, style) {
  if (!style.applyGlow) return null;

  var backdrop = null;
  try { backdrop = textLayer.duplicate(); } catch (e1) { return null; }
  if (!backdrop) return null;

  try { backdrop.name = "glow - " + String(textLayer.name || "caption"); } catch (e2) { /* cosmetic */ }
  try { backdrop.comment = LCP_TAG; } catch (e3) { /* tag is only needed for clear */ }
  try { backdrop.moveAfter(textLayer); } catch (e4) { /* stay where duplicate put it */ }

  // The duplicate inherits whatever effects the original already carries; keep
  // only the glow so nothing is applied twice.
  try {
    var effects = backdrop.property("Effects");
    for (var i = effects.numProperties; i >= 1; i--) {
      var effect = effects.property(i);
      var match = "";
      try { match = String(effect.matchName || ""); } catch (e5) { match = ""; }
      if (match !== "ADBE Glo2") effect.remove();
    }
  } catch (e6) { /* nothing to clean */ }

  lcp_applyGlowEffect(backdrop, style);
  return backdrop;
}

/**
 * A solid bar behind the caption, sized from the text block itself.
 * Returns the bar layer, or null when it could not be built.
 */
function lcp_addBox(comp, textLayer, style) {
  var rect = null;
  try { rect = textLayer.sourceRectAtTime(textLayer.inPoint, false); } catch (e1) { return null; }
  if (!rect || !rect.width || !rect.height) return null;

  var padding = lcp_num(style.boxPadding, 18);
  var width = Math.max(4, rect.width + padding * 2);
  var height = Math.max(4, rect.height + padding * 2);

  var textX = lcp_num(style.posX, 50) / 100 * comp.width;
  var textY = lcp_num(style.posY, 78) / 100 * comp.height;

  var bar = null;
  try {
    bar = comp.layers.addSolid(lcp_hexToRgb(style.boxColor || "#000000"), "bar", width, height, 1, comp.duration);
  } catch (e2) { return null; }

  try { bar.comment = LCP_TAG; } catch (e3) { /* tag is only needed for clear */ }
  bar.inPoint = textLayer.inPoint;
  bar.outPoint = textLayer.outPoint;
  bar.startTime = 0;

  try { bar.property("Opacity").setValue(lcp_num(style.boxOpacity, 70)); } catch (e4) { /* ignore */ }

  // sourceRectAtTime is relative to the text layer's anchor point, and the text
  // layer is itself positioned so its box is centred on the vertical position -
  // so the bar's centre is that position exactly.
  var centreX = textX + rect.left + rect.width / 2;
  var centreY = textY;
  try { bar.property("Position").setValue([centreX, centreY]); } catch (e5) { /* ignore */ }
  try { bar.moveAfter(textLayer); } catch (e6) { /* ignore */ }

  lcp_applyMotion(bar, style, comp, bar.inPoint, bar.outPoint, [centreX, centreY]);
  return bar;
}

/* ------------------------------------------------------------------ */
/* entry points                                                       */
/* ------------------------------------------------------------------ */

function lcp_ping() {
  return lcp_ok('"version":"' + LCP_VERSION + '"');
}

/**
 * The font picker's data source.
 * source is "app.fonts" when the real font list was read, otherwise
 * "builtin" so the panel can say so instead of showing a short list silently.
 */
function lcp_listFonts() {
  var list = lcp_enumerateFonts();

  if (!list) {
    return '{"ok":true,"source":"builtin","shape":"' + lcp_esc(lcp_fontShape()) +
           '","fonts":' + lcp_builtinFontJson() + "}";
  }

  var parts = [];
  var i;
  for (i = 0; i < list.length; i++) {
    parts.push(
      '{"family":"' + lcp_esc(list[i].family) + '"' +
      ',"regularPS":"' + lcp_esc(list[i].regularPS) + '"' +
      ',"boldPS":"' + lcp_esc(list[i].boldPS) + '"}'
    );
  }

  return '{"ok":true,"source":"app.fonts","fonts":[' + parts.join(",") + "]}";
}

/*
 * ------------------------------------------------------------------ *
 * Media discovery: which file should Auto Caption transcribe?
 * ------------------------------------------------------------------ *
 */

/** Is this a layer with a real file behind it? */
function lcp_layerHasFile(layer) {
  try {
    if (!(layer instanceof AVLayer)) return false;
    if (!layer.source) return false;
    if (!layer.source.file) return false;
    return true;
  } catch (err) {
    return false;
  }
}

function lcp_layerHasAudio(layer) {
  try { return layer.hasAudio === true; } catch (err) { return false; }
}

/**
 * Pick the layer to transcribe: the selected layer when it carries audio,
 * otherwise the first layer with an audio-bearing file source, otherwise the
 * first layer with any file source.
 *
 * Kept separate from lcp_mediaInfo so it can be exercised without After Effects.
 */
function lcp_pickMediaLayer(comp) {
  if (!comp || !comp.numLayers) return null;

  var selected = null;
  try { selected = comp.selectedLayers; } catch (e0) { selected = null; }

  var i;
  if (selected && selected.length) {
    for (i = 0; i < selected.length; i++) {
      if (lcp_layerHasFile(selected[i]) && lcp_layerHasAudio(selected[i])) return selected[i];
    }
  }

  var firstWithAudio = null;
  var firstAny = null;

  for (i = 1; i <= comp.numLayers; i++) {
    var layer = null;
    try { layer = comp.layer(i); } catch (e1) { layer = null; }
    if (!lcp_layerHasFile(layer)) continue;
    if (!firstAny) firstAny = layer;
    if (lcp_layerHasAudio(layer)) { firstWithAudio = layer; break; }
  }

  return firstWithAudio || firstAny;
}

/**
 * Describe the media Auto Caption should use from the active composition, so the
 * panel can transcribe the video that is already open instead of asking for a
 * file. Reports the layer's start time too: media time t sits at comp time
 * t + startTime, which is what keeps captions aligned when a clip does not begin
 * at zero.
 */
function lcp_mediaInfo() {
  var comp = lcp_activeComp();
  if (!comp) {
    return lcp_error("No active composition. Open a composition first.");
  }

  var layer = lcp_pickMediaLayer(comp);
  if (!layer) {
    return lcp_error("No layer in this composition has a media file to transcribe.");
  }

  var path = "";
  var name = "";
  var start = 0;
  var inPoint = 0;
  var outPoint = 0;
  var index = 0;

  try { path = String(layer.source.file.fsName || layer.source.file.toString()); } catch (e1) { path = ""; }
  try { name = String(layer.name || ""); } catch (e2) { name = ""; }
  try { start = lcp_num(layer.startTime, 0); } catch (e3) { start = 0; }
  try { inPoint = lcp_num(layer.inPoint, 0); } catch (e4) { inPoint = 0; }
  try { outPoint = lcp_num(layer.outPoint, 0); } catch (e5) { outPoint = 0; }
  try { index = lcp_num(layer.index, 0); } catch (e6) { index = 0; }

  if (!path) {
    return lcp_error("The media layer has no file path on disk. Import the video, then try again.");
  }

  return lcp_ok(
    '"comp":"' + lcp_esc(comp.name) + '"' +
    ',"layer":"' + lcp_esc(name) + '"' +
    ',"layerIndex":' + index +
    ',"path":"' + lcp_esc(path) + '"' +
    ',"hasAudio":' + (lcp_layerHasAudio(layer) ? "true" : "false") +
    ',"startTime":' + start +
    ',"inPoint":' + inPoint +
    ',"outPoint":' + outPoint
  );
}

function lcp_compInfo() {
  var comp = lcp_activeComp();
  if (!comp) {
    return lcp_error("No active composition. Open a composition in After Effects first.");
  }

  var frameRate = 0;
  try { frameRate = comp.frameRate; } catch (err) { frameRate = 0; }

  return lcp_ok(
    '"name":"' + lcp_esc(comp.name) + '"' +
    ',"width":' + comp.width +
    ',"height":' + comp.height +
    ',"duration":' + lcp_num(comp.duration, 0) +
    ',"frameRate":' + lcp_num(frameRate, 0) +
    ',"layers":' + comp.numLayers +
    ',"generated":' + lcp_countTagged(comp)
  );
}

/** How many layers in this comp were made by this panel. */
function lcp_countTagged(comp) {
  var count = 0;
  if (!comp) return count;
  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = null;
    try { layer = comp.layer(i); } catch (err) { layer = null; }
    if (!layer) continue;
    var comment = "";
    try { comment = layer.comment ? String(layer.comment) : ""; } catch (err2) { comment = ""; }
    if (comment.indexOf(LCP_TAG) === 0) count++;
  }
  return count;
}

/**
 * Resolve one text layer's look from the style object.
 * Returns the configured TextDocument, ready to setValue().
 */
function lcp_buildTextDocument(textLayer, style) {
  var sourceText = textLayer.property("Source Text");
  var doc = sourceText.value;

  try { doc.resetCharStyle(); } catch (err) { /* not fatal */ }

  doc.font = lcp_resolvePostScriptName(style.fontFamily, style.bold);

  var compWidth = 1920;
  try { compWidth = lcp_num(textLayer.containingComp.width, 1920); } catch (errWidth) { compWidth = 1920; }
  var sizeScale = (compWidth > 0) ? (compWidth / 1920) : 1;

  doc.fontSize = lcp_num(style.fontSize, 72) * sizeScale;

  try { doc.tracking = lcp_num(style.tracking, 0); } catch (errTrack) { /* older AE */ }

  // "Outline Only" presets switch the fill off, which also forces the stroke on.
  var wantStroke = !!style.applyStroke || style.filled === false;

  doc.applyFill = (style.filled === false) ? false : true;
  doc.fillColor = lcp_hexToRgb(style.fill);

  if (wantStroke) {
    doc.applyStroke = true;
    doc.strokeColor = lcp_hexToRgb(style.strokeColor);
    doc.strokeWidth = lcp_num(style.strokeWidth, 6) * sizeScale;
    doc.strokeOverFill = false;
  } else {
    doc.applyStroke = false;
  }

  try {
    if (style.align === "left") {
      doc.justification = ParagraphJustification.LEFT_JUSTIFY;
    } else if (style.align === "right") {
      doc.justification = ParagraphJustification.RIGHT_JUSTIFY;
    } else {
      doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    }
  } catch (err) { /* justification is cosmetic; keep going */ }

  sourceText.setValue(doc);
  return doc;
}

/** Add the in/out animation for a motion profile to one layer. */
function lcp_applyMotion(layer, style, comp, secondsIn, secondsOut, basePosition) {
  var motion = String(style.motion || "none");
  var posX = lcp_num(style.posX, 50) / 100 * comp.width;
  var posY = lcp_num(style.posY, 78) / 100 * comp.height;

  // A background bar animates around its own centre, not the caption's.
  if (basePosition && basePosition.length === 2) {
    posX = basePosition[0];
    posY = basePosition[1];
  }

  var inDuration = Math.max(0, lcp_num(style.inDurMs, 200)) / 1000;
  var outDuration = Math.max(0, lcp_num(style.outDurMs, 150)) / 1000;
  var inEnd = layer.inPoint + inDuration;
  if (inEnd > layer.outPoint) inEnd = Math.max(layer.inPoint, layer.outPoint - 0.01);
  var outStart = layer.outPoint - outDuration;
  if (outStart < inEnd) outStart = Math.min(inEnd, layer.outPoint);

  var position = layer.property("Position");
  var scale = layer.property("Scale");
  var opacity = layer.property("Opacity");

  function keyPosition(time, x, y) {
    try { position.setValueAtTime(time, [x, y]); } catch (err) { /* ignore */ }
  }
  function keyScale(time, value) {
    try { scale.setValueAtTime(time, [value, value]); } catch (err) { /* ignore */ }
  }
  function keyOpacity(time, value) {
    try { opacity.setValueAtTime(time, value); } catch (err) { /* ignore */ }
  }

  var dx = comp.width * 0.06;
  var dy = comp.height * 0.06;

  // Every style has to be positioned. The branches below only add animation, and a
  // motion that animates scale or opacity alone never set a position at all - so
  // the layer kept After Effects' default, which is the middle of the comp. That
  // is why a neon, pulse or zoom caption ignored Horizontal and Vertical entirely
  // while a slide caption obeyed them.
  keyPosition(layer.inPoint, posX, posY);
  keyPosition(inEnd, posX, posY);

  if (motion === "slideUp") {
    keyPosition(layer.inPoint, posX, posY + dy);
    keyPosition(inEnd, posX, posY);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "slideDown") {
    keyPosition(layer.inPoint, posX, posY - dy);
    keyPosition(inEnd, posX, posY);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "slideLeft") {
    keyPosition(layer.inPoint, posX + dx, posY);
    keyPosition(inEnd, posX, posY);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "popIn") {
    keyScale(layer.inPoint, 60);
    keyScale(layer.inPoint + (inEnd - layer.inPoint) * 0.7, 110);
    keyScale(inEnd, 100);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(layer.inPoint + (inEnd - layer.inPoint) * 0.5, 100);
  } else if (motion === "blurFade") {
    keyScale(layer.inPoint, 106);
    keyScale(inEnd, 100);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
    // Without this the style is only a scale fade: the blur is what makes it
    // Blur Fade, and the preview has always animated it.
    lcp_blurLayer(layer, lcp_num(style.fontSize, 72) * lcp_compScale(layer), inEnd, outStart);
  } else if (motion === "wordPunch") {
    keyScale(layer.inPoint, 92);
    keyScale(inEnd, 100);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "neon") {
    keyScale(layer.inPoint, 90);
    keyScale(inEnd, 100);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
    // The preview flashes the text bright as it lands; without this the comp is
    // just a scale-in.
    lcp_flashLayer(layer, inEnd, outStart);
  } else if (motion === "slideRight") {
    keyPosition(layer.inPoint, posX - dx, posY);
    keyPosition(inEnd, posX, posY);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "zoomPunch") {
    keyScale(layer.inPoint, 145);
    keyScale(inEnd, 100);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "cinematic") {
    // A slow drift across the whole life of the layer, with a long soft fade.
    keyScale(layer.inPoint, 100);
    keyScale(layer.outPoint, 104);
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
  } else if (motion === "flickerOut") {
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
    var flickerStart = Math.max(inEnd, layer.outPoint - 0.35);
    var flickerSpan = (layer.outPoint - flickerStart) / 4;
    if (flickerSpan > 0) {
      keyOpacity(flickerStart, 100);
      keyOpacity(flickerStart + flickerSpan, 18);
      keyOpacity(flickerStart + flickerSpan * 2, 100);
      keyOpacity(flickerStart + flickerSpan * 3, 12);
    }
    keyOpacity(layer.outPoint, 0);
  } else if (motion === "pulse") {
    keyOpacity(layer.inPoint, 0);
    keyOpacity(inEnd, 100);
    keyScale(layer.inPoint, 100);
    keyScale(inEnd, 100);
    var pulseSteps = 6;
    var pulseSpan = Math.max(0.2, layer.outPoint - inEnd);
    var pulseStep = pulseSpan / pulseSteps;
    var pulseIndex;
    for (pulseIndex = 1; pulseIndex <= pulseSteps; pulseIndex++) {
      var pulseTime = inEnd + pulseStep * pulseIndex;
      if (pulseTime >= layer.outPoint) break;
      keyScale(pulseTime, (pulseIndex % 2 === 1) ? 107 : 100);
    }
    keyScale(layer.outPoint, 100);
  } else {
    keyPosition(layer.inPoint, posX, posY);
  }

  // Out animation: fade unless the style asked for a hard cut.
  if (outDuration > 0 && outStart < layer.outPoint) {
    keyOpacity(outStart, 100);
    keyOpacity(layer.outPoint, 0);
  }

  if (motion === "none") {
    keyOpacity(layer.inPoint, 100);
  }
}

/**
 * How far a text layer's own box sits from its anchor point.
 *
 * After Effects anchors a text layer at the text's origin - the first baseline -
 * so using the requested position directly leaves the caption sitting above it.
 * The panel preview centres the caption on the position, so the host has to
 * offset by the measured box centre for the two to agree.
 */
function lcp_textOffset(layer, atTime) {
  try {
    var box = layer.sourceRectAtTime(atTime, false);
    return {
      x: lcp_num(box.left, 0),
      y: lcp_num(box.top, 0) + lcp_num(box.height, 0) / 2
    };
  } catch (err) {
    return { x: 0, y: 0 };
  }
}

/** Create a single text layer for one block of caption text.
 *
 * Returns the layer count it took - the text layer, plus a glow backdrop when
 * the style asks for one - so callers can report what the comp really gained.
 */
function lcp_addLayer(comp, text, startSeconds, endSeconds, style, allowBox) {
  var layer = comp.layers.addText(String(text));

  try { layer.comment = LCP_TAG; } catch (err) { /* comment is only needed for clear */ }

  var inPoint = Math.max(0, startSeconds);
  var outPoint = Math.max(inPoint + 0.05, endSeconds);
  if (outPoint > comp.duration) outPoint = comp.duration;
  if (outPoint <= inPoint) outPoint = Math.min(comp.duration, inPoint + 0.05);

  layer.inPoint = inPoint;
  layer.outPoint = outPoint;
  layer.startTime = 0;

  lcp_buildTextDocument(layer, style);

  var baseX = lcp_num(style.posX, 50) / 100 * comp.width;
  var baseY = lcp_num(style.posY, 78) / 100 * comp.height;

  // The caption's own box is centred on the vertical position, which is where the
  // preview draws it - not the baseline.
  var offset = lcp_textOffset(layer, inPoint);
  var textY = baseY - offset.y;

  if (!_lcpLastPlacement) {
    var fontSetting = lcp_num(style.fontSize, 72);
    _lcpLastPlacement = {
      posY: lcp_num(style.posY, 78),
      compHeight: comp.height,
      anchorY: baseY,
      textOffsetY: offset.y,
      layerY: textY,
      fontSetting: fontSetting,
      fontDrawnPx: fontSetting * (comp.width > 0 ? (comp.width / 1920) : 1),
      compWidth: comp.width,
      fontFace: lcp_resolvePostScriptName(style.fontFamily, style.bold)
    };
  }

  // Glow first: the backdrop is duplicated before the shadow is added, so it
  // cannot inherit a second copy of it.
  var glowBackdrop = lcp_addGlowBackdrop(comp, layer, style);

  lcp_addShadow(layer, style);

  // The bar measures the text, so it has to be built while the layer already
  // holds its final text.
  if (allowBox && style.applyBox) lcp_addBox(comp, layer, style);

  lcp_applyMotion(layer, style, comp, inPoint, outPoint, [baseX, textY]);
  if (glowBackdrop) {
    lcp_applyMotion(glowBackdrop, style, comp, glowBackdrop.inPoint, glowBackdrop.outPoint, [baseX, textY]);
  }

  return { text: 1, backdrops: glowBackdrop ? 1 : 0 };
}

/**
 * Create every caption in the payload.
 * Payload shape:
 *   { captions: [ { text, startMs, endMs, words: [ {text,startMs,endMs} ] } ],
 *     style: { motion, fontFamily, ... } }
 */
function lcp_create(payloadJson) {
  var payload = null;
  try {
    payload = eval("(" + payloadJson + ")");
  } catch (err) {
    return lcp_error("Could not read the caption payload: " + err.toString());
  }

  if (!payload || !payload.captions || !payload.captions.length) {
    return lcp_error("The transcript is empty - nothing to generate.");
  }

  var comp = lcp_activeComp();
  if (!comp) {
    return lcp_error("No active composition. Open a composition in After Effects first.");
  }

  var style = payload.style || {};
  var wordByWord = !!style.wordByWord;

  // The panel asks for this by default: generating a second time should rebuild
  // the captions rather than stack another copy on top of the first.
  var replacePrevious = !!payload.replacePrevious;

  var created = 0;
  var backdrops = 0;
  var removed = 0;
  var errors = [];
  var warnings = [];
  var i;
  var j;

  _lcpEffectLog = {};
  _lcpLastPlacement = null;

  app.beginUndoGroup("Caption Wizard: Generate Captions");
  try {
    // Clearing inside this undo group keeps replacing a single undo step: one
    // Ctrl+Z brings the previous captions back, not just the last layer.
    if (replacePrevious) removed = lcp_removeTagged(comp);

    for (i = 0; i < payload.captions.length; i++) {
      var caption = payload.captions[i];
      try {
        if (style.karaoke && caption.words && caption.words.length > 1) {
          // Karaoke keeps the whole phrase and highlights the spoken word.
          var karaokeAdded = lcp_addKaraokePhrase(comp, caption, style);
          created += karaokeAdded.text;
          backdrops += karaokeAdded.backdrops;
        } else if (wordByWord && caption.words && caption.words.length) {
          for (j = 0; j < caption.words.length; j++) {
            var word = caption.words[j];
            // The panel marks power words, so emphasis is one decision made in
            // one place rather than two rules that can drift apart.
            var wordStyle = word.emphasis ? lcp_emphasisStyle(style) : style;
            var wordAdded = lcp_addLayer(
              comp,
              lcp_applyCase(word.text, style),
              lcp_num(word.startMs, caption.startMs) / 1000,
              lcp_num(word.endMs, caption.endMs) / 1000,
              wordStyle,
              false
            );
            created += wordAdded.text;
            backdrops += wordAdded.backdrops;
          }
        } else {
          var blockAdded = lcp_addLayer(
            comp,
            lcp_splitLines(lcp_applyCase(caption.text, style), style.lines, style.maxWords),
            lcp_num(caption.startMs, 0) / 1000,
            lcp_num(caption.endMs, 1000) / 1000,
            style,
            !wordByWord
          );
          created += blockAdded.text;
          backdrops += blockAdded.backdrops;
        }
      } catch (captionError) {
        errors.push("Caption " + (i + 1) + ": " + captionError.toString());
      }
    }
  } finally {
    app.endUndoGroup();
  }

  // Report effects that never made it onto a single layer, rather than letting
  // the panel claim success while the shadow or glow is silently absent.
  if (_lcpEffectLog) {
    if (style.applyShadow && !_lcpEffectLog.shadow) {
      warnings.push("Drop shadow: the effect was not added to any layer.");
    } else if (_lcpEffectLog.shadow && _lcpEffectLog.shadow.ok === 0 && _lcpEffectLog.shadow.failed > 0) {
      warnings.push("Drop shadow: the effect could not be added (" + _lcpEffectLog.shadow.failed + " layer(s)).");
    }
    if (style.applyGlow && !_lcpEffectLog.glow) {
      warnings.push("Glow: the effect was not added to any layer.");
    } else if (_lcpEffectLog.glow && _lcpEffectLog.glow.ok === 0 && _lcpEffectLog.glow.failed > 0) {
      warnings.push("Glow: the effect could not be added (" + _lcpEffectLog.glow.failed + " layer(s)).");
    }
  }
  _lcpEffectLog = null;

  var placement = "";
  if (_lcpLastPlacement) {
    var p = _lcpLastPlacement;
    placement = ',"placement":{"posY":' + p.posY +
      ',"compHeight":' + p.compHeight +
      ',"anchorY":' + p.anchorY +
      ',"textOffsetY":' + p.textOffsetY +
      ',"layerY":' + p.layerY +
      ',"fontSetting":' + p.fontSetting +
      ',"fontDrawnPx":' + p.fontDrawnPx +
      ',"compWidth":' + p.compWidth +
      ',"fontFace":"' + lcp_esc(p.fontFace) + '"' +
      ',"fraction":' + (p.compHeight > 0 ? (p.anchorY / p.compHeight) : 0) + "}";
  }

  // "created" stays the total layer count; text and backdrops break it down, so
  // the panel can say where the layers went instead of implying they are all
  // captions.
  return '{"ok":true,"created":' + (created + backdrops) +
         ',"text":' + created + ',"backdrops":' + backdrops +
         ',"removed":' + removed + placement +
         ',"errors":' + lcp_jsonStringArray(errors) +
         ',"warnings":' + lcp_jsonStringArray(warnings) + "}";
}

/** Remove only the layers tagged by this panel. */
/**
 * Remove the layers this panel tagged, and report how many went.
 *
 * No undo group of its own, so lcp_clear and lcp_create can wrap the removal and
 * whatever follows it into a single undoable step.
 */
function lcp_removeTagged(comp) {
  var removed = 0;
  if (!comp) return removed;

  for (var i = comp.numLayers; i >= 1; i--) {
    var layer = comp.layer(i);
    var comment = "";
    try { comment = layer.comment ? String(layer.comment) : ""; } catch (err) { comment = ""; }
    if (comment.indexOf(LCP_TAG) === 0) {
      layer.remove();
      removed++;
    }
  }
  return removed;
}

function lcp_clear() {
  var comp = lcp_activeComp();
  if (!comp) {
    return lcp_error("No active composition. Open a composition in After Effects first.");
  }

  var removed = 0;

  app.beginUndoGroup("Caption Wizard: Clear Generated");
  try {
    removed = lcp_removeTagged(comp);
  } finally {
    app.endUndoGroup();
  }

  return '{"ok":true,"removed":' + removed + "}";
}
