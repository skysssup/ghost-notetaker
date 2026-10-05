# Third-party material

Ghost Notetaker ships the files below inside the app. They are copied into the repository and loaded from disk; nothing is fetched at run time.

| What | Version | License | Files in the app | Source |
| --- | --- | --- | --- | --- |
| Inter (variable, upright and italic) | 4.1 | SIL Open Font License 1.1 | `renderer/fonts/InterVariable.woff2`, `renderer/fonts/InterVariable-Italic.woff2` | [rsms/inter](https://github.com/rsms/inter), release `v4.1`, folder `web` |
| iA Writer Mono V (variable, upright and italic) | 2.000 | SIL Open Font License 1.1 | `renderer/fonts/iAWriterMonoV.ttf`, `renderer/fonts/iAWriterMonoV-Italic.ttf` | [iaolo/iA-Fonts](https://github.com/iaolo/iA-Fonts), folder `iA Writer Mono/Variable`, commit `c658867` |
| Lucide icons | 1.51.0 (`lucide-static`) | ISC; 10 of the icons are derived from Feather (MIT) | inlined as SVG `<symbol>` elements in `renderer/note/note.html` and `renderer/manager/manager.html` | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |

## Fonts

Both fonts are distributed unmodified. The interface and note text use Inter; its license is in [`renderer/fonts/Inter-LICENSE.txt`](../renderer/fonts/Inter-LICENSE.txt). A note set to Monospace, and code in any note, uses iA Writer Mono, which is based on IBM Plex; its license, with the reserved font names "iA Writer" and "Plex", is in [`renderer/fonts/iAWriter-LICENSE.md`](../renderer/fonts/iAWriter-LICENSE.md). Both license files are packaged with the app.

## Icons

The license text, including the MIT notice for the Feather-derived icons, is in [`renderer/shared/LUCIDE-LICENSE.txt`](../renderer/shared/LUCIDE-LICENSE.txt), which is packaged with the app.

Lucide icons used (33): bold, check, chevron-down, code, copy, ellipsis, eye, eye-off, file-output, file-text, folder, folder-input, grip-vertical, heading-2, italic, keyboard, layout-grid, link, list, list-ordered, minus, pencil, plus, search, settings, square-check, sticky-note, strikethrough, table, tag, text-quote, trash-2, x. Of these, check, chevron-down, code, italic, link, minus, plus, search, trash-2, and x are derived from Feather.

The ghost mark (`i-ghost`, `i-logo`, and the app and tray icons in `build/`) and the filled reading-mode eye (`i-eye-on`) are drawn for Ghost Notetaker on the same 24-unit grid and are covered by the app's MIT license.
