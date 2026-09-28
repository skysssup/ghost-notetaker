# Contributing to Ghost Notetaker

Thanks for helping improve Ghost Notetaker. This guide covers setup, tests, style, and pull-request conventions.

## Code of Conduct

By participating you agree to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

**Requirements:** Node.js 18+ (20 LTS recommended), npm 9+

```bash
git clone https://github.com/skysssup/ghost-notetaker.git
cd ghost-notetaker
npm install
npm start
```

Useful scripts:

| Script                 | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `npm start`            | Launch Electron in development          |
| `npm test`             | Run `node --test` suites under `test/`  |
| `npm run format`       | Format with Prettier                    |
| `npm run format:check` | Verify formatting (used in CI)          |
| `npm run dist`         | Build a packaged app for the current OS |

## Architecture orientation

Read [AGENTS.md](./AGENTS.md) before large changes. In short:

- `main/` — Electron main process (store, windows, IPC, tray, shortcuts)
- `renderer/note/` — sticky note UI
- `renderer/manager/` — Notes Manager UI
- Preloads expose a narrow `contextBridge` API; do not enable `nodeIntegration`

### Invariants (do not break)

1. **Content protection** — every note (and the manager) must call `setContentProtection(true)` before show, and re-apply after hide/show on Windows.
2. **Hide ≠ delete** — closing a note window hides it (`visible: false`); permanent delete only via the manager with confirmation.
3. **Local-first** — no network calls for note content; persistence is local JSON only.

## Tests

```bash
npm test
```

Add or extend tests in `test/` for store helpers, migration, and markdown rendering. Keep suites runnable without launching Electron where possible (`node --test`).

CI runs `npm ci`, `npm test`, and `npm run format:check` on every push and pull request.

## Code style

- JavaScript (CommonJS) in main and renderer; `'use strict'` at the top of modules
- **2-space** indentation (see `.editorconfig` and `.prettierrc.json`)
- Prefer small modules over large monoliths
- IPC channel names use `namespace:action` (e.g. `notes:update`, `workspaces:list`)
- Run `npm run format` before opening a PR

## Commit messages (Conventional Commits)

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add workspace color accents
fix: re-apply content protection after Windows show
docs: expand AGENTS.md IPC table
test: cover import merge when note id collides
chore: bump electron-builder
refactor: extract clamp helpers from store
```

Scopes are optional (`feat(store): …`, `fix(note-window): …`).

## Pull requests

1. Fork (or branch) from `main`.
2. Keep PRs focused — one concern per PR when practical.
3. Ensure `npm test` and `npm run format:check` pass locally.
4. Fill out the pull-request template.
5. Link related issues.
6. Do not add interview-AI / screen-capture “cheating” features — they are explicitly out of scope.

## Reporting bugs / requesting features

Use the GitHub issue templates under `.github/ISSUE_TEMPLATE/`. For security issues, follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
