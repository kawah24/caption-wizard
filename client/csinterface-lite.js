/**
 * Caption Wizard - minimal CEP bridge.
 *
 * Hand-written, deliberately tiny replacement for Adobe's CSInterface.js.
 * It only wraps the handful of CEP APIs this panel needs, so no third-party
 * file has to be bundled with the extension.
 *
 * Available APIs (all optional at runtime):
 *   window.__adobe_cep__.evalScript(script, callback)
 *   window.__adobe_cep__.getHostEnvironment()
 *   window.__adobe_cep__.getSystemPath(type)
 *   window.__adobe_cep__.getExtensionId()
 */
(function (root) {
  "use strict";

  function cep() {
    return (typeof root.__adobe_cep__ !== "undefined") ? root.__adobe_cep__ : null;
  }

  function CSInterfaceLite() {}

  /** True when the page is actually running inside a CEP host (After Effects). */
  CSInterfaceLite.prototype.isAvailable = function () {
    return !!cep();
  };

  /**
   * Run a script string on the host side (ExtendScript).
   * The callback receives the raw result string, or undefined when unavailable.
   */
  CSInterfaceLite.prototype.evalScript = function (script, callback) {
    var bridge = cep();
    var cb = (typeof callback === "function") ? callback : function () {};
    if (!bridge) {
      cb(undefined);
      return;
    }
    try {
      bridge.evalScript(String(script), cb);
    } catch (err) {
      cb(undefined);
    }
  };

  /** Parsed host environment, or null outside CEP. */
  CSInterfaceLite.prototype.getHostEnvironment = function () {
    var bridge = cep();
    if (!bridge) return null;
    try {
      return JSON.parse(bridge.getHostEnvironment());
    } catch (err) {
      return null;
    }
  };

  /** Absolute path for a CEP system path type (e.g. "extension", "userData"). */
  CSInterfaceLite.prototype.getSystemPath = function (type) {
    var bridge = cep();
    if (!bridge) return null;
    try {
      return bridge.getSystemPath(String(type));
    } catch (err) {
      return null;
    }
  };

  CSInterfaceLite.prototype.getExtensionId = function () {
    var bridge = cep();
    if (!bridge) return null;
    try {
      return bridge.getExtensionId();
    } catch (err) {
      return null;
    }
  };

  root.CSInterfaceLite = CSInterfaceLite;

  /**
   * Tolerance helper: CEP returns the host result already JSON-encoded, and a
   * host function that returns a JSON *string* therefore arrives double
   * encoded. Unwrap both shapes so every caller behaves the same way.
   */
  root.lcpUnwrapHostResult = function (raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "object") return raw;

    var text = String(raw);
    if (!text.length || text === "undefined" || text === "null") return null;

    var once;
    try {
      once = JSON.parse(text);
    } catch (err) {
      return text; // the host returned a bare string
    }
    if (typeof once === "string") {
      try {
        return JSON.parse(once);
      } catch (err2) {
        return once;
      }
    }
    return once;
  };
})(window);
