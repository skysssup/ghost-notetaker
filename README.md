# Ghost Notetaker

Translucent sticky notes that float on top of everything but stay **invisible to screen sharing and recording** (Zoom, Meet, Teams, QuickTime, OBS, and the OS recorder).

Private and local — no accounts, no cloud sync of note content.

## Run

```bash
npm install
npm start
```

Lives in the **menu bar / system tray** (no Dock icon on macOS). Single-instance.

## Features

- Create / edit / hide / delete notes with frosted-glass chrome
- Color palette (12 tints), opacity & font-size sliders, monospace toggle
- Markdown toolbar (headings, bold/italic, lists, checklists, links, quotes)
- Interactive checklists in preview mode
- Inline tag chips on each note
- Workspaces: create / rename / delete / switch; move notes between them
- Notes Manager: fast search, sort, tag & visibility filters, bulk show/hide
- Preferences: default opacity/font/color, content protection, click-through, launch at login
- Tray menu with recent notes, workspaces, templates, and preferences
- Content protection (`setContentProtection`) so notes stay off screen share
- Click-through (ghost mode) with chrome hover to re-enable controls
- Templates: blank, meeting, demo talking points, todo, scratch, daily standup, decision log
- Global keyboard shortcuts + recovery shortcut when everything is hidden
- Export / import JSON backups; per-note Markdown export
- Multi-monitor aware (re-clamps when displays change)
- Persistence of position, size, content, tags, and preferences

## Shortcuts

| Action | Default |
| --- | --- |
| New note | `Cmd/Ctrl+Shift+N` |
| Notes Manager | `Cmd/Ctrl+Shift+M` |
| Hide / show all | `Cmd/Ctrl+Shift+H` |
| Click-through | `Cmd/Ctrl+Shift+G` |
| Markdown preview (focused note) | `Cmd/Ctrl+Shift+P` |
| Quick capture (clipboard) | `Cmd/Ctrl+Shift+Q` |
| Recovery new note (global) | `Cmd/Ctrl+Alt+Shift+N` |

Closing a note **hides** it. Permanent delete is only from the Notes Manager.

## Tests

```bash
npm test
```

## Platform notes

| Behavior | macOS | Windows |
| --- | --- | --- |
| Screen-capture exclusion | Generally reliable | Needs Windows 10 build 19041+ |
| Over fullscreen apps | Visible on all Spaces | Always-on-top only |
| Launch at login | Supported | Supported |

## License

MIT
