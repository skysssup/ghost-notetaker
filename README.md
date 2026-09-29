# Ghost Notetaker

Translucent sticky notes that float on top of everything but stay **invisible to screen sharing and recording** (Zoom, Google Meet, Microsoft Teams, QuickTime, OBS, native screen recording).

Private. Local. No accounts. No telemetry on note content.

## How it works

Each note is a frameless, transparent Electron window with `setContentProtection(true)`. The OS excludes that window from screen capture while you still see it normally.

## Run

```bash
npm install
npm start
```

The app lives in the **menu bar / system tray** (no Dock icon on macOS).

## Usage

- **New note:** `Cmd/Ctrl+Shift+N` (tray → New Note)
- **Notes Manager:** `Cmd/Ctrl+Shift+M` — search, tags, workspaces, open/hide/rename/delete
- **Hide / show all:** `Cmd/Ctrl+Shift+H`
- **Click-through (ghost mode):** `Cmd/Ctrl+Shift+G` or the 👻 icon on a note
- **Recovery when everything is hidden:** `Cmd/Ctrl+Alt+Shift+N`
- Closing a note **hides** it; permanent delete is only from the Notes Manager

Notes auto-save locally (position, size, color, opacity, markdown content). Export/import JSON backups from the manager.

## Platform notes

| Behavior | macOS | Windows |
| --- | --- | --- |
| Screen-capture exclusion | Generally reliable | Needs Windows 10 build 19041+ |
| Over fullscreen apps | Visible on all Spaces | Always-on-top only |

## Tests

```bash
npm test
```

## License

MIT
