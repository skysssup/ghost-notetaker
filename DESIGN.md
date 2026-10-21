# Design

How the Notes Manager and Settings look, and why. Note windows keep their own look (Inter, the paper colors, the toolbar); this document covers the window that manages them.

## The product, briefly

Ghost Notetaker is sticky notes that float over the desktop, can turn see-through or click-through, and stay out of screen shares. The Notes Manager is where you go back to them: find a note, file it in a workspace, put it on screen or take it off. People open it for a few seconds at a time, often while sharing a screen, so it should be **tactile, quiet, discreet, and orderly**.

## Direction: a desk

The notes are paper, so the manager is the desk they live on.

- **Binder.** The sidebar is a cloth binder in the deep teal of the app's ghost mark. The active workspace is a folder tab: it takes the desk's color and joins the desk with curved inner corners, so the page you are reading is visibly the one that is open.
- **Blotter.** The main area is a soft green-grey desk blotter. Paper sits on it; nothing else needs a card.
- **Paper.** Notes are drawn as paper in their own colors, at rest with a short contact shadow. Dark papers (Charcoal, Ink) are drawn dark with light ink.
- **Signature: taped up.** A note that is on screen right now is taped to the desk — a strip of washi tape with torn ends across its top edge and a slightly lifted shadow. You can tell what is on your screen from across the room, without a badge.
- **Highlighter.** Search hits are marked with a yellow highlighter stroke, in titles and in snippets.
- **Paper chips.** The color filter is a row of tiny paper squares with a folded corner, one per paper color, rather than generic dots.

## Type

| Role | Font | Use |
| --- | --- | --- |
| Labels | Young Serif (regular) | The wordmark, page titles, section labels in the binder, dialog titles, empty-state titles |
| UI | Libre Franklin (variable) | Everything else: note titles and previews, controls, meta, settings |
| Code | iA Writer Mono (shared with note windows) | Code in previews, key caps where useful |

Both are self-hosted WOFF2 (latin and latin-ext) in `renderer/fonts/`; nothing is fetched at run time. Young Serif is a soft, ink-trap-free display serif that reads like the label on a file folder; Libre Franklin is a sturdy American gothic that stays legible at 12–13 px on low-DPI Windows screens.

Scale: 1.2 ratio from a 13 px base — `--fs-cap` 11.5, `--fs-sm` 12, `--fs-base` 13, `--fs-md` 15.5, `--fs-lg` 18.5, `--fs-xl` 22.5, `--fs-2xl` 27.

## Tokens

All tokens live in [`renderer/manager/tokens.css`](renderer/manager/tokens.css), in OKLCH, loaded after the shared tokens. The rest of the manager CSS uses only these names.

- **Surfaces:** `--desk`, `--desk-deep`, `--surface` (inputs, settings panels), `--binder`, `--binder-raised`.
- **Ink:** `--ink`, `--ink-2`, `--ink-3` on the desk; `--binder-ink`, `--binder-muted` on the binder. Rules and washes are ink at low alpha (`--rule`, `--rule-strong`, `--wash`, `--wash-strong`), so they work on any paper.
- **Accent:** `--accent` is the binder teal (light) or a pale sage (dark). It is used for the primary button, the selected state, and focus. There is one accent. The OS accent color is not used in the manager.
- **Signals:** `--marker` (highlighter), `--danger`, `--tape`.
- **Space:** 4 px steps, `--s1`…`--s7` (4, 8, 12, 16, 24, 32, 48).
- **Radii:** `--r-paper` 7 px for paper and panels, `--r-ctl` 5 px for controls, `--r-pill` for counts and chips.
- **Shadow:** one family — `--paper-rest` and `--paper-lift`. Menus and dialogs use `--paper-lift`. No blur or glass.
- **Motion:** `--t-quick` 110 ms, `--t-move` 180 ms, one ease-out curve. Everything is off under `prefers-reduced-motion`.

Contrast (WCAG 2): body ink on the desk is 12.8:1 light / 13.9:1 dark; the faintest meta text (`--ink-3`) is 5.0:1 / 6.7:1; muted binder text is 5.9:1 / 8.3:1. `prefers-contrast: more` darkens rules and ink further, and `forced-colors` falls back to system colors with visible outlines.

## Rules

- **Focus** is a 2 px ring in `--focus` with a 2 px offset; on the binder it switches to `--focus-on-binder`, a legal-pad yellow that reads on teal. Paper cards get the ring outside their edge so it never sits on the paper color.
- **Selection** is a checkbox and a wash in the list, and an ink outline around the paper on the board — never a recolored paper. The selection bar takes the binder's color so it reads as part of the furniture.
- **Empty, loading and error states are real:** a dashed taped-up paper outline with a title, a sentence that says what to do, and a button (New note, or Clear filters); a skeleton of paper shapes while the list loads; an inline error with Retry if the list cannot be read.
- **Icons** are Lucide at 1.5 stroke, 16 px, in `currentColor`. No emoji.
- **Responsive:** the board flows from one to four columns of paper; under 1000 px the sidebar narrows from 228 to 200 px, the list drops its tag column, and the settings rail tightens; the window's minimum width is 820 px.
- **Dark theme** is the same desk at night: a dark green-black blotter, near-black binder, and the papers dimmed but still recognizable.

## What we avoided

Checked against the frontend-design de-slop list: no Inter in the manager, no indigo/violet focus rings or purple gradients, no frosted-glass blur, no emoji icons, no card-in-card, no Notion-style blank white page. The automated scan of `manager.html` reports only "no focus styles", which is a false positive — the focus styles are in the linked stylesheets.
