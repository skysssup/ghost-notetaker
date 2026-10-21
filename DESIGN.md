# Design

How Ghost Notetaker looks, and why: the note windows, the Notes Manager, and Settings share one system.

## The product, briefly

Ghost Notetaker is sticky notes that float over the desktop, can turn see-through or click-through, and stay out of screen shares. The Notes Manager is where you go back to them: find a note, file it in a workspace, put it on screen or take it off. People open it for a few seconds at a time, often while sharing a screen, so it should feel **fast, crafted, calm, and confident** — the polish of a paid Mac app, not a utility.

## References

Before this direction we screenshotted and studied Craft, Bear, Things, Raycast, Linear, and Reflect. What they share, and what we took:

- **Layered surfaces.** Craft and Linear put content on an inset panel that floats above a tinted canvas/sidebar, separated by a hairline and a soft shadow rather than a divider. We do the same; on macOS the sidebar is the window's vibrancy.
- **One confident brand color, tinted neutrals.** Raycast's red and Bear's red are used sparingly on a neutral base that is warm, not grey. Ours is *ember* (oklch 0.66 0.19 40) on stone neutrals (hue 60–70). No purple, no rainbow gradients.
- **Glossy, tactile controls.** Raycast's buttons have a 1px top highlight and a gradient; primary buttons, the selected settings item, switches, and menu highlights use the brand gradient with that highlight.
- **Color as wayfinding.** Things gives every sidebar item a colored icon; macOS System Settings gives every pane an icon tile. Workspaces get a colored initial badge, settings panes get colored tiles, tags get a counted `#` tile.
- **Content you can feel.** Craft's cards are vivid pastels with generous radius and soft, layered shadows. Our board cards are paper in richer pastels, radius 14, with a sheen and a contact shadow; they lift on hover with a spring and settle on press.
- **Keyboard first.** Raycast and Linear live in a command palette. **Quick find** (⌘K / Ctrl+K) searches notes across workspaces, switches workspaces, and runs commands.
- **Illustrated empty states.** An empty workspace shows two papers and the ghost floating beside them (a lens when a filter is on), not a sentence on a blank page.

## Direction: Ember

- **Brand mark.** The app icon is an ember-gradient squircle (#f88a3d → #ee5e23 → #cc3719) with a soft inner glow and a warm-white ghost. The same mark appears in the sidebar and in Quick find.
- **On screen = a ghost sticker.** A note that is on screen right now wears a small ember ghost badge on its corner and a breathing ember dot ("On screen"). You can see what is on your desktop at a glance.
- **Dark mode is its own material.** Board cards become tinted glass — the paper color mixed into a dark surface with a lit top edge — so the board keeps its color without glaring at night. Menus, Quick find, and the note appearance panel are blurred glass in both themes.
- **Settings like System Settings.** A rail of colored icon tiles, grouped rounded rows on a slightly darker panel, theme preview cards, and brand switches with a springy knob.
- **Note windows.** Paper with a top sheen and lit edge, a title that is always visible, and a glass capsule of controls that springs in on hover. Click-through shows the ghost button in ember so it is clear why clicks pass through. Switches, the selected swatch, and the text caret use the brand color.

## Type

| Role | Font | Used for |
| --- | --- | --- |
| UI and notes | Instrument Sans (variable 400–700) | Everything: controls, note titles, note text, settings |
| Display | Instrument Serif (regular) | Page titles ("Personal", "Settings", "Trash") and empty-state titles |
| Mono | iA Writer Mono | Monospace notes and code |

All are self-hosted WOFF2/TTF in `renderer/fonts/`; nothing is fetched at run time. **Why Instrument Sans:** a contemporary grotesk with slightly condensed, crisp letterforms and open apertures; it stays legible at 12–14 px on low-DPI Windows screens, has real italics for Markdown, and looks distinct from the Inter/system default every other app ships. **Why Instrument Serif:** a condensed editorial display serif that gives page titles a magazine-like voice at 30–36 px, the one place we allow personality in type. Scale: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 36 px.

## Tokens

All tokens are in `renderer/shared/tokens.css` and used by every window.

- **Brand:** `--brand`, `--brand-solid` (buttons, ~4.7:1 with white text), `--brand-gradient`, `--brand-wash`, `--focus`.
- **Surfaces, back to front:** `--canvas` (sidebar) → `--panel` (inset main panel) → `--surface` (groups, cards) → `--raised` (menus, dialogs) → `--glass` (blurred overlays). Dark mode raises each step by about 2–3% lightness instead of adding borders.
- **Lines:** `--hairline`, `--hairline-strong`; 1px top highlights use `--highlight`.
- **Radii:** 6 / 8 / 12 / 16 / pill. **Shadows:** `--shadow-control`, `-1`, `-2`, `-lift`, `-menu`, `-dialog`, `-note`.
- **Motion:** `--ease-out`, `--spring` (a slight overshoot), 120 / 200 / 260 ms.

## Motion

Cards rise in with a short stagger when the layout or the workspace changes; cards lift on hover and press in; menus, dialogs, and Quick find scale in with the spring; switches and swatches spring; the empty-state ghost bobs. With **Reduce motion** on, every animation and transition is cut to a single frame and nothing moves on hover.

## Rules

- One accent: ember. Everything else is stone neutrals or the note's own paper.
- Depth comes from surfaces and shadows, not from borders around everything.
- Every interactive element has a hover, a press, and a visible focus ring (`--focus`).
- Text meets WCAG AA on every paper and surface; increased contrast strengthens text and edges; reduced transparency makes glass solid; forced colors keeps outlines.
- Keep ids and roles stable: the end-to-end tests drive the UI by them.
