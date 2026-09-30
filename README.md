# Ghost Notetaker

Overlay sticky notes with Electron `setContentProtection` so they are often excluded from screen capture. Tray / menu-bar app. Notes live in a local JSON file. No account, no cloud sync.

Screen-share exclusion works more often on macOS. On Windows it needs a recent 10/11 build. Test against your Zoom / Meet / Teams / OBS / OS recorder — do not treat this as a guarantee for every app and driver.

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

Closing a note **hides** it. Permanent delete lives in the Notes Manager.

Workspaces, tags, markdown toolbar, templates, import/export, and prefs are in the tray menu / manager. Click-through (“ghost mode”) ignores mouse until you hover the chrome.

## Tests

```bash
npm test
```

## License

MIT
