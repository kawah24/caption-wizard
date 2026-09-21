/**
 * Caption Wizard - style previews.
 *
 * Three things are built here from the same data:
 *   - the small animation on each style card in the grid
 *   - the large live preview stage at the top of the Style tab
 *   - the same stage markup reused by the standalone browser preview page
 *
 * Everything is drawn with DOM + CSS, so the extension ships zero media files.
 * If the user drops their own media into
 *   client/assets/previews/<style-id>.png | .webm | .mp4
 * the card uses it instead, falling back to the CSS animation when it is
 * missing or fails to load.
 */
(function (root) {
  "use strict";

  var MEDIA_TYPES = [
    { ext: "webm", tag: "video" },
    { ext: "mp4", tag: "video" },
    { ext: "png", tag: "img" },
    { ext: "jpg", tag: "img" }
  ];

  var MOTION_CLASS = {
    "none": "pv-none",
    "slideUp": "pv-slide-up",
    "slideDown": "pv-slide-down",
    "slideLeft": "pv-slide-left",
    "slideRight": "pv-slide-right",
    "popIn": "pv-pop-in",
    "zoomPunch": "pv-zoom-punch",
    "blurFade": "pv-blur-fade",
    "cinematic": "pv-cinematic",
    "karaoke": "pv-karaoke",
    "flickerOut": "pv-flicker-out",
    "pulse": "pv-pulse",
    "wordPunch": "pv-word-punch",
    "neon": "pv-neon"
  };

  /** Reference comp width used to scale caption sizes onto a small preview. */
  var REFERENCE_COMP_WIDTH = 1920;

  function motionClass(motion) {
    return MOTION_CLASS[motion] || "pv-none";
  }

  /**
   * The caption line itself. Karaoke needs per-word spans so a single word can
   * be highlighted; everything else is one text node.
   */
  /**
   * Tag a caption line whose words should highlight one by one.
   *
   * The marker is independent of the motion class: the comp highlights karaoke
   * words no matter which motion the style uses, so the preview has to as well.
   */
  function withKaraokeMarker(label, preset) {
    var karaoke = !!(preset && (preset.karaoke || preset.forceKaraoke));
    label.className = "pv-text" + (karaoke ? " pv-karaoke-words" : "");
    return label;
  }

  /**
   * The caption line itself.
   *
   * Real transcript text is used when it is supplied, otherwise the preset's own
   * sample line stands in. Word-by-word looks need one span per word so a single
   * word can carry its own colour and size.
   */
  function buildCaptionLine(preset, settings, text, words) {
    var label = document.createElement("span");
    withKaraokeMarker(label, preset);

    var wordTexts = null;
    var i;

    if (words && words.length) {
      wordTexts = [];
      for (i = 0; i < words.length; i++) wordTexts.push(String(words[i].text || ""));
    } else if (preset && preset.previewWords && preset.previewWords.length) {
      wordTexts = preset.previewWords.slice(0);
    }

    var perWord = !!(preset && (preset.karaoke || (preset.previewWords && preset.previewWords.length)));

    if (perWord && wordTexts && wordTexts.length) {
      var step = 0.6;
      var cycle = (wordTexts.length + 1) * step;
      for (i = 0; i < wordTexts.length; i++) {
        var word = document.createElement("span");
        word.className = "pv-word";
        word.textContent = wordTexts[i];
        word.style.animationDelay = (i * step) + "s";
        word.style.animationDuration = cycle + "s";

        // Word-per-word looks put one word on screen at a time in the comp, where
        // every word is its own layer. On a card the label animates as a whole,
        // which cannot show that - so the spans pop in turn instead, using the
        // delays already set above.
        if (preset && preset.motion === "wordPunch") {
          word.style.animationName = "lcpWordPunch";
          word.style.animationIterationCount = "infinite";
          word.style.animationTimingFunction = "steps(1, end)";
        }

        label.appendChild(word);
        if (i < wordTexts.length - 1) {
          label.appendChild(document.createTextNode(" "));
        }
      }
    } else {
      label.textContent = (text && text.length) ? text : (preset.previewLine || preset.name);
    }

    if (settings) applyTextStyle(label, preset, settings, 1);
    return label;
  }

  /** "#rrggbb" + alpha -> rgba(), for the preview's background bar. */
  function rgba(hex, alpha) {
    var text = String(hex || "#000000").replace("#", "");
    if (text.length === 3) {
      text = text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2);
    }
    var value = parseInt(text, 16);
    if (isNaN(value)) value = 0;
    var r = (value >> 16) & 255;
    var g = (value >> 8) & 255;
    var b = value & 255;
    var a = (alpha === undefined) ? 1 : alpha;
    return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
  }

  /** Lowercase, letters and digits only - for comparing names across formats. */
  function normalizeName(value) {
    return String(value === null || value === undefined ? "" : value)
      .toLowerCase()
      .replace(/[\s\-_]/g, "");
  }

  /** "BebasNeue" -> "Bebas Neue", so a PostScript name can match a CSS family. */
  function camelSplit(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  /**
   * Map an After Effects PostScript name onto a font family the panel can render.
   *
   * AE insists on PostScript names ("BebasNeue-Bold"); CSS wants family names
   * ("Bebas Neue"). Guessing alone is unreliable, so this snaps the name against
   * the real family list reported by After Effects, longest match first, and only
   * then falls back to splitting the camel case.
   */
  function familyForPostScript(psName) {
    var raw = String(psName || "").trim();
    if (!raw) return "Arial";

    var key = normalizeName(raw);
    var stripped = raw.split("-")[0];
    var list = (root.LcpFonts && root.LcpFonts.families) ? root.LcpFonts.families() : [];
    var i;

    for (i = 0; i < list.length; i++) {
      if (normalizeName(list[i]) === key) return list[i];
    }

    var best = null;
    var bestLen = 0;
    for (i = 0; i < list.length; i++) {
      var normal = normalizeName(list[i]);
      if (normal.length < 3) continue;
      if (key.indexOf(normal) === 0 && normal.length > bestLen) {
        best = list[i];
        bestLen = normal.length;
      }
    }
    if (best) return best;

    for (i = 0; i < list.length; i++) {
      if (normalizeName(list[i]) === normalizeName(stripped)) return list[i];
    }

    var split = camelSplit(stripped);
    return split || raw;
  }

  /**
   * Is this family actually renderable in the panel?
   * Compares a probe string measured with the candidate against the same probe
   * measured with two known fallbacks: an unresolved family measures exactly the
   * same as its fallback, a real one does not.
   */
  function fontAvailable(family) {
    try {
      var canvas = document.createElement("canvas");
      var ctx = canvas.getContext("2d");
      if (!ctx) return true;

      var probe = "mmmmmmmmmmlliWWWQ@";
      ctx.font = "72px monospace";
      var baseMono = ctx.measureText(probe).width;
      ctx.font = "72px sans-serif";
      var baseSans = ctx.measureText(probe).width;

      ctx.font = "72px '" + String(family).replace(/'/g, "") + "', monospace";
      var withMono = ctx.measureText(probe).width;
      ctx.font = "72px '" + String(family).replace(/'/g, "") + "', sans-serif";
      var withSans = ctx.measureText(probe).width;

      return (withMono !== baseMono) || (withSans !== baseSans);
    } catch (err) {
      return true;
    }
  }

  /**
   * What the preview did with the requested font, for the status line.
   * Returns {family, ok}. ok=false means the panel is showing a fallback and the
   * comp will not look like this.
   */
  /**
   * What the preview should actually render, and whether that is what was asked
   * for. A font the host has never heard of, or one Chromium cannot draw, becomes
   * Arial - the same family the host script falls back to - so the panel and the
   * composition agree instead of the preview quietly showing something else.
   */
  function resolvePreviewFont(psName) {
    var family = familyForPostScript(psName);

    var hostKnows = (root.LcpFonts && root.LcpFonts.hasFamily)
      ? root.LcpFonts.hasFamily(family) : false;
    var drawable = hostKnows ? fontAvailable(family) : false;

    if (hostKnows && drawable) {
      return { family: family, ok: true, requested: psName, missing: null };
    }

    var fallback = (root.LcpFonts && root.LcpFonts.FALLBACK_FAMILY) || "Arial";
    return { family: fallback, ok: false, requested: psName, missing: family };
  }

  function fontStatusText(psName) {
    var resolved = resolvePreviewFont(psName);
    if (resolved.ok) {
      return "preview font: " + resolved.family;
    }
    return "preview font: " + resolved.family + " (" + resolved.missing +
      " is not installed) - both the preview and the comp use " + resolved.family + ".";
  }

  /**
   * Glow halo radii for a rendered font size and a 0-100 amount.
   *
   * The floors are not zero, and not tiny: on a portrait comp the live stage draws
   * text at around 7px, where a proportional halo works out under a pixel - so a
   * glow that is plainly there in the comp looked absent in the panel. The stage
   * note already says the glow is approximated here, so the floor keeps it visible
   * rather than pretending the light is not there.
   */
  function glowRadii(renderedSize, amount) {
    var strength = (amount === undefined ? 40 : amount) / 100;
    var size = Math.max(1, renderedSize || 1);
    return {
      near: Math.max(2, Math.round(size * (0.08 + 0.30 * strength))),
      far: Math.max(5, Math.round(size * (0.20 + 0.80 * strength)))
    };
  }

  /**
   * Outline width for the preview, in preview pixels.
   *
   * The same rule the host applies to the comp: the style's width scaled by the
   * comp-to-preview factor. This used to be scaled by an extra 0.3 and floored at
   * 1px, which pinned every width below about 16px to the same 1px line - so the
   * Outline slider did nothing until the very top of its range.
   */
  function strokePx(strokeWidth, factor) {
    var width = (strokeWidth === undefined) ? 6 : strokeWidth;
    return Math.max(0, width * factor);
  }

  /**
   * An outline that can only grow outward, as a text-shadow list.
   *
   * -webkit-text-stroke paints centred on the glyph edge and over the fill, so
   * half of it eats into the letter; paint-order fixes that but is not honoured
   * everywhere the panel runs. Shadows always paint behind the text, so sixteen
   * offset copies, each the whole glyph, dilate it outward. Nothing is blurred,
   * because the target look is a hard edge: the fill keeps the shapes the font
   * drew, and the outline can only grow outward. That is the same reading as
   * After Effects' Fill Over Stroke, which the host sets with strokeOverFill =
   * false.
   */
  function outlineShadow(renderedStroke, colour) {
    var reach = Math.max(0, renderedStroke / 2);
    var steps = 16;                       // a 16-point dilation is smooth to a fraction of a pixel
    var parts = [];
    var i;
    for (i = 0; i < steps; i++) {
      var angle = (Math.PI * 2 / steps) * i;
      var x = Math.round(Math.cos(angle) * reach * 100) / 100;
      var y = Math.round(Math.sin(angle) * reach * 100) / 100;
      parts.push(x + "px " + y + "px 0 " + colour);
    }
    return parts.join(", ");
  }

  /**
   * The glow as a text-shadow value, or "" when the style has none.
   *
   * Shared by the stage and the style cards so a neon style looks like one
   * wherever it appears, and it keeps the two in step with the host, which uses
   * the same 0.20 + 0.80x curve for After Effects' Glow radius.
   */
  function glowShadow(renderedSize, settings) {
    if (!settings || !settings.applyGlow) return "";
    var amount = (settings.glowAmount === undefined) ? 40 : settings.glowAmount;
    if (!(amount > 0)) return "";

    var colour = settings.glowColor || settings.fill || "#ffffff";
    var glow = glowRadii(renderedSize, amount);
    return "0 0 " + glow.near + "px " + colour + ", 0 0 " + glow.far + "px " + colour;
  }

  /**
   * Lines per caption.
   *
   * The host writes hard returns into the generated text, so the preview has to
   * break the same way - otherwise it shows one long line that will never appear
   * in the composition. Word-by-word looks are left alone: each word is already
   * its own layer laid out on a single line, and the host does not split them.
   */
  function applyLineBreaks(label, settings) {
    if (!label) return;
    if (label.getElementsByClassName && label.getElementsByClassName("pv-word").length) return;

    var plain = label.getAttribute("pv-plain-text");
    if (plain === null || plain === undefined) {
      plain = label.textContent || "";
      label.setAttribute("pv-plain-text", plain);
    }
    if (!plain) return;

    var wanted = parseInt(settings && settings.lines ? settings.lines : "1", 10);
    var limit = settings ? settings.maxWords : undefined;
    var parts = (isNaN(wanted) || wanted < 2)
      ? [plain]
      : ((root.LcpTranscript && root.LcpTranscript.splitIntoLines)
          ? root.LcpTranscript.splitIntoLines(plain, wanted, limit)
          : [plain]);

    while (label.firstChild) label.removeChild(label.firstChild);

    if (parts.length < 2) {
      label.appendChild(document.createTextNode(parts[0] || ""));
      return;
    }

    for (var i = 0; i < parts.length; i++) {
      var row = document.createElement("span");
      row.className = "pv-line";
      row.textContent = parts[i];
      label.appendChild(row);
    }
  }

  /** Frame width assumed when the stage is not laid out yet, so no size is NaN. */
  var FALLBACK_FRAME_WIDTH = 340;

  /**
   * Comp-to-preview size multiplier for a preview frame `frameWidth` wide.
   *
   * The host authors every size against a 1920px-wide comp and scales it by
   * compWidth/1920, so the preview must divide by the same 1920 reference. This
   * used to divide by the comp's own width instead, which made preview text
   * 1920/compWidth too large: invisible on a 1920-wide comp, but 1.78x on a
   * 1080x1920 vertical one.
   */
  function sizeFactor(frameWidth) {
    var width = Number(frameWidth);
    if (!(width > 0)) width = FALLBACK_FRAME_WIDTH;
    return width / REFERENCE_COMP_WIDTH;
  }

  /**
   * Where a caption sits in its frame, given a style's position and alignment.
   *
   * Shared by the live stage and the style cards so the two cannot drift, and it
   * mirrors what the host does to the composition: the anchor stays at the
   * horizontal position and the alignment decides which side the text grows from.
   */
  function captionPlacement(settings) {
    var align = String((settings && settings.align) || "center");
    if (align !== "left" && align !== "right") align = "center";

    var shift = align === "left" ? "0" : (align === "right" ? "-100%" : "-50%");
    var posX = (settings && settings.posX !== undefined) ? settings.posX : 50;
    var posY = (settings && settings.posY !== undefined) ? settings.posY : 78;

    return {
      align: align,
      left: posX + "%",
      top: posY + "%",
      transform: "translate(" + shift + ", -50%)"
    };
  }

  /**
   * The preview's animation cycle, from the style's in and out durations.
   *
   * The stage's keyframes are shared with the style cards and are percentage
   * based, so the phases scale together: a longer In or Out is visibly slower,
   * which is what the sliders are for. The comp is exact; this is proportional.
   */
  function motionCycleMs(inMs, outMs) {
    var pause = 900;
    var enter = Math.max(0, inMs === undefined ? 250 : inMs);
    var exit = Math.max(0, outMs === undefined ? 180 : outMs);
    return Math.max(300, Math.round(enter + pause + exit));
  }

  /**
   * Push the style settings onto a caption line as inline CSS.
   * `scale` maps comp-sized values onto the preview's own width.
   */
  function applyTextStyle(label, preset, settings, scale) {
    if (!label || !settings) return;

    var factor = scale || 1;

    label.style.color = settings.fill || "#ffffff";

    // Snap the PostScript name onto a family the panel can actually render, and
    // record whether it resolved, so the status line can be honest about it.
    var resolvedFont = resolvePreviewFont(settings.fontFamily);
    label.style.fontFamily = '"' + resolvedFont.family + '", Arial, sans-serif';
    label.setAttribute("data-preview-font", resolvedFont.family);
    label.setAttribute("data-preview-font-ok", resolvedFont.ok ? "1" : "0");

    // Only fake bold when the family really has a bold face. Chromium will
    // synthesise one otherwise, which makes the preview heavier and wider than
    // the composition - After Effects falls back to the regular face instead.
    // Bangers and Impact, for example, are single-weight.
    var familyHasBold = (root.LcpFonts && root.LcpFonts.hasBold)
      ? root.LcpFonts.hasBold(resolvedFont.family) : true;
    label.setAttribute("data-bold-faked", (settings.bold && !familyHasBold) ? "1" : "0");
    label.style.fontWeight = (settings.bold && familyHasBold) ? "700" : "400";

    // A small floor keeps a tiny frame legible; it is not a design size, so the
    // caption still holds its share of the frame on a small vertical preview.
    var renderedSize = Math.max(5, Math.round((settings.fontSize || 72) * factor));
    label.style.fontSize = renderedSize + "px";

    var transform = String(settings.transform || "none");
    label.style.textTransform = transform === "uppercase" ? "uppercase"
      : (transform === "lowercase" ? "lowercase" : "none");

    label.style.letterSpacing = (((settings.tracking || 0) / 1000) * (settings.fontSize || 72) * factor) + "px";

    // Drop shadow and glow are approximated with text-shadow layers. Their
    // geometry is derived from the RENDERED font size, not from the comp-to-
    // preview scale: scaling a shadow by 0.22 turns a 3px offset into 1px, which
    // is invisible. The host uses the same ratios, so the preview stays honest.
    var effects = [];
    if (settings.applyShadow) {
      var shadowAlpha = 0.85 * ((settings.shadowAmount === undefined ? 55 : settings.shadowAmount) / 100);
      var offset = Math.max(2, Math.round(renderedSize * 0.10));
      var blur = Math.max(4, Math.round(renderedSize * 0.25));
      effects.push(Math.round(offset * 0.7) + "px " + offset + "px " + blur + "px " +
        rgba(settings.shadowColor || "#000000", shadowAlpha));
    }
    var glow = glowShadow(renderedSize, settings);
    if (glow) effects.push(glow);
    label.style.textShadow = effects.join(", ");

    applyLineBreaks(label, settings);

    // In and Out animation lengths drive how fast the preview plays.
    label.style.animationDuration = motionCycleMs(settings.inDurMs, settings.outDurMs) + "ms";

    if (settings.filled === false) {
      label.style.color = "transparent";
      label.style.webkitTextFillColor = "transparent";
    } else {
      label.style.webkitTextFillColor = "";
    }

    var strokeWidthPx = strokePx(settings.strokeWidth, factor);
    var outlineOnly = (settings.filled === false);
    if (settings.applyStroke && !outlineOnly) {
      // Drawn as shadows, so the outline sits outside the letters rather than
      // eating into them. Placed first in the list, which CSS paints on top.
      effects.unshift(outlineShadow(strokeWidthPx, settings.strokeColor || "#000000"));
      label.style.webkitTextStroke = "0";
    } else if (outlineOnly) {
      // Nothing to hide the inner half behind, so this has to be a real stroke.
      // It reads slightly centred - a limit of CSS and After Effects alike.
      label.style.webkitTextStroke = strokeWidthPx.toFixed(2) + "px " +
        (settings.strokeColor || "#000000");
    } else {
      label.style.webkitTextStroke = "0";
    }
    label.style.paintOrder = "";

    // Karaoke colours travel as custom properties so the keyframes pick them up.
    if (preset && preset.karaoke) {
      label.style.setProperty("--lcp-karaoke-dim", settings.karaokeDim || "#9a9a9a");
      label.style.setProperty("--lcp-karaoke-hi", settings.karaokeHighlight || "#ffd400");
    }

    // Power words on a word-level preview.
    var wordNodes = label.getElementsByClassName ? label.getElementsByClassName("pv-word") : [];
    var karaoke = !!(preset && preset.karaoke);
    for (var w = 0; w < wordNodes.length; w++) {
      if (karaoke) break; // karaoke animates its own colours
      var emphasised = root.LcpPresets.isEmphasisWord(wordNodes[w].textContent, settings, true);
      if (emphasised) {
        wordNodes[w].style.color = settings.emphasisColor || "#ffd400";
        wordNodes[w].style.fontSize = Math.round(
          (settings.fontSize || 72) * factor * ((settings.emphasisScale || 110) / 100)
        ) + "px";
      } else {
        wordNodes[w].style.color = "";
        wordNodes[w].style.fontSize = "";
      }
    }
  }

  /** Replace the CSS placeholder with the user's media once it has loaded. */
  function attachMedia(frame, presetId, index) {
    if (index >= MEDIA_TYPES.length) return;

    var candidate = MEDIA_TYPES[index];
    var url = "assets/previews/" + presetId + "." + candidate.ext;
    var node;

    if (candidate.tag === "video") {
      node = document.createElement("video");
      node.muted = true;
      node.loop = true;
      node.autoplay = true;
      node.playsInline = true;
    } else {
      node = document.createElement("img");
      node.alt = "";
    }
    node.className = "pv-media";

    node.onerror = function () { attachMedia(frame, presetId, index + 1); };
    node.onloadeddata = function () {
      if (node.parentNode !== frame) {
        while (frame.firstChild) frame.removeChild(frame.firstChild);
        frame.appendChild(node);
        frame.className = "pv pv-media-frame";
      }
    };
    node.onload = node.onloadeddata;

    if (candidate.tag === "video") {
      node.src = url;
      try { node.play(); } catch (err) { /* autoplay may be blocked; harmless */ }
    } else {
      node.src = url;
    }
  }

  /** Small animated preview used inside a style card. */
  function buildPreview(preset, options) {
    var opts = options || {};
    var frame = document.createElement("div");
    frame.className = "pv " + motionClass(preset.motion);
    frame.appendChild(buildCaptionLine(preset, opts.settings));

    if (!opts.disableMedia) attachMedia(frame, preset.id, 0);
    return frame;
  }

  /** A preset's own settings: its shipped look, not the user's current edits. */
  function presetSettings(preset) {
    if (!preset || !root.LcpPresets || !root.LcpPresets.resolveSettings) return null;
    try {
      return root.LcpPresets.resolveSettings(preset.id, {}, root.LcpPresets.TIMING_DEFAULTS);
    } catch (err) {
      return null;
    }
  }

  /** The type size the stylesheet gives a card's caption. */
  var CARD_TEXT_PX = 13;

  /**
   * Apply the parts of a style a card can show without breaking the picker.
   *
   * Every card's caption is centred by the stylesheet at one legible size: the
   * grid is a picker, not a proof. Scaling type against a card's width worked out
   * around 8-9px, and following each style's own position spread the captions
   * around the cards so they could not be compared.
   *
   * The glow is the exception. A neon style with no halo in its card reads as a
   * style that has no glow at all.
   */
  function applyCardStyle(frame, preset) {
    if (!frame) return;

    var label = frame.getElementsByClassName("pv-text")[0];
    if (!label) return;

    var settings = presetSettings(preset);
    if (!settings) return;

    var glow = glowShadow(CARD_TEXT_PX, settings);
    if (glow) label.style.textShadow = glow;
  }

  /** One clickable style card. */
  function buildCard(preset, opts) {
    var options = opts || {};
    var card = document.createElement("div");
    card.className = "style-card" + (options.selected ? " selected" : "");
    card.setAttribute("data-style-id", preset.id);
    card.title = preset.blurb || preset.name;

    // A card shows the style's own shipped look, never the settings being edited:
    // a grid that reflows while a slider is dragged is hard to choose from, and
    // one style's oversized text would overflow every other card.
    var frame = buildPreview(preset, { settings: options.settings });
    card.appendChild(frame);

    var name = document.createElement("div");
    name.className = "style-card-name";
    name.textContent = preset.name;
    card.appendChild(name);

    // The scale needs the card's real width, which only exists once the card is in
    // the grid, so it lands on the next frame. Until then the label keeps its
    // stylesheet size rather than flashing at the wrong one.
    if (root.requestAnimationFrame) {
      root.requestAnimationFrame(function () { applyCardStyle(frame, preset); });
    }

    if (typeof options.onSelect === "function") {
      card.onclick = function () { options.onSelect(preset.id); };
    }
    return card;
  }

  /**
   * The large live preview stage.
   *
   * Markup: a 16:9 frame carrying the same motion class as the small cards, with
   * the caption line positioned by the style's horizontal/vertical percentages,
   * which is the same geometry the host script uses in the composition.
   */
  /**
   * Size the stage to the composition's aspect ratio, not a fixed 16:9.
   *
   * A 1080x1920 vertical comp and a 16:9 preview put the caption in a visibly
   * different place in the frame, which is exactly what made the preview look
   * unlike the video. The frame is capped in height so a tall comp still fits
   * the panel.
   */
  function sizeStage(stage, compWidth, compHeight, maxHeight) {
    var parent = stage.parentNode;
    var box = (parent && parent.clientWidth) ? parent.clientWidth : 340;
    var cap = maxHeight || 300;
    var width = compWidth || REFERENCE_COMP_WIDTH;
    var height = compHeight || Math.round(REFERENCE_COMP_WIDTH * 9 / 16);

    var frameWidth = box;
    var frameHeight = Math.round(box * height / width);
    if (frameHeight > cap) {
      frameHeight = cap;
      frameWidth = Math.round(cap * width / height);
    }

    stage.style.width = frameWidth + "px";
    stage.style.height = frameHeight + "px";
    stage.style.marginLeft = "auto";
    stage.style.marginRight = "auto";
  }

  function buildStage(preset, settings, options) {
    var opts = options || {};
    var compWidth = opts.compWidth || REFERENCE_COMP_WIDTH;
    var compHeight = opts.compHeight || Math.round(REFERENCE_COMP_WIDTH * 9 / 16);

    var stage = document.createElement("div");
    stage.className = "stage";
    stage.setAttribute("data-style-id", preset.id);
    stage.setAttribute("data-comp", compWidth + "x" + compHeight);

    var frame = document.createElement("div");
    frame.className = "pv " + motionClass(preset.motion);
    frame.setAttribute("data-motion", preset.motion);

    var anchor = document.createElement("div");
    anchor.className = "stage-anchor";
    anchor.appendChild(buildCaptionLine(
      preset, null,
      opts.caption ? opts.caption.text : "",
      opts.caption ? opts.caption.words : null
    ));

    frame.appendChild(anchor);
    stage.appendChild(frame);

    sizeStage(stage, compWidth, compHeight, opts.maxHeight);
    applyStageSettings(stage, preset, settings, { compWidth: compWidth, compHeight: compHeight });

    // The stage is still detached here, so it has no width yet: that first pass
    // measured the text against the fallback frame width. Re-fit and re-apply once
    // the caller has put it in the document, otherwise the panel opens showing the
    // wrong text size and only corrects itself when something else re-fits.
    if (root.requestAnimationFrame) {
      root.requestAnimationFrame(function () {
        sizeStage(stage, compWidth, compHeight, opts.maxHeight);
        applyStageSettings(stage, preset, settings, { compWidth: compWidth, compHeight: compHeight });
      });
    }

    // The requestAnimationFrame above cannot help while the stage has no width at
    // all - which is the case for a table built on a hidden tab, where it measures
    // zero and falls back to the assumed frame width. Watch the stage instead and
    // re-fit whenever its width actually changes: being revealed, the panel being
    // resized, and the layout switching between wide and narrow all land here.
    if (root.ResizeObserver) {
      var lastWidth = stage.clientWidth || 0;
      var watch = new root.ResizeObserver(function () {
        var width = stage.clientWidth || 0;
        if (!width || width === lastWidth) return;
        lastWidth = width;
        sizeStage(stage, compWidth, compHeight, opts.maxHeight);
        applyStageSettings(stage, preset, settings, { compWidth: compWidth, compHeight: compHeight });
      });
      watch.observe(stage);
    }

    if (!opts.disableMedia) attachMedia(frame, preset.id, 0);
    return stage;
  }

  /**
   * Restyle an existing stage in place - this is what makes the preview repaint
   * on every font/size/colour change without rebuilding the DOM.
   */
  function applyStageSettings(stage, preset, settings, options) {
    if (!stage || !settings) return;

    var opts = options || {};
    var compWidth = opts.compWidth || REFERENCE_COMP_WIDTH;
    var compHeight = opts.compHeight || Math.round(REFERENCE_COMP_WIDTH * 9 / 16);

    var frame = stage.getElementsByClassName("pv")[0];
    var anchor = stage.getElementsByClassName("stage-anchor")[0];
    var label = stage.getElementsByClassName("pv-text")[0];
    if (!frame || !anchor || !label) return;

    // Sizes are authored against a 1920px-wide comp, exactly as the host does,
    // so the caption takes the same share of the frame as it will in After
    // Effects - on any comp size, not only a 1920-wide one.
    applyTextStyle(label, preset, settings, sizeFactor(stage.clientWidth));

    anchor.style.left = (settings.posX === undefined ? 50 : settings.posX) + "%";
    anchor.style.top = (settings.posY === undefined ? 78 : settings.posY) + "%";

    // Align works the way it does in After Effects: the anchor point stays at the
    // horizontal position and the justification decides which side the text
    // extends from. Ignoring it here meant the preview always looked centred.
    var spot = captionPlacement(settings);
    anchor.style.textAlign = spot.align;
    anchor.style.transform = spot.transform;

    // Background bar: a padded box on the anchor, so the text stays centred.
    if (settings.applyBox) {
      var pad = Math.max(1, Math.round((settings.boxPadding || 18) * factor));
      anchor.style.background = rgba(settings.boxColor || "#000000",
        (settings.boxOpacity === undefined ? 70 : settings.boxOpacity) / 100);
      anchor.style.padding = pad + "px " + (pad * 1.4) + "px";
      anchor.style.borderRadius = "3px";
    } else {
      anchor.style.background = "";
      anchor.style.padding = "";
      anchor.style.borderRadius = "";
    }

    // Media overrides replace the CSS animation entirely.
    if (frame.className.indexOf("pv-media-frame") >= 0) return;

    frame.className = "pv " + motionClass(preset.motion);
  }

  /**
   * Swap the caption a stage is showing - used to put real transcript text in
   * place of the preset's sample line after the transcript changes.
   */
  function setStageCaption(stage, preset, settings, caption, options) {
    if (!stage) return;

    var anchor = stage.getElementsByClassName("stage-anchor")[0];
    var label = stage.getElementsByClassName("pv-text")[0];
    if (!anchor || !label) return;

    var opts = options || {};
    var compWidth = opts.compWidth || REFERENCE_COMP_WIDTH;

    var replacement = buildCaptionLine(
      preset, null,
      caption ? caption.text : "",
      caption ? caption.words : null
    );

    anchor.replaceChild(replacement, label);
    applyTextStyle(replacement, preset, settings, sizeFactor(stage.clientWidth));
  }

  root.LcpPreviews = {
    REFERENCE_COMP_WIDTH: REFERENCE_COMP_WIDTH,
    buildPreview: buildPreview,
    buildCard: buildCard,
    buildStage: buildStage,
    sizeStage: sizeStage,
    setStageCaption: setStageCaption,
    buildCaptionLine: buildCaptionLine,
    applyStageSettings: applyStageSettings,
    applyTextStyle: applyTextStyle,
    motionClass: motionClass,
    motionCycleMs: motionCycleMs,
    sizeFactor: sizeFactor,
    captionPlacement: captionPlacement,
    presetSettings: presetSettings,
    applyCardStyle: applyCardStyle,
    FALLBACK_FRAME_WIDTH: FALLBACK_FRAME_WIDTH,
    withKaraokeMarker: withKaraokeMarker,
    glowRadii: glowRadii,
    glowShadow: glowShadow,
    strokePx: strokePx,
    outlineShadow: outlineShadow,
    applyLineBreaks: applyLineBreaks,
    normalizeName: normalizeName,
    camelSplit: camelSplit,
    familyForPostScript: familyForPostScript,
    fontAvailable: fontAvailable,
    resolvePreviewFont: resolvePreviewFont,
    fontStatusText: fontStatusText
  };
})(window);
