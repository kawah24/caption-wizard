/**
 * Caption Wizard - settings controls.
 *
 * One place that turns a control definition plus a value into a DOM node.
 * Used by the CEP panel (client/main.js) and by the standalone browser preview
 * (preview/preview.js), so both render the identical UI.
 */
(function (root) {
  "use strict";

  /**
   * build(key, def, value, onChange) -> HTMLElement
   *
   * def.type is one of: font | select | range | toggle | color | text
   */
  function build(key, def, value, onChange) {
    var doc = document;
    var wrap = doc.createElement("div");
    wrap.className = "control";
    // Every row explains itself, from the help text in CONTROL_DEFS. Set here, before
    // the font control returns its own markup, so no control misses out.
    if (def.help) wrap.title = def.help;

    if (def.type === "font") {
      return root.LcpFonts.buildControl(key, def, value, onChange);
    }

    if (def.type === "toggle") {
      wrap.className += " control-toggle";
      var toggleLabel = doc.createElement("span");
      toggleLabel.className = "control-label";
      toggleLabel.textContent = def.label;

      var box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = !!value;
      box.onchange = function () { onChange(key, box.checked); };

      wrap.appendChild(toggleLabel);
      wrap.appendChild(box);
      return wrap;
    }

    var head = doc.createElement("div");
    head.className = "control-head";

    var name = doc.createElement("span");
    name.className = "control-label";
    name.textContent = def.label;
    head.appendChild(name);
    wrap.appendChild(head);

    var control;

    if (def.type === "select") {
      control = doc.createElement("select");
      for (var i = 0; i < def.options.length; i++) {
        // Options are either a plain string or { value, label } when the stored
        // value should differ from what the user reads.
        var entry = def.options[i];
        var option = doc.createElement("option");
        if (entry && typeof entry === "object") {
          option.value = String(entry.value);
          option.textContent = String(entry.label);
        } else {
          option.value = String(entry);
          option.textContent = String(entry);
        }
        control.appendChild(option);
      }
      control.value = String(value === undefined || value === null ? "" : value);
      control.onchange = function () { onChange(key, control.value); };
      wrap.appendChild(control);
      return wrap;
    }

    if (def.type === "color") {
      control = doc.createElement("input");
      control.type = "color";
      control.value = value || "#ffffff";
      control.oninput = function () { onChange(key, control.value); };
      wrap.appendChild(control);
      return wrap;
    }

    if (def.type === "text") {
      control = doc.createElement("input");
      control.type = "text";
      control.value = value || "";
      control.oninput = function () { onChange(key, control.value); };
      wrap.appendChild(control);
      return wrap;
    }

    // range
    control = doc.createElement("input");
    control.type = "range";
    control.min = String(def.min);
    control.max = String(def.max);
    control.step = String(def.step || 1);
    control.value = String(value);

    var readout = doc.createElement("span");
    readout.className = "control-value";
    readout.textContent = String(value) + (def.unit ? " " + def.unit : "");
    head.appendChild(readout);

    control.oninput = function () {
      readout.textContent = control.value + (def.unit ? " " + def.unit : "");
      onChange(key, parseFloat(control.value));
    };
    wrap.appendChild(control);
    return wrap;
  }

  /**
   * render(container, keys, defs, values, onChange, afterEach)
   * Replaces the container's contents with one control per key.
   */
  function render(container, keys, defs, values, onChange) {
    container.innerHTML = "";
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var def = defs[key];
      if (!def) continue;
      container.appendChild(build(key, def, values[key], onChange));
    }
  }

  root.LcpControls = {
    build: build,
    render: render
  };
})(window);
