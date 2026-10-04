# Changelog

## [1.7.0] - 2026-10-04

### Changed

- **Redesigned interface.** Neutral chrome, one accent color, softer shadows, and rounded controls throughout the notes and the Notes Manager. The interface and note text use Inter, bundled with the app; monospace stays iA Writer Mono.
- **Notes** always show their title. Controls fade in on hover, tags are pills, the appearance panel has round swatches and new sliders and switches, and the paper colors are a little softer. Ids are unchanged.
- **Notes Manager.** Cleaner sidebar, search, and list; board cards lift on hover; selection shows as a bar above the list; settings are grouped; menus, dialogs, and the Undo message were restyled; empty views say what to do next.
- **Icons.** New app and tray icons.
- **README.** Shorter, with new videos and screenshots of everyday notes.

### Fixed

- In Settings, a switch or value could flip back for a moment when two settings were changed in quick succession.

## [1.6.1] - 2026-10-04

### Fixed

- Numbered lists on board cards in the Notes Manager showed their numbers cut off at the left edge of the card.

## [1.6.0] - 2026-10-04

### Changed

- **New look.** Notes are the only color. Each note is an opaque sheet of paper (the blur and sheen are gone), and the Notes Manager, menus, settings, and dialogs are near-monochrome and separated by hairlines instead of shadows. The interface uses the operating system's font. Note text uses iA Writer Quattro, and monospace notes and code use iA Writer Mono; both are bundled with the app. The icons come from one set (Lucide), and the ghost mark was redrawn on the same stroke.
- **Paper colors.** The twelve colors were retuned as a set: the nine light ones share about the same lightness, and so do the three dark ones. Their ids, and the notes that use them, are unchanged. Coral is now called Blush, and Midnight is now Night.
- **Opaque by default.** New installs create notes at 100% opacity. Existing notes and a saved default keep their opacity (**Settings → New notes → Opacity**). A note below 100% now shows what is behind it without blurring it.
- **Accent color.** Focus rings, selected notes, and links use the system accent color on macOS and Windows, and blue on Linux.
- **Note window.** The Markdown toolbar uses icons; on a note narrower than 320 px it shows the first six and puts the rest behind a ⋯ button. Tags are plain `#tag` text, and the add-tag field shows when you hover the note. The "click to edit" and "editing" label is gone. The appearance panel (⋯) follows the app's light or dark theme and has switches for Keep on top and Monospace. A bubble is a 56 px circle with the note's first letter. Collapsing a note to a bubble and opening it again are animated, and switching between the formatted view and the editor fades; both happen instantly when the system asks for reduced motion.
- **Note windows** extend 16 px past the paper (32 px below) so the paper's shadow is not cut off. Saved positions keep their meaning, so notes stay where they were. The exception is a note pushed right against the edge of the screen on macOS or Linux: those systems keep the whole window on screen, so the note moves in by up to 8 px (24 px at the bottom edge) the first time it opens. On macOS, note windows no longer use a translucent background or the system window shadow.
- **Notes Manager.** New installs open in the list view; a saved choice is kept. The board shows short and tall cards in columns, and a preview ends at the last paragraph, list item, or table row that fits. In the board, Up and Down move through a column and Left and Right move to the next one. Sort is a menu, and the layout and filter controls are segmented buttons. In the list, the strip above the notes names the columns and turns into the bulk actions while notes are selected. An active tag filter is shown under the workspace name with a **Show all** link.
- **Settings** is one page of sections instead of cards. The theme is chosen with System, Light, and Dark buttons, text size has a stepper, and each shortcut's **Works** setting is a menu.
- **Window chrome.** On macOS, the Notes Manager has inset traffic lights over a translucent sidebar. On Windows, the page draws the title bar under the system caption buttons, with the Mica backdrop on Windows 11. Linux keeps the window manager's title bar. The default size is 1120×720 and the minimum 820×520.
- **Welcome note.** Shorter, on Paper at 100% opacity.
- **App and tray icons.** A ghost outline on a sheet of Butter paper.
- **README.** One animation and four screenshots, made with sample data by the scripts in `scripts/demo/`.

### Fixed

- At a note's minimum size, the appearance panel (⋯) was wider than the note and its left edge was cut off.
- A long title in a note's top bar was cut off at a fixed width even when the note had room for it.

## [1.5.0] - 2026-10-04

### Added

- **Formatted view.** Notes show formatted Markdown whenever you are not typing in them. Click a line to edit the source with the caret on that line; click elsewhere or press `Esc` to see it formatted again. **Settings → Show formatted Markdown when not editing** turns this off.
- **More Markdown.** Tables with column alignment, nested lists, numbered lists that keep their start number, and images.
- **Images.** Paste a screenshot or drop a PNG, JPEG, GIF, or WebP file (up to 10 MB) onto a note. Images are stored in an `images` folder next to the notes file, are included in **Export all notes**, and are embedded when a note is exported as Markdown. Images on the web are never loaded.
- **Bubbles.** The **–** button shrinks a note to a small round bubble in the note's color with its initial. Drag the bubble anywhere and click it to open the note there. Bubbles stay bubbles after a restart.
- **Dark notes.** Three dark colors with light text: Deep teal, Midnight, and Graphite.
- **Trash.** Deleting a note moves it to the trash, with Undo in the message that appears. **Trash** in the Notes Manager restores notes or deletes them for good, and notes left there for 30 days are deleted. Deleting a workspace moves its notes to the trash instead of deleting them.
- **Daily backups.** The app copies the notes file into a `backups` folder once a day (checked at startup and every hour) and keeps the 10 newest copies. **Settings → Backups** makes a backup on demand and restores one; a restore saves the current notes as a backup first and can be undone.
- **Notes Manager redesign.** A board of cards in each note's color with a formatted preview, or a compact list. Light, dark, or system theme. A ⋯ menu and a right-click menu on every note for showing, hiding, renaming, tags, color, moving, duplicating, exporting, and the trash. Rename in place by double-clicking a title or pressing `F2`. Counts on the All, On screen, and Hidden filters. Keyboard control: `/` to search, arrow keys, `Enter`, `Space`, `F2`, `Delete`, and `Ctrl/⌘+N`.
- **Settings page.** Preferences and keyboard shortcuts moved from dialogs to one page in the Notes Manager with Appearance, New notes, Privacy, Shortcuts, Backups, Data, and About sections. Changes are saved as you make them.
- **Shortcut scope.** Each global shortcut can work **Everywhere** or only **In Ghost Notetaker** windows, which leaves the key combination free for other apps.
- **Talking points** template.
- Tests for all of the above: unit tests for the trash, backups, images, and Markdown; end-to-end tests that paste and drop images, collapse, drag, and reopen bubbles, use the trash and Undo, restore backups, switch themes and layouts, change shortcut scopes, and drive the Notes Manager from the keyboard. On Linux, X11 tests use real mouse input to drag bubbles and to check that a note shows its formatted view when another window is clicked. The packaged-app smoke test now also pastes an image and checks that it is shown.

### Changed

- New color palette. The light colors are softer, and the notes that used Teal, Indigo, or Slate become the new dark colors. New installs create notes in Butter (yellow) instead of Mist.
- The eye button turns reading mode on and off: a note in reading mode stays formatted even when you click it. The shortcut formerly called "Toggle Markdown preview" is now "Toggle reading mode".
- New notes open in the editor, ready for typing. The welcome note opens formatted and explains clicking to edit and bubbles.
- The tray menu's **Preferences…** item is now **Settings…**. Opening a note from the tray's recent notes expands it if it is a bubble.

### Fixed

- A note's shadow was cut off at the edge of its window, which drew a faint rectangle around notes, most visibly on dark backgrounds.

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
