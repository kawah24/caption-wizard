# Your own fonts (optional)

No font file is bundled with this extension — the panel uses system fonts only.

To use your own font:

1. Drop the file here, for example `MyFont.woff2`.
2. Add a matching `@font-face` block to `client/style.css`:

```css
@font-face {
  font-family: "MyFont";
  src: url("assets/fonts/MyFont.woff2") format("woff2");
  font-weight: normal;
}
```

3. Add the family name to the `fontFamily` options in
   `client/presets.js` → `CONTROL_DEFS.fontFamily.options`.

Note that fonts added this way style the **panel UI** and the CSS previews. The
text layers created in After Effects are set from the system font list in the
host script (`client/host.jsx` → `lcp_fontPostScript`), because After Effects
resolves fonts by PostScript name, not by a web font file.

Make sure you have the right to redistribute any font you add here.
