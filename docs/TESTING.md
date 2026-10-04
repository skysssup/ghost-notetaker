# What is tested

This page lists Ghost Notetaker's features, how each one is checked, and the result for version 1.4.0. "CI" means the GitHub Actions workflow in `.github/workflows/build.yml`. It runs on Ubuntu 24.04, Windows Server 2025, macOS 15 on Apple silicon, and macOS 15 on Intel.

## Test suites

| Suite | Command | What it runs against |
| --- | --- | --- |
| Unit tests | `npm test` | Storage, IPC input validation, shortcut parsing, Markdown, and the save queue, run in plain Node |
| End-to-end tests | `npm run test:e2e` | The real app started with Playwright: main process, note and manager windows, and the JSON file on disk |
| Packaged smoke test | `npm run smoke:packaged [executable]` | An installed or unpacked build: welcome note, typing saved to disk, a second launch opening the Notes Manager, clean quit, and on macOS and Windows the screen-capture flag on every window |

The end-to-end tests replace three things: the native file pickers, the external browser, and the message box shown when the notes file is unreadable at startup. Everything else, including the notes file on disk, is real. CI also installs and launches the real artifacts: the Windows installer (silent install, smoke test, uninstall), the macOS `.dmg` and `.zip` (signature check, then the smoke test), and the Linux AppImage and `.deb`.

## Features

| Feature | Expected behavior | How it is checked | Result |
| --- | --- | --- | --- |
| First launch | A welcome note appears in Markdown preview; the notes file is created and readable only by the user | E2E `first launch shows a welcome note…` | Pass, CI on all four OSes. File permissions are checked on macOS and Linux only |
| Editing and persistence | Title, text, and tags are saved and come back after a restart | E2E `saves title, text, and tags…` | Pass, CI on all four |
| No lost typing | Text typed just before a note closes (OS close, Hide, bulk hide, hide-all hotkey, quit) is saved | E2E: OS close, quit, manager Hide, bulk hide; X11 hotkey test on Linux | Pass. Hotkey case on Linux only |
| Disk errors | While writes fail, the note and the Notes Manager show a warning, the text stays in memory, and saving resumes on its own | E2E `reports failed disk writes…` and a unit test | Pass on Linux and macOS. Skipped on Windows, where folder permissions can't be removed this way |
| Unreadable notes file | Unparseable: moved aside, then the user chooses an empty notebook or Quit. Unreadable (permissions): error shown, file left alone | E2E, three tests, plus unit tests | Pass. The permission case is skipped on Windows |
| Quit with unsavable changes | The app asks whether to keep running or quit without the changes | E2E `asks before quitting…` | Pass on Linux and macOS. Skipped on Windows |
| Markdown preview | Renders the documented subset; ticking a checkbox edits the source; links open in the browser; code spans stay literal | E2E plus unit tests | Pass, CI on all four |
| Navigation lock | A note window can't be navigated to another page | E2E (`location.href` set to a file URL) | Pass, CI on all four |
| Formatting toolbar | Toolbar edits can be undone with Ctrl/⌘+Z | E2E | Pass, CI on all four |
| Appearance | Color, opacity, text size, monospace, and pin are applied and saved | E2E | Pass, CI on all four |
| Window position | Moving or resizing is saved without changing the "edited" time | E2E (programmatic move) and X11 drag test | Pass. A real mouse drag is tested on Linux only |
| Small windows | At the 220×180 minimum size every control fits and a drag area remains | E2E | Pass, CI on all four |
| Notes Manager | Templates, search, tag filter, empty states, rename, tags, duplicate, move, delete | E2E | Pass, CI on all four |
| Workspaces | Create, switch, rename, and delete; deleting a workspace removes its notes and closes their windows | E2E | Pass, CI on all four |
| Bulk show and hide | Selected notes open and close | E2E | Pass, CI on all four |
| Click-through | Clicks pass through the note; the Notes Manager can turn it off | X11 E2E with real clicks; E2E for the manager action | Pass. Real pass-through tested on Linux only |
| Backups | Export all writes a private JSON file; merge and replace imports; invalid files are rejected without changes; Markdown export uses a safe file name | E2E (file pickers replaced) | Pass, CI on all four |
| Keyboard shortcuts | List with status; record a new binding; duplicates refused; clear; reset; Escape cancels; global hotkeys paused while recording | E2E; X11 test with real key events | Pass. The real-key tests run on Linux only |
| Preferences | Defaults for new notes are applied; options the OS doesn't support are disabled | E2E | Pass, CI on all four |
| Screen-capture flag | Notes and the Notes Manager report `isContentProtected()` as on by default, and off after it is turned off | E2E and the packaged smoke test | Pass on macOS (both) and Windows. On Linux the option is disabled |
| No spellcheck download | A new Linux profile downloads no dictionary | E2E; `strace` showed no network connections at startup | Pass on Linux |
| Second launch | Starting the app again opens the Notes Manager in the running instance | Packaged smoke test | Pass on all four, using the installed builds |
| Tray menu | Every menu item works | Manual check on Linux with an Xfce StatusNotifier panel | Pass on Linux. Not checked on macOS or Windows |
| Packaging | Installers build; Windows installs and uninstalls silently; the macOS app passes `codesign --verify`; the Linux `.deb` installs with an XWayland launcher | CI | Pass |

## Not verified

- Whether real screen-sharing or recording apps (Zoom, Teams, Meet, OBS, QuickTime, Snipping Tool) actually hide the notes. CI only checks that the protection flag is set.
- First launch of a downloaded build, which goes through macOS Gatekeeper and Windows SmartScreen. CI builds the artifacts on the runner, so they are never quarantined.
- Physical Mac and Windows machines, multiple monitors, and HiDPI scaling on Windows.
- Wayland sessions, GNOME's tray, and the macOS menu-bar icon as it appears on screen.
- Launch at login on macOS and Windows. Tests don't change the runners' login items.
