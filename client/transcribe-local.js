/**
 * Caption Wizard - offline transcription bridge.
 *
 * Launches tools/transcribe.py (local ffmpeg + faster-whisper) from the panel
 * and streams its newline-delimited JSON back to the UI. Everything runs on
 * this machine: no account, no API key, no upload.
 *
 * Node integration is required for this module to do anything. The panel
 * declares --enable-nodejs and --mixed-context so `require` exists in the
 * window scope; outside CEP this module reports itself unavailable instead of
 * throwing.
 */
(function (root) {
  "use strict";

  var nodeRequire = null;
  var hasNode = false;
  var nodeSource = "none";

  /**
   * Find a working Node bridge.
   *
   * Two different shapes exist in CEP:
   *   require          - the Node context merged into the window (--mixed-context)
   *   window.cep_node  - the separate Node context (--enable-nodejs alone)
   * Accepting both means a panel still works when only the second one is granted.
   *
   * Neither exists until the HOST is restarted: CEP applies the manifest's
   * CEFCommandLine flags when After Effects starts, not when a panel opens.
   */
  (function adoptNode() {
    try {
      if (typeof require === "function") {
        nodeRequire = require;
        hasNode = true;
        nodeSource = "window.require (mixed context)";
        return;
      }
    } catch (err) { /* keep looking */ }

    try {
      if (root.cep_node && typeof root.cep_node.require === "function") {
        nodeRequire = root.cep_node.require;
        hasNode = true;
        nodeSource = "window.cep_node.require";
        return;
      }
    } catch (err2) { /* not available either */ }
  })();

  var state = {
    lastCheck: null,
    running: false
  };

  function node() {
    return hasNode ? nodeRequire : null;
  }

  /** process.env from whichever context granted Node. */
  function nodeEnv() {
    try {
      if (typeof process !== "undefined" && process && process.env) return process.env;
    } catch (err) { /* ignore */ }
    try {
      if (root.cep_node && root.cep_node.process && root.cep_node.process.env) {
        return root.cep_node.process.env;
      }
    } catch (err2) { /* ignore */ }
    return {};
  }

  /** Human-readable description of what the Node bridge probe found. */
  function diagnostics() {
    var parts = [];
    var hasRequire = false;
    var hasCepNode = false;

    try { hasRequire = (typeof require === "function"); } catch (err) { hasRequire = false; }
    try { hasCepNode = !!(root.cep_node && typeof root.cep_node.require === "function"); } catch (err2) { hasCepNode = false; }

    parts.push("require: " + (hasRequire ? "yes" : "no"));
    parts.push("cep_node: " + (hasCepNode ? "yes" : "no"));
    parts.push("bridge: " + nodeSource);
    parts.push("script: " + (scriptPath() ? "found" : "missing"));
    return parts.join(", ");
  }

  /** Absolute path to tools/transcribe.py. */
  function scriptPath() {
    var req = node();
    if (!req) return null;

    var pathModule = req("path");
    var fsModule = req("fs");

    var candidates = [];

    try {
      if (typeof __dirname === "string") {
        candidates.push(pathModule.resolve(__dirname, "..", "tools", "transcribe.py"));
      }
    } catch (err) { /* __dirname is not guaranteed with mixed context */ }

    try {
      var here = decodeURI(window.location.pathname || "").replace(/^\//, "");
      here = here.replace(/\//g, pathModule.sep);
      candidates.push(pathModule.resolve(pathModule.dirname(here), "..", "tools", "transcribe.py"));
    } catch (err2) { /* ignore */ }

    for (var i = 0; i < candidates.length; i++) {
      try {
        if (fsModule.existsSync(candidates[i])) return candidates[i];
      } catch (err3) { /* ignore */ }
    }
    return candidates.length ? candidates[0] : null;
  }

  function pythonCandidates() {
    var list = [];
    var req = node();
    var pathModule = req ? req("path") : null;

    try {
      var override = window.localStorage.getItem("lcp.pythonPath");
      if (override) list.push(override);
    } catch (err) { /* localStorage may be unavailable */ }

    list.push("C:\\Program Files\\AutoClaw\\resources\\python\\python.exe");

    try {
      var fsModule = req("fs");
      var env = nodeEnv();
      var roots = [
        pathModule.join(env.LOCALAPPDATA || "", "Programs", "Python"),
        pathModule.join(env.ProgramFiles || "", "Python")
      ];
      for (var r = 0; r < roots.length; r++) {
        try {
          var entries = fsModule.readdirSync(roots[r]);
          for (var e = 0; e < entries.length; e++) {
            if (/^Python3/i.test(entries[e])) {
              list.push(pathModule.join(roots[r], entries[e], "python.exe"));
            }
          }
        } catch (inner) { /* folder may not exist */ }
      }
    } catch (err2) { /* ignore */ }

    list.push("python");
    list.push("python3");
    return list;
  }

  function spawnPython(interpreter, args, handlers) {
    var req = node();
    var childProcess = req("child_process");

    var child = childProcess.spawn(interpreter, args, {
      windowsHide: true,
      env: nodeEnv()
    });

    var stdout = "";
    var stderr = "";

    if (child.stdout) {
      child.stdout.on("data", function (chunk) {
        stdout += chunk.toString("utf8");
        if (handlers && handlers.onData) handlers.onData(stdout, stderr);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", function (chunk) { stderr += chunk.toString("utf8"); });
    }

    child.on("error", function (err) {
      if (handlers && handlers.onError) handlers.onError(err);
    });
    child.on("close", function (code) {
      if (handlers && handlers.onClose) handlers.onClose(code, stdout, stderr);
    });

    return child;
  }

  /** Parse every complete JSON line found so far. */
  function takeLines(buffer, onObject) {
    var lines = String(buffer).split(/\r?\n/);
    var remainder = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (!line.length) continue;
      try {
        onObject(JSON.parse(line));
      } catch (err) {
        // Non-JSON noise from a library import; keep it out of the way.
      }
    }
    return remainder;
  }

  /**
   * Verify a Python interpreter: it must run --check and report ok.
   * done({ok, python, fasterWhisper, ctranslate2, ffmpeg, models, error})
   */
  function checkInterpreter(interpreter, done) {
    var script = scriptPath();
    if (!script) {
      done({ ok: false, error: "tools/transcribe.py was not found next to the panel." });
      return;
    }

    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      done({ ok: false, error: "Timed out waiting for " + interpreter });
    }, 45000);

    spawnPython(interpreter, [script, "--check"], {
      onClose: function (code, stdout) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        var report = null;
        takeLines(stdout, function (obj) {
          if (obj && obj.type === "check") report = obj;
        });

        if (report && report.ok) {
          report.python = interpreter;
          done(report);
        } else {
          done({
            ok: false,
            error: (report && report.error) ? report.error : ("exit code " + code),
            python: interpreter
          });
        }
      },
      onError: function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done({ ok: false, error: String(err.message || err), python: interpreter });
      }
    });
  }

  /** Try each candidate until one reports a working environment. */
  function check(done) {
    var finish = typeof done === "function" ? done : function () {};

    if (!hasNode) {
      finish({
        ok: false,
        error: "Node integration is unavailable, so the panel cannot launch the local " +
               "transcriber. The manifest already declares --enable-nodejs and " +
               "--mixed-context; CEP only reads those flags when After Effects starts, " +
               "so fully quit and reopen After Effects. Probe: " + diagnostics() + "."
      });
      return;
    }

    var candidates = pythonCandidates();
    var attempts = [];

    function tryAt(index) {
      if (index >= candidates.length) {
        state.lastCheck = { ok: false, attempts: attempts };
        finish({
          ok: false,
          error: "No Python with faster_whisper was found.",
          attempts: attempts
        });
        return;
      }

      checkInterpreter(candidates[index], function (result) {
        attempts.push({ python: candidates[index], ok: !!result.ok, error: result.error || null });
        if (result.ok) {
          state.lastCheck = result;
          finish(result);
        } else {
          tryAt(index + 1);
        }
      });
    }

    tryAt(0);
  }

  /**
   * Start a transcription.
   * options: { python, input, model, language, allowDownload }
   * handlers: { onProgress(obj), onResult(obj), onLog(text) }
   * Returns { cancel() }.
   */
  function transcribe(options, handlers) {
    var hooks = handlers || {};
    var script = scriptPath();

    if (!hasNode) {
      hooks.onResult && hooks.onResult({ ok: false, error: "Node integration is unavailable." });
      return { cancel: function () {} };
    }
    if (!script) {
      hooks.onResult && hooks.onResult({ ok: false, error: "tools/transcribe.py was not found." });
      return { cancel: function () {} };
    }
    if (!options || !options.input) {
      hooks.onResult && hooks.onResult({ ok: false, error: "No audio file chosen." });
      return { cancel: function () {} };
    }

    var args = [
      script,
      "--input", options.input,
      "--model", options.model || "small",
      "--language", options.language || "auto"
    ];
    if (options.allowDownload) args.push("--allow-download");

    var finished = false;
    var pending = "";
    var child;

    state.running = true;

    function complete(result) {
      if (finished) return;
      finished = true;
      state.running = false;
      hooks.onResult && hooks.onResult(result);
    }

    child = spawnPython(options.python, args, {
      onData: function (stdout) {
        pending = takeLines(stdout, function (obj) {
          if (!obj || !obj.type) return;
          if (obj.type === "progress") {
            hooks.onProgress && hooks.onProgress(obj);
          } else if (obj.type === "result") {
            complete(obj);
          }
        });
      },
      onClose: function (code, stdout, stderr) {
        // Catch a result that arrived in the final flush.
        takeLines(stdout + "\n", function (obj) {
          if (obj && obj.type === "result") complete(obj);
        });
        complete({
          ok: false,
          error: code === 0
            ? "The transcriber stopped without returning a result."
            : ("The transcriber exited with code " + code + "." +
               (stderr ? " " + stderr.replace(/\s+/g, " ").slice(0, 300) : ""))
        });
      },
      onError: function (err) {
        complete({ ok: false, error: "Could not start " + options.python + ": " + (err.message || err) });
      }
    });

    return {
      cancel: function () {
        try {
          if (child && !finished) child.kill();
        } catch (err) { /* already gone */ }
        complete({ ok: false, error: "Cancelled." });
      }
    };
  }

  /** Whisper segments -> SRT text, so the existing transcript parser is reused. */
  function segmentsToSrt(segments) {
    var out = [];
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      out.push(String(i + 1));
      out.push(root.LcpTranscript.msToTime(segment.startMs) + " --> " + root.LcpTranscript.msToTime(segment.endMs));
      out.push(segment.text);
      out.push("");
    }
    return out.join("\n");
  }

  /** Whisper segments -> caption cues that already carry word timings. */
  function segmentsToCues(segments) {
    var cues = [];
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      cues.push({
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        words: segment.words || [],
        explicit: true
      });
    }
    return cues;
  }

  root.LcpAuto = {
    available: function () { return hasNode; },
    nodeSource: function () { return nodeSource; },
    diagnostics: diagnostics,
    scriptPath: scriptPath,
    pythonCandidates: pythonCandidates,
    check: check,
    transcribe: transcribe,
    segmentsToSrt: segmentsToSrt,
    segmentsToCues: segmentsToCues,
    state: state
  };

  // SRT text built from local file access is not needed here; the panel uses
  // the CEP file dialog exposed by csinterface-lite.
})(window);
