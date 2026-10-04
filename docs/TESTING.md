# What is tested

This page lists Ghost Notetaker's features, how each one is checked, and the result for version 1.6.0. "CI" means the GitHub Actions workflow in `.github/workflows/build.yml`. It runs on Ubuntu 24.04, Windows Server 2025, macOS 15 on Apple silicon, and macOS 15 on Intel.

## Test suites

| Suite | Command | What it runs against |
| --- | --- | --- |
| Unit tests | `npm test` | Storage, trash, backups, images, IPC input validation, shortcut parsing, Markdown, and the save queue, run in plain Node |
| End-to-end tests | `npm run test:e2e` | The real app started with Playwright: main process, note and manager windows, and the files on disk |
| Packaged smoke test | `npm run smoke:packaged [executable]` | An installed or unpacked build: formatted welcome note, typing saved to disk, a pasted image stored and shown, a second launch opening the Notes Manager with formatted previews, clean quit, and on macOS and Windows the screen-capture flag on every window |

The end-to-end tests replace three things: the native file pickers, the external browser, and the message box shown when the notes file is unreadable at startup. Everything else, including the notes file, images, and backups on disk, is real. CI also installs and launches the real artifacts: the Windows installer (silent install, smoke test, uninstall), the macOS `.dmg` and `.zip` (signature check, then the smoke test), and the Linux AppImage and `.deb`.

Playwright normally reports every page as focused. Tests that depend on real focus changes (a note going back to its formatted view when another window is clicked) turn that off and run on Linux with real X11 input.

## Features

| Feature | Expected behavior | How it is checked | Result |
| --- | --- | --- | --- |
| First launch | A formatted welcome note appears; the notes file is created and readable only by the user | E2E `first launch shows the welcome note formatted…` | Pass, CI on all four OSes. File permissions are checked on macOS and Linux only |
| Editing and persistence | Title, text, and tags are saved and come back after a restart | E2E `saves title, text, and tags…` | Pass, CI on all four |
| Formatted view | Clicking a line edits it with the caret on that line; `Esc` shows the formatting again; reading mode keeps it formatted; the setting turns it off | E2E `clicking the formatted note edits at that line…` and `turning off the formatted view…` | Pass, CI on all four |
| Formatting when focus leaves | Clicking another window shows the note formatted again | X11 E2E with a real click on another window | Pass on Linux. Not run on macOS or Windows |
| No lost typing | Text typed just before a note closes (OS close, Hide, bulk hide, hide-all hotkey, quit) is saved | E2E: OS close, quit, manager Hide, bulk hide; X11 hotkey test on Linux | Pass. Hotkey case on Linux only |
| Disk errors | While writes fail, the note and the Notes Manager show a warning, the text stays in memory, and saving resumes on its own | E2E `reports failed disk writes…` and a unit test | Pass on Linux and macOS. Skipped on Windows, where folder permissions can't be removed this way |
| Unreadable notes file | Unparseable: moved aside, then the user chooses an empty notebook or Quit. Unreadable (permissions): error shown, file left alone | E2E, three tests, plus unit tests | Pass. The permission case is skipped on Windows |
| Quit with unsavable changes | The app asks whether to keep running or quit without the changes | E2E `asks before quitting…` | Pass on Linux and macOS. Skipped on Windows |
| Markdown | Renders the documented subset, including tables, nested and numbered lists, and stored images; raw HTML is escaped; only `http`/`https` links; ticking a checkbox edits the source; links open in the browser | Unit tests plus E2E | Pass, CI on all four |
| Images | Pasting or dropping an image stores it in `images/` and shows it; files that are not PNG, JPEG, GIF, or WebP, or over 10 MB, are refused; unused images are removed but not while a note, the trash, or a backup refers to them | E2E (paste, drop, refused file) and unit tests | Pass, CI on all four. The packaged smoke test also pastes an image |
| Bubbles | Collapse, stay collapsed after a restart, expand to the previous size; dragging moves the bubble and it opens where it was dropped | E2E; X11 test with a real mouse drag | Pass, CI on all four. The real drag is tested on Linux only |
| Navigation lock | A note window can't be navigated to another page | E2E (`location.href` set to a file URL) | Pass, CI on all four |
| Formatting toolbar | Toolbar edits can be undone with Ctrl/⌘+Z | E2E | Pass, CI on all four |
| Appearance | Color (dark colors switch to light text), opacity, text size, monospace, and pin are applied and saved | E2E | Pass, CI on all four |
| Window position | Moving or resizing is saved without changing the "edited" time | E2E (programmatic move) and X11 drag test | Pass. A real mouse drag is tested on Linux only |
| Small windows | At the 220×180 minimum size every control fits and a drag area remains | E2E | Pass, CI on all four |
| Notes Manager | Templates, search, tag filter, empty states, rename in place, tags, color, duplicate, move, export; board and list views remembered | E2E | Pass, CI on all four |
| Keyboard in the Notes Manager | Arrow keys move between notes, `F2` renames, `Delete` trashes, `Enter` opens, `/` searches, `Ctrl/⌘+N` makes a note | E2E | Pass, CI on all four |
| Trash | Move to trash with Undo (the note reopens if it was on screen), restore, delete forever after confirming, empty the trash, 30-day purge, trash kept through export and import | E2E and unit tests | Pass, CI on all four |
| Workspaces | Create, switch, rename, and delete; deleting a workspace moves its notes to the trash and closes their windows | E2E | Pass, CI on all four |
| Bulk show and hide | Selected notes open and close | E2E | Pass, CI on all four |
| Click-through | Clicks pass through the note; the Notes Manager can turn it off | X11 E2E with real clicks; E2E for the manager action | Pass. Real pass-through tested on Linux only |
| Backups | Daily backup at startup; Back up now; restore replaces the notes and can be undone; at most 10 kept; backup names can't point outside the folder | E2E and unit tests | Pass, CI on all four |
| Export and import | Export all writes a private JSON file with images; merge and replace imports; invalid files are rejected without changes; Markdown export uses a safe file name and embeds images | E2E (file pickers replaced) and unit tests | Pass, CI on all four |
| Keyboard shortcuts | List with status; record a new binding; duplicates refused; clear; reset; Escape cancels; global hotkeys paused while recording; limiting a shortcut to Ghost Notetaker unregisters it globally | E2E; X11 test with real key events | Pass. The real-key tests run on Linux only |
| Settings | Defaults for new notes are applied; options the OS doesn't support are disabled; the theme switches between light and dark | E2E | Pass, CI on all four |
| Screen-capture flag | Notes and the Notes Manager report `isContentProtected()` as on by default, and off after it is turned off | E2E and the packaged smoke test | Pass on macOS (both) and Windows. On Linux the option is disabled |
| No spellcheck download | A new Linux profile downloads no dictionary | E2E | Pass on Linux |
| No network requests | The app opens no network connection by itself | `strace -f -e trace=network` on the packaged Linux build for 20 seconds from a new profile (welcome note, Notes Manager not opened): only local sockets (X11, D-Bus) and netlink; Chromium opened five IPv6 UDP sockets to probe for IPv6 and sent nothing on them | Pass on Linux (1.6.0). Fonts and icons are files inside the app |
| Second launch | Starting the app again opens the Notes Manager in the running instance | Packaged smoke test | Pass on all four, using the installed builds |
| Tray menu | The menu opens; **Settings…** and **Keyboard Shortcuts…** open the matching part of the Notes Manager | Real clicks on the tray icon in an Xfce StatusNotifier panel on Linux (1.5.0 build); every item was checked by hand for 1.4.0 | Pass on Linux. Not checked on macOS or Windows |
| Packaging | Installers build; Windows installs and uninstalls silently; the macOS app passes `codesign --verify`; the Linux `.deb` installs with an XWayland launcher | CI | Pass |
| Reduced motion | With the system's reduce-motion setting, collapsing to a bubble and switching between the formatted view and the editor happen instantly | Script on Linux with Playwright's `reducedMotion: 'reduce'` emulation: animation durations resolve to 0 ms and a collapse takes 57 ms instead of 292 ms | Pass on Linux (1.6.0) |
| Visual checks | Text contrast meets WCAG: body text at least 4.5:1 and secondary text at least 3:1 on the canvas, sidebar, and surface colors in both themes; note text at least 7:1 on all twelve papers; no light-theme color left on a dark surface | A script reads the computed text and background colors of every visible text node in the running app: the Notes Manager list, board, menu, trash, settings, a dialog, and the toast in both themes, and a note on each paper. Lowest results: body text 4.5:1 or more everywhere, secondary and tertiary text (counts, timestamps, labels) 3.0:1 or more, note text 9.1:1 or more, and tags and other secondary note text 3.7:1 or more. Every screen was also screenshotted in both themes and checked by eye | Pass on Linux (1.6.0) |

## Not verified

- Whether real screen-sharing or recording apps (Zoom, Teams, Meet, OBS, QuickTime, Snipping Tool) actually hide the notes. CI only checks that the protection flag is set.
- First launch of a downloaded build, which goes through macOS Gatekeeper and Windows SmartScreen. CI builds the artifacts on the runner, so they are never quarantined.
- Physical Mac and Windows machines, multiple monitors, and HiDPI scaling on Windows. The screenshots and videos were made on Linux at 2× scale.
- How notes, bubbles, and the Notes Manager look on macOS and Windows: the transparent margin and shadow around notes, the inset traffic lights and translucent sidebar on macOS, the caption buttons and Mica backdrop on Windows, and the system accent color were checked on Linux only (where none of the platform chrome applies) or not at all.
- Wayland sessions, GNOME's tray, and the macOS menu-bar icon as it appears on screen.
- Launch at login on macOS and Windows. Tests don't change the runners' login items.
