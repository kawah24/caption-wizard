#!/usr/bin/env python3
"""
Caption Wizard - offline speech to text.

Everything happens on this machine: ffmpeg pulls the audio out, faster-whisper
(CTranslate2) transcribes it. There is no account, no API key, no upload and no
network access unless you explicitly pass --allow-download to fetch a model
that is not already in the local cache.

Usage
-----
  python transcribe.py --check
  python transcribe.py --input <media file> [--model small] [--language auto]

By default this runs on the CPU, which is the path that always works. Pass
--device cuda to try a GPU; it falls back to CPU when CUDA cannot load. VAD
silence trimming is off by default and can be enabled with --vad.

Output
------
Newline-delimited JSON on stdout. Zero or more progress objects, then exactly
one final result object:

  {"type":"progress","stage":"converting","percent":5}
  {"type":"result","ok":true,"language":"en","durationMs":12345,
   "segments":[{"startMs":1000,"endMs":2500,"text":"Hello there",
                "words":[{"text":"Hello","startMs":1000,"endMs":1600}]}]}

Exit status is 0 on success, 1 on failure.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

MODEL_CHOICES = ["tiny", "base", "small", "medium", "large-v3"]
DEFAULT_MODEL = "small"


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def progress(stage, percent, **extra):
    payload = {"type": "progress", "stage": stage, "percent": int(percent)}
    payload.update(extra)
    emit(payload)


def child_env(allow_download):
    """Force Hugging Face into offline mode unless downloads were asked for."""
    env = dict(os.environ)
    if not allow_download:
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return env


def hf_cache_root():
    candidates = [
        os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "huggingface", "hub"),
    ]
    for path in candidates:
        if path and os.path.isdir(path):
            return path
    return None


def cached_models():
    """Model names already present in the local Hugging Face cache."""
    root = hf_cache_root()
    found = []
    if not root:
        return found
    for name in MODEL_CHOICES:
        folder = os.path.join(root, "models--Systran--faster-whisper-" + name)
        if os.path.isdir(folder):
            found.append(name)
    return found


def find_ffmpeg():
    return shutil.which("ffmpeg")


def run_check():
    info = {
        "type": "check",
        "ok": True,
        "fasterWhisper": None,
        "ctranslate2": None,
        "ffmpeg": find_ffmpeg(),
        "python": sys.executable,
        "models": cached_models(),
        "error": None,
    }

    try:
        import faster_whisper  # noqa: F401
        info["fasterWhisper"] = getattr(faster_whisper, "__version__", "unknown")
    except Exception as exc:  # pragma: no cover - environment dependent
        info["ok"] = False
        info["error"] = "faster_whisper is not importable: %s" % exc

    try:
        import ctranslate2
        info["ctranslate2"] = ctranslate2.__version__
    except Exception:
        pass

    if not info["ffmpeg"]:
        info["ok"] = False
        info["error"] = info["error"] or "ffmpeg was not found on PATH"

    emit(info)
    return 0 if info["ok"] else 1


def extract_audio(ffmpeg, input_path, workdir, allow_download):
    out_path = os.path.join(workdir, "audio16k.wav")
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
        out_path,
    ]
    progress("converting", 3)
    subprocess.run(cmd, check=True, env=child_env(allow_download))
    progress("converting", 8)
    return out_path


def load_model(model_name, device="cpu"):
    """
    Build a WhisperModel on the CPU by default.

    device="auto" is deliberately avoided: on a machine with a partial CUDA
    runtime it selects the GPU, model construction succeeds, and then the first
    inference dies with "Library cublas64_12.dll is not found or cannot be
    loaded". Defaulting to CPU keeps the path that is known to work; GPU is
    opt-in through --device cuda, and falls back to CPU when it cannot load.
    """
    from faster_whisper import WhisperModel

    progress("loading model", 10, model=model_name, device=device)

    attempts = []
    if device == "cuda":
        attempts.append({"device": "cuda", "compute_type": "float16"})
        attempts.append({"device": "cuda", "compute_type": "int8_float16"})
    attempts.append({"device": "cpu", "compute_type": "int8"})
    attempts.append({"device": "cpu", "compute_type": "float32"})

    last_error = None
    for index, kwargs in enumerate(attempts):
        try:
            model = WhisperModel(model_name, **kwargs)
            if kwargs["device"] == "cpu" and device == "cuda":
                progress("loading model", 12, note="CUDA unavailable, falling back to CPU")
            return model
        except Exception as exc:
            last_error = exc
            if index < len(attempts) - 1:
                progress("loading model", 12,
                         note="retrying with %s/%s" % (kwargs["device"], kwargs["compute_type"]))
    raise RuntimeError(str(last_error))


def start_transcription(model, model_name, device, audio_path, language, use_vad):
    """
    Begin decoding and return (segments, info, first_segment).

    VAD is opt-in. On some installs the bundled silero VAD raises, and an
    abandoned generator can leave the CTranslate2 model in a state where the
    next call never returns. So a VAD failure closes the generator, builds a
    fresh model and retries once without VAD, rather than reusing the model.
    """
    options = {
        "language": None if language in (None, "", "auto") else language,
        "word_timestamps": True,
        "beam_size": 5,
    }

    if use_vad:
        options["vad_filter"] = True

    segments = None
    try:
        segments, info = model.transcribe(audio_path, **options)
        return segments, info, next(segments, None)
    except Exception as exc:
        if not use_vad:
            raise
        sys.stderr.write("VAD attempt failed (%s); retrying without VAD\n" % exc)
        progress("transcribing", 14, note="VAD failed, retrying without it")
        try:
            if segments is not None:
                segments.close()
        except Exception:
            pass
        options.pop("vad_filter", None)
        fresh = load_model(model_name, device)
        segments, info = fresh.transcribe(audio_path, **options)
        return segments, info, next(segments, None)


def add_word_timings(segment):
    words = []
    raw_words = getattr(segment, "words", None) or []
    for word in raw_words:
        text = (word.word or "").strip()
        if not text:
            continue
        words.append({
            "text": text,
            "startMs": int(round(word.start * 1000)),
            "endMs": int(round(word.end * 1000)),
        })
    return words


def run_transcribe(args):
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found on PATH")

    if not os.path.isfile(args.input):
        raise RuntimeError("Input file not found: %s" % args.input)

    if not args.allow_download and args.model not in cached_models():
        raise RuntimeError(
            "Model '%s' is not in the local cache and downloads are disabled. "
            "Re-run with --allow-download once to fetch it." % args.model
        )

    workdir = tempfile.mkdtemp(prefix="lcp-transcribe-")
    try:
        audio_path = extract_audio(ffmpeg, args.input, workdir, args.allow_download)
        model = load_model(args.model, args.device)
        segments, info, first = start_transcription(
            model, args.model, args.device, audio_path, args.language, args.vad
        )

        total = float(getattr(info, "duration", 0) or 0)
        detected = getattr(info, "language", None)
        out_segments = []
        index = 0

        def handle(segment):
            out = {
                "startMs": int(round(segment.start * 1000)),
                "endMs": int(round(segment.end * 1000)),
                "text": (segment.text or "").strip(),
                "words": add_word_timings(segment),
            }
            if out["text"]:
                out_segments.append(out)
            if total > 0:
                percent = 15 + min(84, int((segment.end / total) * 84))
            else:
                percent = min(98, 15 + index)
            progress("transcribing", percent, segment=index + 1)

        if first is not None:
            handle(first)
        for segment in segments:
            index += 1
            handle(segment)

        progress("done", 100)
        emit({
            "type": "result",
            "ok": True,
            "language": detected,
            "model": args.model,
            "durationMs": int(total * 1000),
            "onsetMs": detect_speech_onset(find_ffmpeg(), audio_path),
            "segments": out_segments,
        })
        return 0
    except Exception as exc:
        emit({"type": "result", "ok": False, "error": str(exc)})
        return 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def detect_speech_onset(ffmpeg, input_path):
    """Where the sound actually starts, in milliseconds.

    Whisper places its first segment conservatively, so the opening caption can
    land well after the speaker began. Measuring the onset with ffmpeg lets the
    panel pull the first cue back onto it. Returns None when it cannot tell, and 0
    when the clip opens with sound.
    """
    if not ffmpeg:
        return None
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", input_path,
             "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120)
    except Exception:
        return None

    text = (result.stderr or "") + (result.stdout or "")
    starts_at_zero = False
    onset = None
    for line in text.splitlines():
        pos = line.find("silence_start:")
        if pos >= 0:
            try:
                starts_at_zero = float(line[pos + len("silence_start:"):].split()[0]) <= 0.05
            except Exception:
                starts_at_zero = False
        pos = line.find("silence_end:")
        if pos >= 0 and onset is None:
            try:
                onset = float(line[pos + len("silence_end:"):].split("|")[0].split()[0])
            except Exception:
                onset = None

    if onset is None:
        return 0 if not starts_at_zero else None
    return int(round(onset * 1000))


def main():
    parser = argparse.ArgumentParser(description="Caption Wizard - offline speech to text")
    parser.add_argument("--input", help="media file to transcribe")
    parser.add_argument("--model", default=DEFAULT_MODEL, choices=MODEL_CHOICES)
    parser.add_argument("--language", default="auto", help="ISO code, or 'auto' to detect")
    parser.add_argument("--check", action="store_true", help="report the local environment and exit")
    parser.add_argument("--allow-download", action="store_true",
                        help="permit Hugging Face to download a model that is not cached")
    parser.add_argument("--vad", action="store_true",
                        help="enable silero VAD silence trimming (off by default; "
                             "an abandoned VAD generator can stall the model)")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"],
                        help="cpu (default, always available) or cuda for a working GPU setup")
    args = parser.parse_args()

    if args.check:
        return run_check()

    if not args.input:
        emit({"type": "result", "ok": False, "error": "No input file. Pass --input <media>."})
        return 1

    try:
        return run_transcribe(args)
    except Exception as exc:
        emit({"type": "result", "ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
