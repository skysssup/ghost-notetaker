# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial public repository polish: README, contributing guide, code of conduct, security policy, agents guide, GitHub issue/PR templates, and CI workflow
- Prettier formatting and EditorConfig for consistent 2-space JavaScript style

## [0.1.0] - 2026-09-29

### Added

- Tray / menu-bar Electron app with frameless sticky notes
- Screen-capture invisibility via `BrowserWindow.setContentProtection(true)`
- Click-through (ghost) mode per note and globally
- Notes Manager with search, tags, and workspaces
- Markdown edit/preview with checklists and a small built-in renderer
- Per-note appearance (color, opacity, font size, monospace)
- Hide-on-close (hide ≠ delete); permanent delete from the manager
- JSON export/import and single-note Markdown export
- Note templates (Blank, Meeting, Demo talking points, Todo)
- Local keyboard shortcuts plus a global recovery hotkey
- Quick capture from clipboard
- Multi-monitor bounds clamping and single-instance lock
- Unit tests for store persistence/migration and markdown helpers (`npm test`)

[Unreleased]: https://github.com/skysssup/ghost-notetaker/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/skysssup/ghost-notetaker/releases/tag/v0.1.0
