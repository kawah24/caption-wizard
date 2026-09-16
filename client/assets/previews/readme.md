# Your own preview media (optional)

The panel ships **no** media files — every style card animates with CSS.

If you want your own clips or stills on the cards, put them here named after
the style id:

| Style | File names it will pick up |
| --- | --- |
| Basic | `basic.webm` / `basic.mp4` / `basic.png` / `basic.jpg` |
| Slide Up | `slide-up.*` |
| Pop In | `pop-in.*` |
| Blur Fade | `blur-fade.*` |
| Word Punch | `word-punch.*` |
| Neon Outline | `neon.*` |

The panel probes in the order webm → mp4 → png → jpg and uses the first one
that actually loads. If none of them load, the card silently falls back to its
built-in CSS animation.

Use files you have the right to use. Nothing in this folder is bundled with the
extension — it is yours, and it stays on your machine.
