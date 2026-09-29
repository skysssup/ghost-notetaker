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

- Create / edit / hide / delete notes
- Pin always-on-top, opacity, colors, font size, monospace
- Content protection (`setContentProtection`) so notes stay off screen share
- Click-through (ghost mode) with chrome hover to re-enable controls
- Workspaces, tags, search
- Markdown edit + preview (checkboxes toggle in preview)
- Templates: blank, meeting, demo talking points, todo, scratch
- Global keyboard shortcuts + recovery shortcut when everything is hidden
- Export / import JSON backups; per-note Markdown export
- Multi-monitor aware (re-clamps when displays change)
- Persistence of position, size, and content

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

## License

MIT
