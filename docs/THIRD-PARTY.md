# Third-party material

Ghost Notetaker ships the files below inside the app. They are copied into the repository and loaded from disk; nothing is fetched at run time.

| What | Version | License | Files in the app | Source |
| --- | --- | --- | --- | --- |
| iA Writer Quattro V (variable, upright and italic) | 2.000 | SIL Open Font License 1.1 | `renderer/fonts/iAWriterQuattroV.ttf`, `renderer/fonts/iAWriterQuattroV-Italic.ttf` | [iaolo/iA-Fonts](https://github.com/iaolo/iA-Fonts), folder `iA Writer Quattro/Variable`, commit `c658867` |
| iA Writer Mono V (variable, upright and italic) | 2.000 | SIL Open Font License 1.1 | `renderer/fonts/iAWriterMonoV.ttf`, `renderer/fonts/iAWriterMonoV-Italic.ttf` | [iaolo/iA-Fonts](https://github.com/iaolo/iA-Fonts), folder `iA Writer Mono/Variable`, commit `c658867` |
| Lucide icons | 1.51.0 (`lucide-static`) | ISC; 10 of the icons are derived from Feather (MIT) | inlined as SVG `<symbol>` elements in `renderer/note/note.html` and `renderer/manager/manager.html` | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |

## Fonts

The iA Writer fonts are based on IBM Plex and are distributed unmodified, in the TrueType files iA publishes. Their license, with the copyright notices and the reserved font names "iA Writer" and "Plex", is in [`renderer/fonts/LICENSE.md`](../renderer/fonts/LICENSE.md), which is packaged with the app. Note text uses iA Writer Quattro; a note set to Monospace, and code in any note, uses iA Writer Mono.

## Icons

The license text, including the MIT notice for the Feather-derived icons, is in [`renderer/shared/LUCIDE-LICENSE.txt`](../renderer/shared/LUCIDE-LICENSE.txt), which is packaged with the app.

Lucide icons used (32): bold, check, chevron-down, code, copy, ellipsis, eye, eye-off, file-output, file-text, folder, folder-input, grip-vertical, heading-2, italic, keyboard, layout-grid, link, list, list-ordered, minus, pencil, plus, search, settings, square-check, strikethrough, table, tag, text-quote, trash-2, x. Of these, check, chevron-down, code, italic, link, minus, plus, search, trash-2, and x are derived from Feather.

The ghost mark (`i-ghost`, the app and tray icons in `build/`) and the filled reading-mode eye (`i-eye-on`) are drawn for Ghost Notetaker on the same 24-unit grid and stroke and are covered by the app's MIT license.
