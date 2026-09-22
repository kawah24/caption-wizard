# Caption Wizard

A local-only caption panel for **After Effects 2022+** (CEP 11), version 1.8.41.

No sign-in. No account. No licence key. No subscription tier. No telemetry. The
extension itself makes no network requests at all — it parses your transcript in
the page and creates text layers directly in the active composition.

It can also **transcribe audio on this machine** (ffmpeg + faster-whisper), so
you get automatic captions with real word timings without uploading anything
anywhere.

---

## Install (Windows)

### Option A — the helper script

1. Close After Effects.
2. Right-click `install.ps1` → **Run with PowerShell**.
3. Reopen After Effects → `Window > Extensions (Legacy) > Caption Wizard`.

The script copies this folder to
`%APPDATA%\Adobe\CEP\extensions\caption-wizard` and sets
`HKCU\Software\Adobe\CSXS.11` → `PlayerDebugMode = 1`, which is Adobe's own
documented switch for loading an unsigned extension. It is per-user and touches
nothing else.

### Option B — manual

1. Copy this folder to `%APPDATA%\Adobe\CEP\extensions\caption-wizard`
   (the folder must contain `CSXS\manifest.xml` directly).
2. Create `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` → `PlayerDebugMode`
   (String) = `1`.
3. Restart After Effects.

### macOS

```
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
cp -R <this folder> ~/Library/Application\ Support/Adobe/CEP/extensions/caption-wizard
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

---

## Using the panel

**Text tab** — one caption per line, or paste/load an SRT to keep your own
timecodes. `Load SRT...` reads the file locally; nothing is uploaded.

**Style tab** — pick one of the twenty built-in presets and tune it. The panel
opens on **Karaoke** with **Anton** at 84px, uppercase, pink highlight on white,
bolding off, 3 words per caption — the shipping look, and any of it can be changed
and is then remembered per preset.

**If the chosen font is not installed, everything falls back to Arial** — the
preview, the layers created in the composition, and the status line all say so.
Arial ships with every Windows and macOS install, so a style can never end up
with no usable font.

| | |
| --- | --- |
| Basic | Static, no motion |
| Slide Up / Down / Left / Right | Directional entrances |
| Pop In | Snaps to size with overshoot |
| Viral Pop | One word at a time, loud, with power words |
| Shorts Bar | Boxed captions on a solid bar |
| Zoom Punch | Slams in from large |
| Blur Fade | Soft opacity and scale settle |
| Cinematic | Wide letter spacing, slow drift |
| Flicker Out | Stutters out like a failing lamp |
| Pulse | Breathes on the beat |
| TikTok Classic | Heavy uppercase, centred low |
| Motivation | Uppercase rise, hot accent |
| Karaoke | Whole phrase stays, spoken word lights up |
| Word Punch | One word at a time |
| Neon Outline | Bright fill, heavy coloured outline |
| Outline Only | Unfilled text |

Every preset exposes letter spacing, **Case**, **Lines per caption** and the
filled/outline switch, so you can bend them further.

### Viral-style controls

The controls that make the difference between a plain subtitle and a caption
that reads as edited:

| Control | What it does |
| --- | --- |
| Case | As Typed / UPPERCASE / lowercase, applied to the generated text |
| Lines per caption | The **maximum** lines a caption may use, not a forced count. Together with Max words it sets the words per line: at 6 words and 3 lines a 3-word caption takes two lines, at 3 words and 3 lines it takes three |
| Max words per caption | Splits a longer cue into several captions. Applies to **everything**, including an SRT or a transcription, which are cut on their real word timings so each new cue's in and out points stay exact |
| Power words | A comma-separated list that always gets the accent colour |
| Auto: numbers and SHOUTED words | Emphasises `2024`, `$1,200`, `EVERYTHING` without any list |
| Power word colour / size | The accent colour, and a size boost up to 150% |
| Drop shadow | A layered drop shadow: **Shadow colour** and a **Shadow amount** slider for strength |
| Glow | A glow behind the text: **Glow colour** and a **Glow amount** slider. It is drawn on a duplicate of each layer placed *underneath*, because After Effects' Glow effect composites over the layer's own pixels and at high strengths brightens the glyphs themselves |
| Background bar | A solid bar behind the caption, sized from the text itself, with its own colour, opacity and padding |

Controls that belong to a switch only appear while that switch is on — turn on
**Drop shadow** and the colour and amount controls appear under it, turn on
**Glow** and its slider appears next to it. The same applies to the outline
colour/width and the background bar's colour, opacity and padding.

Shadow distance, softness and glow radius are derived from the **rendered font
size** using the same ratios in the panel preview and in the host script, so a
shadow you like in the preview has the same proportions in the composition.

Power words are honoured by the **word-at-a-time presets** (Viral Pop, Word
Punch), because those build one layer per word and can therefore give a single
word its own colour and size. The shouted-word rule backs off automatically when
a caption is *already* all caps, so an uppercase transcript does not highlight
every single word.

### Karaoke

Karaoke keeps the **whole phrase on screen** and lights up the word being
spoken, so the line reads as one sentence rather than single flashing words.
That is the difference from Word Punch, which shows one word at a time.

How it is built: each phrase becomes one text layer per word, all spanning the
phrase, laid out as a single centred line. Word widths are measured with
`sourceRectAtTime`, and the gap between words is recovered by measuring the same
phrase as one line — so the result matches the spacing of a normal text layer
instead of guessing. Each word then gets hold-interpolated colour keyframes
(`Other words` → `Spoken word`) across its own timing window, plus an optional
scale pop.

It needs **real word timings**. A local transcription supplies them exactly.
Pasted plain text does not, so the panel estimates them from the cue duration —
workable, but a transcription will always look tighter.

Two things to know:

- One phrase becomes N layers (one per word), so a long karaoke transcript makes
  a lot of layers. That is the honest cost of doing it without text animators.
- With **Glow** on, each of those layers also gets a backdrop duplicate placed
  underneath it (named `glow - ...`), so the layer count doubles. That is how the
  halo stays behind the text instead of washing out the karaoke highlight. The
  panel reports both numbers so the total is never a surprise.
- The approach deliberately avoids text-animator range selectors. Their match
  names vary between AE versions and could not be validated without a live host,
  whereas `addText` / `sourceRectAtTime` / Source Text keyframes are
  long-standing API.

The **Font** picker lists the fonts After Effects reports through `app.fonts`
(After Effects 24.0 and newer), so it is your real installed font list — 650
families on this machine — and you type in the filter box to narrow it. On older
versions, or if that API is unavailable, the panel says so and falls back to a
small built-in list.

**Timing tab**

| Control | What it does |
| --- | --- |
| Reading speed | Words per minute used to size cues that have no timecodes |
| Gap between captions | Silence inserted between generated cues |
| Offset | Shifts every cue earlier or later |

Cues that already carry timecodes — SRT, or a local transcription — keep their
own timings; only the offset is applied.

### Sizes are relative to a 1920px comp

Font size and outline width are authored against a **1920px-wide composition**,
the same reference the preview stage uses, and the host scales them to the comp
you are working in. So a style looks the same on a 1920x1080 landscape comp and
a 1080x1920 vertical one, instead of overflowing the narrower frame. Horizontal
and vertical position are percentages of the comp, so they already adapt.

**Buttons**

- `Generate Captions` — creates the text layers in the active comp inside a
  single undo group, and is shown on the **Style** tab only, because that is
  where the look is chosen; its status line stays visible on every tab. With
  **Replace previous captions** ticked (the default) it first removes the layers
  this panel previously made, so generating twice rebuilds the captions instead
  of stacking a second set on top. The clear and the rebuild share one undo
  group, so a single Ctrl+Z brings the old captions back.
- `Clear Generated` — removes **only** the layers this panel created. Every
  layer is tagged `LCP::created` in its comment, and only tagged layers are ever
  deleted.
- `Refresh` — re-checks the host handshake, the font list, and the active comp. The active comp is also re-read when the panel regains focus, so switching comps in After Effects is picked up as soon as you click back to the panel; the font list and the Auto Caption media only change on an explicit Refresh.

---

## Auto caption (offline)

The **Auto** tab transcribes **the video that is already open** — no file
browsing. On load, and again on **Refresh**, the panel asks the composition which
media to use: your selected layer if it carries audio, otherwise the first layer
with an audio-bearing file. `Use active comp video` re-reads it, and
`Choose a different file...` overrides with anything on disk.

The layer's own **start time is applied as the timing offset**, so captions line
up even when the clip does not begin at zero — media time *t* sits at composition
time *t + startTime*, which is why that offset is not optional. The status line
says when it was applied, and a clip with no audio track is flagged rather than
transcribed silently into nothing.

It needs three things on your machine:

| Requirement | Notes |
| --- | --- |
| Python with `faster-whisper` | `pip install faster-whisper` (pulls in CTranslate2) |
| `ffmpeg` on `PATH` | Used to extract 16 kHz mono audio |
| A whisper model in the local cache | `tiny`, `base`, `small`, `medium`, `large-v3` |

Press **Re-check** and the panel probes, in order: your saved path, the Python
bundled with AutoClaw at
`C:\Program Files\AutoClaw\resources\python\python.exe`, any `Python3*` under
`%LOCALAPPDATA%\Programs\Python`, then `python`/`python3` on `PATH`. The first
interpreter that can import `faster-whisper` wins, and its version is shown next
to the Python row. You can paste another interpreter path at any time.

Then choose a model and language, pick a file, and hit **Transcribe**. Progress
streams into the bar and each stage is named (extracting audio → loading model →
transcribing). **Cancel** kills the child process.

### Offline by default

The transcriber sets `HF_HUB_OFFLINE=1`, so a model that is not already cached
produces a clear error instead of a silent download. Tick **Allow a one-time
model download** if you want it to fetch one; the model list marks which models
are `(cached)` and which `(needs download)`.

### Model cost, roughly

| Model | Size on disk | Speed | Quality |
| --- | --- | --- | --- |
| `tiny` | ~75 MB | fastest | rough, good for testing |
| `base` | ~145 MB | fast | usable |
| `small` | ~490 MB | moderate | good default |
| `medium` | ~1.5 GB | slow | noticeably better on accents |
| `large-v3` | ~3 GB | slowest | best, needs the download |

### Performance and device

Transcription runs on the **CPU** by default, which is what always works. On
this machine a 15-second clip with the `tiny` model takes about
**two seconds** end to end. GPU is opt-in: pass `--device cuda` to the script
and it will try CUDA, falling back to CPU if the CUDA runtime cannot load.

(`device="auto"` is deliberately not used — on a machine with a partial CUDA
runtime it picks the GPU, model construction succeeds, and then the first
inference dies with "Library cublas64_12.dll is not found or cannot be loaded".)

Silence trimming with silero VAD is **off by default** and can be enabled with
`--vad`. An abandoned VAD pass can leave the model unable to start the next
call, so it is not on the default path.

### What the transcription gives you

Real cue boundaries **and real per-word timings**. The transcript box is filled
with SRT, and the word timings are kept alongside it, so one-word-at-a-time
styles (Word Punch) use the true timings instead of the built-in estimate. Edit
the transcript box and the panel falls back to parsing what you typed.

### If the panel says Node integration is unavailable

CEP reads the manifest's `CEFCommandLine` flags **once, when After Effects
starts** — not when a panel is opened. So after the manifest gains
`--enable-nodejs`, an already-running After Effects keeps the old CEF process
and the panel will still report Node as unavailable.

**Fully quit After Effects and reopen it.** Reopening just the panel is not
enough, and the panel looks up to date the whole time, because `host.jsx` and
the HTML are re-read from disk on every panel open.

The probe line the panel prints (`require: ..., cep_node: ..., bridge: ...`)
tells you which Node bridge was found. The panel accepts either `require` from
a merged context or `window.cep_node.require`.

### Why the manifest enables Node

`CSXS/manifest.xml` sets `--enable-nodejs` and `--mixed-context`. That is what
lets the panel spawn the local Python process. It is still local: the extension
never opens a socket.

---

## Preview before you install

Two ways to see a style before it reaches After Effects.

**In the panel.** The Style tab opens with a live preview stage: a 16:9 frame
showing the selected style at its real font, size, spacing, colour, outline and
position. It repaints immediately as you change anything — font, size, colours,
tracking, uppercase, position — without needing to generate anything.

The stage shows a **real caption from your transcript**, not a stock line: the
first caption with 2–6 words, so a style is never judged on a single word or on
an over-long line. Edit the transcript and the stage follows. With nothing
loaded it falls back to a sample line, and the status line always says which one
you are looking at.

**Reset** in the Settings header puts the current style back to its shipped
defaults, leaving every other preset alone.

**In a browser, before deploying.** Open `preview/index.html` in any browser.
It loads the panel's own modules (`presets.js`, `previews.js`, `controls.js`,
`fonts.js`) and renders all seventeen styles, the preview stage and the full
settings panel. No After Effects needed, nothing is installed.

**Checking the arrangement.** Open `preview/layout.html` to see the panel's
**own** `index.html` inside a frame at 380 / 619 / 620 / 900px. That is the real
layout resizing, not a mock-up - useful for judging the two-column breakpoint
without restarting After Effects.

- `Refresh` re-renders from the current files.
- `Reload page` is what you need after editing JavaScript, since the browser
  caches loaded scripts.
- The font list there comes from `preview/fonts.js`, generated from the fonts
  installed on this machine (650 families at the time of writing). Regenerate it
  after installing or removing fonts:

```
powershell -File tools\update-preview-fonts.ps1
```

The panel itself always asks After Effects for its font list through
`app.fonts`, so the browser preview is representative rather than authoritative.

### Preview versus the composition

The stage previews the **active composition**: it takes the comp's own aspect
ratio (a 1080x1920 vertical comp previews as a vertical frame, not 16:9) and
scales the text against the comp's width, so the caption occupies the same share
of the frame as it will after generating.

If a preview still does not look like the generated captions, the status line
under the stage says why:

- It names the **preview font**. After Effects identifies fonts by PostScript
  name (`BebasNeue-Bold`) while the panel renders by family name
  (`Bebas Neue`), so the panel maps one onto the other using the real font list
  from After Effects. If the family still cannot be rendered, the line says so
  instead of quietly showing a fallback.
- It warns when **bold is not available** for the chosen family. Chromium would
  otherwise synthesise a bold face, making the preview heavier and wider than
  the comp, where After Effects falls back to the regular weight.
- Shadow and glow are **approximations** — flat halos drawn with CSS, where
  After Effects applies its own Drop Shadow and Glow effects. The glow is drawn
  *behind* the text in both cases, so neither can wash out the letters; the
  falloff still differs.
- Glow **doubles the layer count** (one backdrop per caption layer, tagged like
  the rest so Clear Generated removes it), and both copies are parented to the
  control null and included in the pre-compose.
- Generate reports when an effect **could not be added to any layer**, instead of
  claiming success while the shadow or glow is silently missing.

---

## Your own preview media (optional)

The style cards animate with CSS, so the extension ships zero media files. If
you want your own preview clips on the cards, drop them in:

```
client/assets/previews/<style-id>.webm   (or .mp4, .png, .jpg)
```

with these style ids: `basic`, `slide-up`, `pop-in`, `blur-fade`, `word-punch`,
`neon`. Anything missing or failing to load silently falls back to the CSS
animation.

Fonts work the same way for the panel UI and the previews: put your own file in
`client/assets/fonts/` and add an `@font-face` block to `client/style.css`. Note
that text layers created in After Effects use the system font list, because AE
resolves fonts by PostScript name.

---

## File map

| Path | Purpose |
| --- | --- |
| `CSXS/manifest.xml` | CEP manifest — bundle `com.captionwizard.panel`, host AEFT, Node enabled |
| `.debug` | Dev-load switch for the unsigned bundle |
| `client/index.html` | Panel markup: Text / Style / Timing / Auto tabs |
| `client/style.css` | Panel styling and the CSS preview animations |
| `client/csinterface-lite.js` | Hand-written minimal CEP bridge + result unwrapper |
| `client/controls.js` | Control construction shared by the panel and the browser preview |
| `client/transcript.js` | SRT parsing, cue sequencing, word timing, transcriber cues |
| `client/fonts.js` | Font list from After Effects plus the filterable picker |
| `client/presets.js` | The six presets and the control schema |
| `client/previews.js` | Builds CSS previews, probes for your optional media |
| `client/transcribe-local.js` | Node bridge that runs the local transcriber |
| `client/main.js` | UI wiring, payload escaping, host calls |
| `host/host.jsx` | ExtendScript: font enumeration, layer creation and deletion |
| `tools/transcribe.py` | Offline transcriber: ffmpeg + faster-whisper |
| `tools/update-preview-fonts.ps1` | Regenerates the preview page's font list from installed fonts |
| `preview/index.html` | Browser preview of the panel: styles, stage, settings, fonts |
| `preview/layout.html` | The panel's own HTML in a resizable frame, to check the arrangement |
| `preview/preview.js` | Preview harness with a stand-in host bridge |
| `tests/transcript.smoke.js` | Node smoke test for the parsing and timing logic |
| `tests/fonts.smoke.js` | Font list handling, including whether a family really has a bold face |
| `tests/previews.smoke.js` | PostScript-name to CSS-family mapping, which decides whether the preview shows the font you picked |
| `tests/presets.smoke.js` | Pins the style contract the host script depends on |
| `tests/host.smoke.js` | Host helpers: font enumeration, case, line breaks, colours, which layer Auto Caption should transcribe, and the layer counts Generate creates (including the glow backdrops) |
| `tests/panel.smoke.js` | Panel markup and wiring: every element main.js looks up exists, each tab has a section, and the footer controls that must survive a tab switch are outside the part that hides |
| `tests/consistency.js` | Checks every preset's motion exists in the host script, has a preview class, and has CSS |
| `install.ps1` | Windows install helper |

---

## How the timing estimate works

For cues with no timecodes, each cue lasts `words / wpm` minutes, with a floor of
600 ms, and `gapMs` of silence is inserted after it.

Per-word timing (used by one-word-at-a-time styles when no real timings exist)
splits a cue's duration 40% equally across words and 60% weighted by word
length, so longer words hold the frame longer. The final word always ends exactly
on the cue end, so timing never drifts across a long transcript.

---

## Known limitations

- **Not runtime-tested inside After Effects.** The code is statically checked
  (`node --check`, XML parse, Python compile, a Node smoke test of the parsing
  and timing logic, and a real end-to-end transcription run) but the panel has
  not been exercised in a live AE session from the build environment. Treat the
  first run as a test.
- **Karaoke is layer-per-word.** In-phrase highlighting works (the phrase stays
  and the spoken word lights up), but it costs one layer per word. A
  text-animator version with one layer per phrase is a possible v2.
- **No drop shadow.** ExtendScript cannot add a text layer style reliably, so
  the look is fill + outline.
- **Position is approximate.** Comp-relative position lands on the text layer's
  anchor point, which sits at the text origin.
- **After Effects only.** The manifest targets `AEFT`.
- **`large-v3` is not cached**; it needs the one-time download toggle.
