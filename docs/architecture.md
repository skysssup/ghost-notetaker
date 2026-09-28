# Architecture notes

Companion to [AGENTS.md](../AGENTS.md). High-level flow for Ghost Notetaker.

## Process model

```
┌─────────────────────────────────────────────────────────┐
│  Main process (Node / Electron)                         │
│  main.js · store.js · note-window · manager · tray …    │
│                                                         │
│  IPC handle/on  ←→  preload contextBridge               │
└────────────┬───────────────────────────┬────────────────┘
             │                           │
             ▼                           ▼
   ┌─────────────────┐         ┌──────────────────┐
   │ Note renderer   │  …n     │ Manager renderer │
   │ ghostNote API   │         │ ghostManager API │
   └─────────────────┘         └──────────────────┘
```

- **Main** owns persistence, window creation, tray, and OS integrations (`setContentProtection`, click-through, Dock hide).
- **Renderers** are untrusted UI surfaces: no Node, no direct `fs`. They talk only through preload APIs.
- **Store** is the single source of truth for notes/workspaces/settings; windows are views over that state.

## Content protection path

1. `noteWindowOptions()` builds a frameless transparent window.
2. After `new BrowserWindow`, `applyContentProtection(win)` runs immediately.
3. On `ready-to-show` (and on Windows `show`), protection is applied again.
4. Capture tools using OS screen APIs should omit the window; the user still sees it locally.

## Hide vs delete

| User action                                   | Result                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| Close button / hide shortcut / manager “Hide” | `visible: false`, window destroyed/hidden, note remains in JSON |
| Manager “Delete” (confirmed)                  | Note removed from store; window closed if open                  |

## Data location

| Platform | Typical `userData` (Electron)                    |
| -------- | ------------------------------------------------ |
| macOS    | `~/Library/Application Support/ghost-notetaker/` |
| Windows  | `%APPDATA%\ghost-notetaker\`                     |

File name: `ghost-notetaker-data.json`.

## Further reading

- [AGENTS.md](../AGENTS.md) — schema, IPC table, contributor invariants
- [CONTRIBUTING.md](../CONTRIBUTING.md) — setup and PR conventions
