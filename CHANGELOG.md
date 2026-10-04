# Changelog

## [1.4.0] - 2026-10-04

The first published release. Versions 1.0 to 1.3 were never released as builds.

### Added

- Installers for macOS (Apple silicon and Intel, `.dmg` and `.zip`), Windows (x64 installer), and Linux (x64 AppImage and `.deb`). CI builds every installer, smoke-tests it, and publishes SHA-256 checksums.
- Linux support. The tray menu works through StatusNotifier, notes remember where they were moved or resized, and settings the OS can't honor are marked "Not available on Linux".
- Keyboard shortcut editor (**Notes Manager → Keyboard shortcuts**). You can change, clear, or reset each shortcut, and the editor shows whether the OS accepted it. A key combination that another action already uses is refused with a message naming that action.
- Appearance panel on each note (the **⋯** button) with color, opacity, text size, monospace, and New note.
- A **Turn off click-through** action in the Notes Manager. On Linux it is the way to make a click-through note clickable again.
- **Preferences → Show notes file**, which also shows the notes file's path.
- Warnings in the note and in the Notes Manager while the notes file can't be written. Saving is retried automatically.
- End-to-end tests that drive the real app with Playwright on macOS, Windows, and Linux, plus a smoke test for packaged builds.

### Fixed

- Text typed just before a note closed could be lost. This happened with the hide-all shortcut, when a note was closed by the OS (for example with Alt+F4), and with Hide or bulk hide in the Notes Manager. Notes now save before their window closes.
- At the default note width the controls overflowed: the opacity and text-size sliders shrank to a few pixels, and almost no area was left for dragging the note.
- On Linux, moved or resized notes did not keep their new position or size.
- In the Notes Manager, each card was about 300 px tall and the whole window scrolled, which pushed the toolbar and sidebar actions out of view. Disabled buttons looked clickable.
- **Export all** and **Export .md** gave no confirmation and failed silently. Rename, tag, and move ignored errors.
- The tray's **Preferences…** and **Keyboard Shortcuts…** items could open an empty Notes Manager when the window took more than 200 ms to load.
- Moving, resizing, opening, or restyling a note changed its "edited" time and its position in the sorted list.
- A note window could be navigated away from the note, for example by dropping a file onto it.
- **Export .md** used the raw title as the file name, so a slash in the title created folders. Exports and duplicates now save unsaved edits first.
- A notes file that couldn't be read because of permissions was treated as corrupt and moved aside. It is now reported and left as it is.
- An error during startup left a background process with no window or tray icon. The app now shows the error and exits.
- If unsaved changes couldn't be written at quit, the app stayed open and offered no way to quit. It now lets you keep it open or quit without those changes.
- Windows and macOS builds failed because the app icon was 128 px. The macOS menu-bar icon showed as a solid square.
- Markdown: ticking a task could change other brackets on the same line, formatting was applied inside `code spans`, and toolbar formatting couldn't be undone with Ctrl/⌘+Z.
- Giving two actions the same shortcut silently disabled one of them, and shortcuts that failed to register were not reported.

### Changed

- The screen-capture setting now applies to the Notes Manager as well as notes. Linux has no capture exclusion, so the setting is disabled there.
- **Launch at login** is disabled on Linux, where it had no effect.
- The Linux `.deb` and AppImage launchers start the app under XWayland (`--ozone-platform=x11`) so notes can stay on top and keep their position.
- Spellcheck is off on Linux, because Chromium would download its dictionaries from Google's servers. macOS and Windows keep the system spellchecker.
- The welcome note opens in Markdown preview and describes what the current OS supports.
- macOS builds are ad-hoc signed.

### Removed

- IPC handlers and helpers that nothing used.
