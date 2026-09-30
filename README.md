# Ghost Notetaker

Sticky notes that sit on top of everything and stay **off screen shares** — Zoom, Meet, Teams, QuickTime, OBS, the OS recorder. Tray / menu-bar app. Notes are a local JSON file. No account, no sync.

## Run

```bash
npm install
npm start
```

Single-instance. No Dock icon on macOS.

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

Workspaces, tags, markdown toolbar, templates, import/export, and prefs are in the tray menu / manager. Content protection uses Electron `setContentProtection`. Click-through (“ghost mode”) ignores mouse until you hover the chrome.

## Tests

```bash
npm test
```

Screen-share exclusion is usually solid on macOS; Windows needs 10 build 19041+.

## License

MIT
