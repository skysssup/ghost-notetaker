# Ghost Notetaker

**Sticky notes that stay invisible to screen sharing and recording.**

Translucent, always-on-top notes for your desktop — excluded from Zoom, Google Meet, Microsoft Teams, QuickTime, OBS, and native screen capture. Local-first tray app with workspaces, tags, markdown, and a frosted-glass UI.

Private. Offline. No accounts. No telemetry on note content.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#install--run)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)

## Screenshots

<!-- Drop PNGs into docs/assets/ and uncomment the links below. -->

| Notes Manager                                               | Sticky note                                           | Click-through                                                |
| ----------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| ![Manager placeholder](docs/assets/placeholder-manager.png) | ![Note placeholder](docs/assets/placeholder-note.png) | ![Ghost mode placeholder](docs/assets/placeholder-ghost.png) |

See [docs/assets/README.md](docs/assets/README.md) for recommended capture sizes and filenames.

## Features

- **Tray / menu-bar app** — lives in the menu bar (macOS) or system tray (Windows); Dock icon hidden on macOS
- **Invisible note windows** — frameless, transparent, always-on-top sticky notes protected with Electron `setContentProtection(true)`
- **Click-through (ghost mode)** — ignore mouse events per note or globally from the tray
- **Notes Manager** — search, filter by tag/workspace, open, hide, rename, delete, and create notes
- **Workspaces** — organize notes into named workspaces; switch anytime
- **Tags** — attach tags and filter in the manager
- **Markdown** — lightweight edit / preview toggle (headings, emphasis, lists, tasks, fenced code) with no heavy parser deps
- **Appearance** — per-note color, opacity, font size, and monospace
- **Pin / unpin** — keep notes above other windows when pinned
- **Hide ≠ delete** — closing a note hides it; permanent delete only from the manager with confirmation
- **Export / import** — full JSON backup; single-note Markdown export
- **Templates** — Blank, Meeting notes, Demo talking points, Todo list
- **Checklists** — `- [ ]` / `- [x]` items toggle in preview
- **Recovery shortcut** — global hotkey creates a note even when every window is hidden
- **Quick capture** — create a note prefilled from the clipboard
- **Multi-monitor aware** — notes clamp back on-screen if a display disconnects
- **Single-instance lock** — second launch focuses the Notes Manager

## How invisibility works

Each note is a frameless, transparent Electron `BrowserWindow`. Before the window is shown, the main process calls:

```js
win.setContentProtection(true);
```

The OS then excludes that window from screen-capture APIs while you still see it normally on your display. Content protection is re-applied after hide/show cycles on Windows.

| Behavior                 | macOS                     | Windows                          |
| ------------------------ | ------------------------- | -------------------------------- |
| Screen-capture exclusion | Generally reliable        | Requires Windows 10 build 19041+ |
| Over fullscreen apps     | Visible on all workspaces | Always-on-top only               |
| Dock / taskbar           | Dock hidden; tray present | Tray / notification area         |

## Install & run

**Requirements:** Node.js 18+ (20 LTS recommended), npm 9+

```bash
git clone https://github.com/skysssup/ghost-notetaker.git
cd ghost-notetaker
npm install
npm start
```

The app appears in the **menu bar / system tray**. On macOS the Dock icon is hidden.

### Tests

```bash
npm test
```

### Format (Prettier)

```bash
npm run format        # write
npm run format:check  # CI check
```

### Packaged builds

```bash
npm run dist        # current platform
npm run dist:mac    # macOS (.dmg + .zip)
npm run dist:win    # Windows (NSIS installer)
```

|              |                          |
| ------------ | ------------------------ |
| App id       | `com.ghostnotetaker.app` |
| Product name | Ghost Notetaker          |

## Keyboard shortcuts

| Action                     | Shortcut               | Scope                          |
| -------------------------- | ---------------------- | ------------------------------ |
| New note                   | `Cmd/Ctrl+Shift+N`     | Local (note / manager focused) |
| Recovery new note          | `Cmd/Ctrl+Alt+Shift+N` | **Global**                     |
| Notes Manager              | `Cmd/Ctrl+Shift+M`     | Local                          |
| Hide / show all notes      | `Cmd/Ctrl+Shift+H`     | Local                          |
| Toggle click-through (all) | `Cmd/Ctrl+Shift+G`     | Local                          |
| Toggle markdown preview    | `Cmd/Ctrl+Shift+P`     | Local                          |
| Quick capture              | `Cmd/Ctrl+Shift+Q`     | Local                          |

Local shortcuts stay inactive in other apps so they do not steal IDE or browser bindings. Use the three-modifier **recovery** shortcut when every Ghost Notetaker window is hidden.

## Privacy

- Notes live in a single JSON file under Electron `userData` (`ghost-notetaker-data.json`).
- No login, no cloud sync, no analytics on note content.
- Export backups are plain JSON — store them somewhere safe.
- Works fully offline after install.

## Project structure

```
ghost-notetaker/
├── main/                 # Electron main process
│   ├── main.js           # App lifecycle + IPC handlers
│   ├── store.js          # JSON persistence, workspaces, notes
│   ├── note-window.js    # Sticky note BrowserWindow controller
│   ├── manager-window.js # Notes Manager window
│   ├── shortcuts.js      # Local + global accelerators
│   ├── platform.js       # setContentProtection, click-through, Dock
│   ├── display.js        # Multi-monitor bounds helpers
│   └── tray.js           # Tray menu
├── renderer/
│   ├── note/             # Sticky note UI + markdown helper
│   └── manager/          # Notes Manager UI
├── build/                # App / tray icons
├── test/                 # node --test suites
├── docs/                 # Architecture notes + screenshot assets
└── package.json
```

For deeper contributor context (store schema, IPC conventions, invariants), see [AGENTS.md](./AGENTS.md) and [docs/architecture.md](./docs/architecture.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## Credits

- **UI/UX inspiration:** [Ghost Notes](https://github.com/navyabijoy/invisible-notes) by [Navya Bijoy](https://github.com/navyabijoy) — thank you for the concept of capture-invisible sticky notes.
- **Implementation:** original codebase for Ghost Notetaker (not a fork of Ghost Notes source).

## License

[MIT](./LICENSE) © Ghost Notetaker contributors

## Out of scope

This app is a personal notetaker / sticky-note overlay. It does **not** include screen or audio capture pipelines, AI interview helpers, cloud accounts, or any cheating tooling.
