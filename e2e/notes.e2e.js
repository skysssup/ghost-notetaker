'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  launch,
  readStore,
  waitFor,
  waitForStore,
  firstNote,
  noteIdOf,
  noteWindow,
  openWindowIds,
  stubOpenExternal,
  modKey,
  startEditing
} = require('./helpers');

// A 2x2 PNG, as a screenshot pasted from the clipboard would arrive.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';

async function pasteFile(note, { base64, name, type }) {
  await note.evaluate(
    ({ base64: b64, name: fileName, type: mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], fileName, { type: mime }));
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      document.getElementById('editor').dispatchEvent(event);
    },
    { base64, name, type }
  );
}

const windowBounds = (app, id) =>
  app.evaluate(({ BrowserWindow }, noteId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`id=${noteId}`));
    return win ? win.getBounds() : null;
  }, id);

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

async function start(options) {
  const ctx = await launch(options);
  running.push(ctx.app);
  return ctx;
}

async function replaceEditorText(note, text) {
  await startEditing(note);
  await note.click('#editor');
  await note.keyboard.press(`${modKey}+A`);
  await note.keyboard.press('Delete');
  await note.keyboard.type(text);
}

describe('sticky notes', () => {
  it('first launch shows the welcome note formatted and creates the notes file', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    assert.equal(await note.inputValue('#title'), 'Ghost Notetaker');
    await note.waitForSelector('#preview:not(.hidden)');
    assert.equal(await note.isVisible('#editor'), false);
    assert.equal(await note.locator('#preview h1').textContent(), 'Welcome');
    assert.equal(await note.locator('#preview .task-check').count(), 3);
    const store = await waitForStore(dataFile, (s) => s.notes.length === 1, 'welcome note on disk');
    assert.equal(store.notes[0].visible, true);
    const welcome = store.notes[0].content;
    if (process.platform === 'linux') assert.match(welcome, /not available on Linux/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(dataFile).mode & 0o777, 0o600);
  });

  it('does not download spellcheck dictionaries on Linux', { skip: process.platform !== 'linux' }, async () => {
    const { app, userDataDir } = await start();
    const note = await firstNote(app);
    await startEditing(note);
    await note.click('#editor');
    await note.keyboard.type(' speling mistake');
    await new Promise((r) => setTimeout(r, 3000));
    const dir = path.join(userDataDir, 'Dictionaries');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepEqual(files.filter((f) => f.endsWith('.bdic')), []);
  });

  it('saves title, text, and tags to disk and restores them after a restart', async () => {
    const first = await start();
    let note = await firstNote(first.app);
    const id = noteIdOf(note);
    await note.click('#title');
    await note.keyboard.press(`${modKey}+A`);
    await note.keyboard.type('Sprint review prep');
    await replaceEditorText(note, '## Agenda\n- Demo the export flow');
    await note.click('#tagInput');
    await note.keyboard.type('demo');
    await note.keyboard.press('Enter');
    await waitForStore(
      first.dataFile,
      (s) => {
        const n = s.notes.find((x) => x.id === id);
        return n && n.title === 'Sprint review prep' && n.content.includes('export flow') && n.tags.includes('demo');
      },
      'edits on disk'
    );
    await first.app.close();
    running = [];

    const second = await start({ userDataDir: first.userDataDir });
    note = await noteWindow(second.app, id);
    assert.equal(await note.inputValue('#title'), 'Sprint review prep');
    assert.equal(await note.inputValue('#editor'), '## Agenda\n- Demo the export flow');
    assert.deepEqual(await note.locator('.tag-chip span:first-child').allTextContents(), ['#demo']);
  });

  it('keeps text typed just before the window is closed from the OS', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await replaceEditorText(note, 'typed right before closing');
    // Close immediately, inside the 160 ms save debounce, like Alt+F4 would.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('note.html')).close();
    });
    const store = await waitForStore(
      dataFile,
      (s) => s.notes.some((n) => n.id === id && !n.visible),
      'note hidden on disk'
    );
    assert.equal(store.notes.find((n) => n.id === id).content, 'typed right before closing');
    assert.deepEqual(await openWindowIds(app), []);
  });

  it('keeps typing that has not been saved yet when the app quits', async () => {
    const first = await start();
    const note = await firstNote(first.app);
    const id = noteIdOf(note);
    await replaceEditorText(note, 'written just before quitting');
    await first.app.close();
    running = [];
    const store = readStore(first.dataFile);
    assert.equal(store.notes.find((n) => n.id === id).content, 'written just before quitting');
  });

  it('ticking a task in the preview updates the Markdown source', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await replaceEditorText(note, '- [ ] alpha\n- [x] beta [ ] literal');
    await note.keyboard.press('Escape');
    await note.waitForSelector('#preview:not(.hidden)');
    const boxes = note.locator('#preview .task-check');
    assert.equal(await boxes.count(), 2);
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await waitForStore(
      dataFile,
      (s) => s.notes.find((n) => n.id === id)?.content === '- [x] alpha\n- [ ] beta [ ] literal',
      'toggled tasks on disk'
    );
  });

  it('opens preview links in the browser and never navigates the note window', async () => {
    const { app } = await start();
    await stubOpenExternal(app);
    const note = await firstNote(app);
    const url = note.url();
    await replaceEditorText(note, 'See [the docs](https://example.com/docs) and `[x](https://not-a-link)`');
    await note.keyboard.press('Escape');
    assert.equal(await note.locator('#preview code').textContent(), '[x](https://not-a-link)');
    await note.click('#preview a');
    await waitFor(async () => (await app.evaluate(() => globalThis.__opened)).length === 1, 'openExternal');
    assert.deepEqual(await app.evaluate(() => globalThis.__opened), ['https://example.com/docs']);

    await note.evaluate(() => {
      location.href = 'file:///etc/hosts';
    });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(note.url(), url);
    assert.equal(await note.locator('#editor').count(), 1);
  });

  it('toolbar formatting goes through the undo history', async () => {
    const { app } = await start();
    const note = await firstNote(app);
    await replaceEditorText(note, 'hello');
    await note.keyboard.press(`${modKey}+A`);
    await note.click('[data-md="bold"]');
    assert.equal(await note.inputValue('#editor'), '**hello**');
    await note.focus('#editor');
    await note.keyboard.press(`${modKey}+Z`);
    assert.equal(await note.inputValue('#editor'), 'hello');
  });

  it('appearance controls update the window and the saved note', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await note.click('#btnMore');
    await note.click('#palette [data-color="indigo"]');
    await waitFor(async () => note.evaluate(() => document.getElementById('shell').classList.contains('ink-light')), 'light text on a dark note');
    await note.click('#palette [aria-label="Mint"]');
    assert.equal(await note.evaluate(() => document.getElementById('shell').classList.contains('ink-light')), false);
    await note.locator('#fontSize').fill('18');
    await note.locator('#opacity').fill('60');
    await note.click('#btnMono');
    await note.click('#btnPin');
    const saved = await waitForStore(
      dataFile,
      (s) => {
        const n = s.notes.find((x) => x.id === id);
        return n && n.color === 'mint' && n.fontSize === 18 && n.opacity === 0.6 && n.monospace && !n.pinned;
      },
      'appearance on disk'
    );
    assert.ok(saved);
    assert.equal(await note.locator('#opacityValue').textContent(), '60%');
    assert.equal(await note.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize), '18px');
    const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop());
    assert.equal(onTop, false);
  });

  it('moving or resizing a note is saved without changing its edited time', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    const before = await waitForStore(dataFile, (s) => s.notes.length === 1, 'initial note');
    const editedAt = before.notes[0].updatedAt;
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 140, y: 150, width: 420, height: 360 });
    });
    const after = await waitForStore(
      dataFile,
      (s) => {
        const n = s.notes.find((x) => x.id === id);
        return n && n.bounds.width === 420 && n.bounds.height === 360;
      },
      'new bounds on disk'
    );
    assert.equal(after.notes[0].updatedAt, editedAt);
    assert.ok(note);
  });

  it('all controls fit when the note is at its minimum size', async () => {
    const { app } = await start();
    const note = await firstNote(app);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 220, height: 180 });
    });
    await waitFor(async () => (await note.evaluate(() => innerWidth)) === 220, 'resize');
    await note.click('#btnMore');
    const layout = await note.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      return {
        chrome: box('#chrome').right,
        buttons: box('.chrome-buttons').right,
        dragArea: box('.grip').width + box('.drag-spacer').width,
        title: box('#title').width,
        panelBottom: box('#morePanel').bottom,
        panelRight: box('#morePanel').right,
        height: innerHeight,
        width: innerWidth
      };
    });
    assert.ok(layout.buttons <= layout.chrome, `buttons overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.dragArea >= 24, `no drag area: ${JSON.stringify(layout)}`);
    assert.ok(layout.title >= 32, `title squeezed: ${JSON.stringify(layout)}`);
    assert.ok(layout.panelRight <= layout.width, `panel overflows: ${JSON.stringify(layout)}`);
    assert.ok(layout.panelBottom <= layout.height, `panel overflows: ${JSON.stringify(layout)}`);
  });
  it('clicking the formatted note edits at that line; leaving it shows the formatting again', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await replaceEditorText(note, '# Plan\n\nfirst point\n\nsecond point');
    await note.keyboard.press('Escape');
    await note.waitForSelector('#preview:not(.hidden)');
    assert.equal(await note.locator('#preview h1').textContent(), 'Plan');

    await note.locator('#preview p', { hasText: 'second point' }).click();
    await note.waitForSelector('#editor:not(.hidden)');
    const caret = await note.evaluate(() => {
      const ta = document.getElementById('editor');
      return { focused: document.activeElement === ta, at: ta.selectionStart, end: ta.value.length };
    });
    assert.deepEqual(caret, { focused: true, at: caret.end, end: caret.end });
    await note.keyboard.type('!');
    await waitForStore(dataFile, (s) => s.notes.find((n) => n.id === id)?.content.endsWith('second point!'), 'typed at the clicked line');

    // Reading mode keeps the formatted view even when the text is clicked.
    await note.keyboard.press('Escape');
    await note.click('#btnPreview');
    await note.locator('#preview p', { hasText: 'first point' }).click();
    assert.equal(await note.isVisible('#editor'), false);
    await waitForStore(dataFile, (s) => s.notes.find((n) => n.id === id)?.previewMode === true, 'reading mode on disk');
  });

  it('collapses to a bubble, stays a bubble after a restart, and expands to its old size', async () => {
    const first = await start();
    let note = await firstNote(first.app);
    const id = noteIdOf(note);
    const full = await windowBounds(first.app, id);
    await note.click('#btnCollapse');
    await waitFor(async () => (await windowBounds(first.app, id)).width < 100, 'bubble size');
    await note.waitForSelector('#bubble:not([hidden])');
    assert.equal(await note.isVisible('#shell'), false);
    await waitForStore(first.dataFile, (s) => s.notes[0]?.collapsed === true, 'collapsed on disk');
    await first.app.close();
    running = [];

    const second = await start({ userDataDir: first.userDataDir });
    note = await noteWindow(second.app, id);
    await note.waitForSelector('#bubble:not([hidden])');
    assert.ok((await windowBounds(second.app, id)).width < 100);
    await note.click('#bubble');
    await waitFor(async () => (await windowBounds(second.app, id)).width === full.width, 'expanded size');
    assert.equal((await windowBounds(second.app, id)).height, full.height);
    await note.waitForSelector('#shell', { state: 'visible' });
    await waitForStore(second.dataFile, (s) => s.notes[0]?.collapsed === false, 'expanded on disk');
  });

  it('a pasted image is stored beside the notes file and shown in the formatted note', async () => {
    const { app, dataFile, userDataDir } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await replaceEditorText(note, 'Screenshot:\n');
    await pasteFile(note, { base64: PNG_B64, name: 'board.png', type: 'image/png' });
    const store = await waitForStore(dataFile, (s) => /!\[board\]\(ghost-image:\/\/img\/[a-f0-9]{16}\.png\)/.test(s.notes.find((n) => n.id === id)?.content), 'image link on disk');
    const name = /img\/([a-f0-9]{16}\.png)/.exec(store.notes.find((n) => n.id === id).content)[1];
    assert.deepEqual(fs.readFileSync(path.join(userDataDir, 'images', name)), Buffer.from(PNG_B64, 'base64'));

    await note.keyboard.press('Escape');
    await note.waitForSelector('#preview img');
    await waitFor(async () => (await note.evaluate(() => document.querySelector('#preview img').naturalWidth)) === 2, 'image loaded');

    // A file that only claims to be an image is refused by the main process.
    await startEditing(note);
    await pasteFile(note, { base64: Buffer.from('not really a png at all').toString('base64'), name: 'fake.png', type: 'image/png' });
    await note.waitForSelector('#saveStatus:not([hidden])');
    assert.match(await note.locator('#saveStatus').textContent(), /Only PNG, JPEG, GIF, and WebP/);
    assert.equal(fs.readdirSync(path.join(userDataDir, 'images')).length, 1);
  });
  it('an image dropped on the formatted note is added where editing resumes', async () => {
    const { app, dataFile } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    await note.waitForSelector('#preview:not(.hidden)');
    await note.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      const target = document.getElementById('preview');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
      }
    }, PNG_B64);
    await waitForStore(dataFile, (s) => /!\[dropped\]\(ghost-image:\/\/img\/[a-f0-9]{16}\.png\)/.test(s.notes.find((n) => n.id === id)?.content), 'dropped image on disk');
    assert.equal(await note.isVisible('#editor'), true);
    assert.equal(note.url().includes('note.html'), true, 'a drop must not navigate the note window');
  });
});
