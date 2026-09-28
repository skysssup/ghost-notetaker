# AGENTS.md — architecture guide for humans and AI contributors

Orientation document for Ghost Notetaker. Read this before changing main-process, IPC, or persistence code.

## Product invariants

These must remain true after every change:

1. **Content protection** — Every sticky note window and the Notes Manager must call `setContentProtection(true)` before the window is shown. On Windows, re-apply after hide/show (see `main/platform.js` → `applyContentProtection`, used from `note-window.js` / `manager-window.js`).
2. **Hide ≠ delete** — Closing a note window only sets `visible: false` and destroys the `BrowserWindow`. Permanent deletion is only via `notes:delete` from the manager (with user confirmation in the UI).
3. **Local-first privacy** — Note content never leaves the machine. Persistence is a single JSON file under Electron `userData`. No analytics on note bodies.
4. **No nodeIntegration** — Renderers use `contextIsolation: true` and a narrow `contextBridge` API from preload scripts.
5. **Out of scope** — No screen/audio capture pipelines, interview-AI helpers, or “cheating” tooling.

## Directory layout

```
main/                     Electron main process (Node)
  main.js                 App lifecycle, single-instance lock, IPC registration
  store.js                JSON store, migration, workspaces, notes, settings
  note-window.js          Map of open note BrowserWindows
  manager-window.js       Singleton Notes Manager window
  shortcuts.js            Local (focused window) + one global recovery accelerator
  platform.js             macOS/Windows helpers: Dock, always-on-top, protection, click-through
  display.js              Cursor-near bounds + clamp to available displays
  tray.js                 Tray icon + context menu

renderer/note/            Sticky note UI (HTML/CSS/JS) + markdown.js helper
renderer/manager/         Notes Manager UI
  */preload.js            contextBridge → ipcRenderer.invoke / on

build/                    Icons (app + tray)
test/                     node --test (no Electron required for current suites)
docs/                     Architecture notes + screenshot asset placeholders
```

## Store schema (`ghost-notetaker-data.json`)

Path: `path.join(app.getPath('userData'), 'ghost-notetaker-data.json')`

```jsonc
{
  "version": 1,
  "activeWorkspaceId": "ws_…",
  "workspaces": [{ "id": "ws_…", "name": "Personal", "createdAt": "ISO", "updatedAt": "ISO" }],
  "notes": [
    {
      "id": "note_…",
      "workspaceId": "ws_…",
      "title": "Untitled",
      "content": "",
      "tags": [],
      "color": "mist",
      "opacity": 0.88,
      "fontSize": 14,
      "monospace": false,
      "pinned": true,
      "clickThrough": false,
      "previewMode": false,
      "visible": true,
      "bounds": { "x": 120, "y": 120, "width": 340, "height": 280 },
      "displayId": null,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ],
  "settings": {
    "globalClickThrough": false,
    "shortcuts": {/* accelerators; see defaultShortcuts() */}
  }
}
```

- Writes are deferred (`saveDeferred`) and flushed on quit (`store.flush()`).
- `migrate()` normalizes unknown/partial payloads into a valid state.
- Colors: `NOTE_COLORS` in `store.js`. Templates: `TEMPLATES` (`blank`, `meeting`, `demo`, `todo`).

## IPC conventions

- Channels are `namespace:action` strings.
- Request/response uses `ipcMain.handle` ↔ `ipcRenderer.invoke`.
- Push events use `webContents.send` / `ipcRenderer.on` (e.g. `note:updated`, `manager:refresh`).
- Preloads expose curated APIs only:
  - Note UI → `window.ghostNote`
  - Manager UI → `window.ghostManager`

### Main handlers (representative)

| Channel                                       | Purpose                                                |
| --------------------------------------------- | ------------------------------------------------------ |
| `store:getBootstrap`                          | Colors, templates, settings, active workspace snapshot |
| `notes:list` / `notes:get` / `notes:tags`     | Query                                                  |
| `notes:create` / `notes:update`               | Mutate + open when creating                            |
| `notes:hide` / `notes:open` / `notes:delete`  | Visibility vs permanent delete                         |
| `notes:setClickThrough` / `notes:chromeHover` | Ghost mode + chrome hit-testing                        |
| `notes:exportMarkdown`                        | Single-note `.md` export dialog                        |
| `workspaces:*`                                | List / active / create / rename / delete               |
| `data:exportAll` / `data:importAll`           | Full JSON backup                                       |
| `settings:get` / `settings:update`            | App settings                                           |
| `shortcuts:list`                              | Definitions for the shortcuts panel                    |
| `app:quit`                                    | Quit                                                   |

When adding IPC: register in `main/main.js`, expose only what the relevant preload needs, and prefer returning plain JSON-serializable objects.

## Window lifecycle

- `NoteWindowController` owns `Map<noteId, BrowserWindow>`.
- `close` on a note is intercepted → hide + `visible: false`, not delete.
- Bounds persist on `moved` / `resized`; clamp when displays change.
- Opacity of the OS window stays at `1`; visual translucency comes from CSS + note `opacity` styling where applicable — do not confuse Electron `setOpacity` with note appearance fields without checking existing behavior.

## Shortcuts

- Most accelerators are **local**: attached via `before-input-event` on focused Ghost windows so they do not steal global IDE/browser bindings.
- **Only** `recoveryNewNote` (`CommandOrControl+Alt+Shift+N` by default) is registered with `globalShortcut`.

## Testing

```bash
npm test          # node --test under test/
npm run format:check
```

Prefer pure-logic tests (store, markdown) that do not launch Electron. If you add Electron integration tests, document how to run them and keep them out of the default `npm test` unless CI can support them.

## Packaging

`electron-builder` config lives under `package.json` → `"build"`. Outputs go to `dist/` (gitignored). App id: `com.ghostnotetaker.app`.

## Credits / provenance

UI/UX inspiration from Ghost Notes by Navya Bijoy. Application code in this repository is an original implementation — do not copy source from that project into this tree.
