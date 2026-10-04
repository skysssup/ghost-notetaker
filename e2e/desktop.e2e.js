'use strict';

// Tests that need real X11 input (global hotkeys, window dragging, input
// pass-through). They send events with xdotool, so they only run on Linux/X11
// when xdotool is installed.

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  launch,
  waitFor,
  waitForStore,
  firstNote,
  noteIdOf,
  openManager,
  openWindowIds,
  hasXdotool,
  xdotool,
  focusEditorEnd
} = require('./helpers');

const skip = !hasXdotool() && 'needs Linux/X11 with xdotool';

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

async function start() {
  const ctx = await launch();
  running.push(ctx.app);
  ctx.note = await firstNote(ctx.app);
  ctx.id = noteIdOf(ctx.note);
  await waitForStore(ctx.dataFile, (s) => s.notes.length === 1, 'welcome note on disk');
  return ctx;
}

function noteBounds(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('note.html'))
      .getBounds()
  );
}

async function placeNote(app, bounds) {
  await app.evaluate(({ BrowserWindow }, b) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('note.html'))
      .setBounds(b);
  }, bounds);
  await waitFor(async () => (await noteBounds(app)).x === bounds.x, 'note placed');
}

describe('desktop integration (X11)', { skip }, () => {
  it('the hide-all hotkey saves typing before it hides the notes', async () => {
    const ctx = await start();
    await focusEditorEnd(ctx.note);
    await ctx.note.keyboard.type('saved by the hotkey');
    xdotool('key', '--clearmodifiers', 'ctrl+shift+h');
    const store = await waitForStore(ctx.dataFile, (s) => s.notes[0]?.visible === false, 'hidden on disk');
    assert.match(store.notes[0].content, /saved by the hotkey/);
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 0, 'window hidden');

    xdotool('key', '--clearmodifiers', 'ctrl+shift+h');
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 1, 'shown again');
  });

  it('dragging the top bar moves the note and the position is saved', async () => {
    const ctx = await start();
    await placeNote(ctx.app, { x: 300, y: 200, width: 360, height: 300 });
    const b = await noteBounds(ctx.app);
    const sx = b.x + 8 + 3 + 7;
    const sy = b.y + 8 + 18;
    xdotool('mousemove', sx, sy, 'sleep', '0.3', 'mousedown', '1', 'sleep', '0.2',
      'mousemove', sx + 40, sy + 30, 'sleep', '0.2', 'mousemove', sx + 160, sy + 120, 'sleep', '0.3', 'mouseup', '1');
    const moved = await waitFor(async () => {
      const now = await noteBounds(ctx.app);
      return now.x >= b.x + 80 && now.y >= b.y + 60 ? now : null;
    }, 'window moved by the drag');
    // The window manager settles the final position; what is on disk must match it.
    await waitForStore(
      ctx.dataFile,
      (s) => s.notes[0]?.bounds.x === moved.x && s.notes[0]?.bounds.y === moved.y,
      'moved bounds on disk'
    );
  });

  it('click-through lets clicks fall through until it is turned off in the manager', async () => {
    const ctx = await start();
    await placeNote(ctx.app, { x: 40, y: 60, width: 340, height: 300 });
    const manager = await openManager(ctx.app);
    await ctx.note.evaluate(() => {
      window.__downs = 0;
      document.addEventListener('mousedown', () => {
        window.__downs += 1;
      }, true);
    });
    const b = await noteBounds(ctx.app);
    const clickNoteBody = () => xdotool('mousemove', b.x + 170, b.y + 200, 'sleep', '0.2', 'click', '1');

    clickNoteBody();
    await waitFor(async () => (await ctx.note.evaluate(() => window.__downs)) === 1, 'normal click');

    await ctx.note.click('#btnGhost');
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.clickThrough === true, 'click-through on');
    await new Promise((r) => setTimeout(r, 300));
    const downs = await ctx.note.evaluate(() => window.__downs);
    clickNoteBody();
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await ctx.note.evaluate(() => window.__downs), downs, 'click should pass through the note');

    await manager.locator('.note-card button', { hasText: 'Turn off click-through' }).click();
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.clickThrough === false, 'click-through off');
    await new Promise((r) => setTimeout(r, 300));
    clickNoteBody();
    await waitFor(async () => (await ctx.note.evaluate(() => window.__downs)) === downs + 1, 'clicks reach the note again');
  });

  it('recording a shortcut receives keys that are bound globally', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.click('#btnShortcuts');
    await manager.waitForSelector('.shortcut-table tbody tr');
    const newNoteRow = manager.locator('.shortcut-table tbody tr', {
      has: manager.locator('td:first-child', { hasText: /^New note$/ })
    });
    await newNoteRow.getByRole('button', { name: /Change shortcut/ }).click();
    await manager.waitForSelector('.kbd.recording');
    await manager.bringToFront();
    // Ctrl+Shift+M normally toggles the manager system-wide; while recording it
    // must arrive in the dialog (and be rejected as a duplicate) instead.
    xdotool('key', '--clearmodifiers', 'ctrl+shift+m');
    await manager.waitForSelector('.field-hint.error', { timeout: 5000 });
    assert.match(await manager.locator('.field-hint.error').textContent(), /already used for "Open \/ hide Notes Manager"/);
    assert.equal(await manager.isVisible('#modal'), true);
    const store = await waitForStore(ctx.dataFile, () => true);
    assert.equal(store.settings.shortcuts.newNote, 'CommandOrControl+Shift+N');

    // Global shortcuts are active again after recording.
    const before = (await openWindowIds(ctx.app)).length;
    xdotool('key', '--clearmodifiers', 'ctrl+shift+n');
    await waitFor(async () => (await openWindowIds(ctx.app)).length === before + 1, 'hotkey works again');
  });
});
