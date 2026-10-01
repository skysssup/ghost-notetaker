# Ghost Notetaker

Overlay sticky notes for your desktop. Uses Electron `setContentProtection` as a **best-effort** way to keep notes out of screen capture — not a universal guarantee. Tray / menu-bar app. Notes live in a local JSON file. No account, no cloud sync.

Exclusion works more often on macOS. On Windows it needs a recent 10/11 build. Always verify against your Zoom / Meet / Teams / OBS / OS recorder; some apps and drivers still capture protected windows.

## Run

```bash
npm install
npm start
```

Single-instance. No Dock icon on macOS (`app.dock.hide()`).

## Shortcuts

| Action | Default |
| --- | --- |
| New note | `Cmd/Ctrl+Shift+N` |
| Notes Manager | `Cmd/Ctrl+Shift+M` |
| Hide / show all | `Cmd/Ctrl+Shift+H` |
| Click-through | `Cmd/Ctrl+Shift+G` |
| Markdown preview | `Cmd/Ctrl+Shift+P` |
| Quick capture (clipboard) | `Cmd/Ctrl+Shift+Q` |
| Recovery new note | `Cmd/Ctrl+Alt+Shift+N` |

Closing a note **hides** it. Permanent delete is only in the Notes Manager.

Workspaces, tags, markdown toolbar, templates, import/export, and prefs are in the tray menu / manager. Click-through (“ghost mode”) ignores mouse until you hover the chrome.

## Tests

```bash
npm test
```

## License

MIT
