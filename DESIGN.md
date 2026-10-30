# Design

How Ghost Notetaker looks, and why. The note windows, the Notes Manager and Settings share one system; every value lives in `renderer/shared/tokens.css`.

The full, line-by-line specification of this look is the design system's SPEC v3 (palette "Damson", written for the v3 redesign by the design-system review; it is kept with the design reviews, not in this repository). This page is the short version. The earlier "Ember" direction (gradients, glass, glows, springs, coloured tiles) is retired.

## The product, briefly

Sticky notes that float over the desktop, can turn see-through or click-through, and stay out of screen shares. The Notes Manager is where you go back to them, for a few seconds at a time and often while sharing a screen. So the chrome stays quiet and the notes' own paper colours are the only colour that carries meaning.

## Principles

- **Corners** come from the radius tokens (`--r-0` 4px for marks and code, `--r-1` 6px, `--r-2` 8px, `--r-3` 12px, `--r-4` 16px) plus `--r-pill`; no literal radii in component CSS.
- **Flat, opaque surfaces.** Canvas, panel, surface, raised; one hairline (`--hairline`, plus `--hairline-strong` for control edges and fills; the search field and the off switch tracks use `--text-tertiary` so they reach 3:1). No gradients, no blur, no translucent glass, no glows.
- **Shadows only on true overlays.** Menus, dialogs, Quick find, the toast, the note's More panel and the save status use `--shadow-overlay`. Nothing else casts a shadow. On macOS the native window shadow is the note's only shadow; on Windows and Linux notes have none.
- **One accent, used rarely.** Damson (`--accent`, hue 348) for the primary button, the current item, focus and selection. Neutrals are plum-greys at hue 340, chroma 0.013 or less. Hover is a token swap or a 1px token ring, never a filter.
- **Paper is the content.** The twelve paper stocks (`--paper-*`) and their two inks (`--paper-ink*`, `--paper-ink-light*`) are fixed and shared by both themes. In dark mode, board cards on light papers are neutral and show their paper as a 3px edge, so the board does not glare; dark papers (slate, indigo, teal and the like) keep their own paper, since a dark edge on a dark surface would vanish.
- **A colour budget.** At most 48 distinct painted colours per theme, every one a token. No `color-mix()` or colour literals outside `tokens.css`, except the user's own paper transparency: the more-contrast note rules and edges are tokens (`--paper-ink-line-strong`, `--paper-ink-light-line-strong`, and `--paper-ink-edge-strong`, `--paper-ink-light-edge-strong` for the outer edge, at least 3:1 on every paper), and the scripts' fallback paper reads `--paper-mist`. Paper hexes also live in `main/store.js`, the source of the paper list that `tokens.css` mirrors.
- **Workspaces** get a neutral initial badge plus a 7px dot from a fixed colour-blind-safe set (`--ws-1`…`--ws-6`), assigned by workspace order and wrapping after six. There is no colour picker. The dot is decoration; the name is the label.
- **Brand.** A monochrome line ghost (`#i-logo`, `currentColor`) and a wordmark. The app icon is the line mark on a flat paper plate. The tray icon follows the taskbar (light or dark) and switches live when the taskbar theme changes.

## Type

| Role | Font | Used for |
| --- | --- | --- |
| UI and notes | Instrument Sans | Everything: controls, note titles, note text, settings |
| Display | Instrument Serif | View titles only ("Personal", "Settings", "Trash") |
| Mono | iA Writer Mono | Monospace notes and code |

All fonts are self-hosted in `renderer/fonts/`. Sizes are 12 / 13 / 14 / 16 / 20 / 28 px (`--fs-1`…`--fs-6`) and weights are 400 and 600. 12px is the floor: a note saved at 10 or 11px by an older version shows at 12px. The stored size is kept as it was (no migration, and later saves don't rewrite it); only the note window and its preview clamp. New sizes from the slider, Settings or a new note are 12 to 28. Markdown headings in a note follow the note's text size (h1 = text + 6px, h2 = text + 2px, so 20 and 16 at the default 14).

## Contrast

APCA: body text Lc 75 or more, 12px meta Lc 60 or more, in both themes and on every paper. WCAG AA 4.5:1 for text and 3:1 for non-text (range tracks, switch tracks, focus rings). Secondary 12px text uses `--text-secondary`; `--text-tertiary` is for non-text marks and large text. Increased contrast strengthens hairlines and inks. Forced colours keeps outlines.

## Motion

Motion is opacity or a 2px translate, 120 ms (`--t-fast`) or 160 ms (`--t-160`), with no overshoot. Nothing moves on hover, and nothing loops: the "on screen" dot is static. With Reduce motion on, every transition is cut to 0 ms, including the note's collapse into its bubble.

## Note window

The window is the paper: no transparent margin around it, so every pixel of the window is the note and nothing invisible eats clicks. The title is always visible. The control capsule (More, Hide) fades in on hover in the paper's own colour. The formatting bar sits inside the note's `main` landmark, after the text visually but before it in the tab order, so Shift+Tab from the text reaches it. At 220×180 (the smallest note) the formatting bar, the tags and the status all fit without covering the text. The formatted view clips a line cut by its bottom edge (`clip-path` on the inner `.preview-body`, 2px inside the view so its focus ring is never clipped or painted over, and see-through paper is unaffected), so a note never shows half a line above its tags.

## Rules

- Every interactive element has a hover, a press and a visible focus ring (`--focus`). Targets meet WCAG 2.5.8 (24px, or 24px of spacing).
- Headings do not skip levels: one h1 per view, card titles are h2. Card previews are `inert` and hidden from assistive technology; the card's title and buttons carry the meaning.
- Text fields, each as it is today:
  - **Search** (Notes Manager) rests on a 1px `--text-tertiary` edge (3:1 against the panel, the same token as the off switch tracks) and shows the `--focus` ring whenever it has focus; text fields match `:focus-visible` on a click as well as from the keyboard.
  - **Note title** has no edge at rest, an `--ink-hover` wash on hover, and a 1.5px `--ink-3` inset while focused (the paper's own ink, so it reads on every paper).
  - **Tag input** on a note has no edge of its own; while it has `:focus-visible` a 2px `--accent` ring is drawn around the add-tag pill that holds it.
  - **Rename** (a card title being edited in the Notes Manager) always shows the `--focus` ring, since it exists only while you are editing.
  - **Quick find** has no box: its field is the top row of the panel, divided from the results by a `--hairline` rule.
- Focus on open: the Notes Manager and existing notes open with nothing focused. A new note opens in editing mode with the cursor in its text, so you can type straight away.
- Tag pills on cards keep a 4.5em floor and a 62% cap so two fit; other pills (the active tag filter) show their tag in full.
- List previews join a note's lines with " · ", drop leading list, task and quote markers and paired emphasis markers, and keep words with hyphens or underscores whole.
- A dialog action that fails shows its error inside the dialog and moves focus to it (`tabindex="-1"`, `role="alert"`).
- Keep ids and roles stable: the end-to-end and acceptance tests drive the UI by them.

## Behaviour

- **First-line titles.** A note whose title is empty or only whitespace is named by its first line with words in it (Markdown removed, at most 60 characters); a typed title, even "Untitled", always wins.
- **Generic window title.** Every note window is titled "Ghost Note"; a note's title never reaches the OS window title, taskbar, window switchers, or screen shares. Screen readers get it from the note region's accessible name instead.
- **Bubble focus.** Collapsing a note from the keyboard moves focus to its bubble; expanding it returns focus to the text field that had it (title, text, or tag field), else to the note text or formatted note, never to nothing.
- **Trash focus.** After Restore or Delete forever, focus goes to the same button on the next row, else the previous row, else the Trash heading; never to the page.
- **Tag drafts.** Text typed in the tag field becomes a tag only on Enter or a comma; on Tab or blur it stays in the field unconverted and is saved with the note (`tagDraft`, not searched or exported), so it is never discarded unless cleared with Escape.
- **One-time "Untitled" upgrade.** Loading a store older than version 3 (or with no version) clears every title that is exactly "Untitled", the old default, so those notes follow their first line; this also clears a title someone typed as "Untitled" before the upgrade (accepted trade-off: old files cannot tell it from the default). The new version is saved at once, so it never runs again and a note titled "Untitled" afterwards is kept. Importing or restoring a backup older than version 3 (or with no version) runs the same one-time clearing on the imported notes; a current-version backup is imported as is.
