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

// The title the OS shows for a note's window (taskbar, switchers, screen-share pickers).
const osWindowTitle = (app, id) =>
  app.evaluate(({ BrowserWindow }, noteId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`id=${noteId}`));
    return win ? win.getTitle() : null;
  }, id);

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
    assert.deepEqual(await note.locator('.tag').allTextContents(), ['#demo']);
  });

  it('a note without a title of its own is named by its first line everywhere', async () => {
    const first = await start();
    const note = await firstNote(first.app);
    const id = noteIdOf(note);
    await note.click('#title');
    await note.keyboard.press(`${modKey}+A`);
    await note.keyboard.press('Delete');
    await replaceEditorText(note, '## Groceries\n- [ ] milk');
    const store = await waitForStore(first.dataFile, (s) => s.notes.find((n) => n.id === id)?.title === 'Groceries', 'derived title on disk');
    assert.equal(store.notes.find((n) => n.id === id).autoTitle, true);
    // The title box, the bubble, and the note region's accessible name follow the text.
    await waitFor(async () => (await note.inputValue('#title')) === 'Groceries', 'title box shows the derived title');
    assert.equal(await note.getAttribute('#bubble', 'aria-label'), 'Expand Groceries');
    assert.equal(await note.getAttribute('#noteRegion', 'aria-label'), 'Note: Groceries');
    // A typed title wins over the text from then on.
    await note.click('#title');
    await note.keyboard.press(`${modKey}+A`);
    await note.keyboard.type('Shopping');
    await note.click('#editor');
    await note.keyboard.press(`${modKey}+End`);
    await note.keyboard.type('\n- [ ] eggs');
    await waitForStore(
      first.dataFile,
      (s) => {
        const n = s.notes.find((x) => x.id === id);
        return n && n.title === 'Shopping' && n.autoTitle === false && n.content.includes('eggs');
      },
      'typed title kept'
    );
    assert.equal(await note.inputValue('#title'), 'Shopping');
    await waitFor(
      async () => (await note.getAttribute('#noteRegion', 'aria-label')) === 'Note: Shopping',
      'accessible name follows the typed title'
    );
  });

  it('the OS window title stays generic after a note gets a title', async () => {
    const first = await start();
    const note = await firstNote(first.app);
    const id = noteIdOf(note);
    assert.equal(await osWindowTitle(first.app, id), 'Ghost Note');
    // A derived title...
    await note.click('#title');
    await note.keyboard.press(`${modKey}+A`);
    await note.keyboard.press('Delete');
    await replaceEditorText(note, 'Salary negotiation notes');
    await waitForStore(first.dataFile, (s) => s.notes.find((n) => n.id === id)?.title === 'Salary negotiation notes', 'derived title on disk');
    await waitFor(
      async () => (await note.getAttribute('#noteRegion', 'aria-label')) === 'Note: Salary negotiation notes',
      'renderer saw the derived title'
    );
    assert.equal(await osWindowTitle(first.app, id), 'Ghost Note');
    // ...a typed title...
    await note.click('#title');
    await note.keyboard.press(`${modKey}+A`);
    await note.keyboard.type('Private: doctor');
    await waitForStore(first.dataFile, (s) => s.notes.find((n) => n.id === id)?.title === 'Private: doctor', 'typed title on disk');
    assert.equal(await osWindowTitle(first.app, id), 'Ghost Note');
    assert.equal(await note.title(), 'Ghost Note');
    // ...and even a page that tries to rename itself never reaches the OS title.
    await note.evaluate(() => {
      document.title = 'Private: doctor';
    });
    await note.waitForTimeout(200);
    assert.equal(await osWindowTitle(first.app, id), 'Ghost Note');
  });

  it('tags are added with Enter or a comma, never by tabbing away, and the field shows keyboard focus', async () => {
    const first = await start();
    const note = await firstNote(first.app);
    const id = noteIdOf(note);
    const tagsOnDisk = () => (readStore(first.dataFile)?.notes.find((n) => n.id === id)?.tags || []).join(' ');
    const before = tagsOnDisk();
    await note.focus('#tagInput');
    const ring = await note.evaluate(() => {
      const pill = document.getElementById('tagInput').closest('.tag-add');
      const style = getComputedStyle(pill);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;
    });
    assert.equal(ring, true, 'focused tag field has a visible focus ring');
    await note.keyboard.type('draft');
    await note.keyboard.press('Tab');
    assert.notEqual(await note.evaluate(() => document.activeElement.id), 'tagInput', 'Tab moves focus on');
    await note.waitForTimeout(600);
    assert.deepEqual(await note.locator('.tag').allTextContents(), before ? before.split(' ').map((t) => `#${t}`) : []);
    assert.equal(tagsOnDisk(), before, 'Tab does not add a tag');
    // The typed text is still there to add on purpose.
    assert.equal(await note.inputValue('#tagInput'), 'draft');
    await note.focus('#tagInput');
    await note.keyboard.press('Enter');
    await note.keyboard.type('#Second,');
    await waitForStore(first.dataFile, (s) => {
      const tags = s.notes.find((n) => n.id === id)?.tags || [];
      return tags.includes('draft') && tags.includes('second');
    }, 'tags added with Enter and comma');
    assert.equal(await note.inputValue('#tagInput'), '');
    // Escape clears a draft without adding it.
    await note.keyboard.type('nope');
    await note.keyboard.press('Escape');
    assert.equal(await note.inputValue('#tagInput'), '');
  });

  it('a tag typed but not added is never thrown away, even after a restart', async () => {
    const first = await start();
    const note = await firstNote(first.app);
    const id = noteIdOf(note);
    const tagsBefore = (await waitForStore(first.dataFile, (s) => s.notes.some((n) => n.id === id), 'note on disk')).notes.find(
      (n) => n.id === id
    ).tags;
    await note.focus('#tagInput');
    await note.keyboard.type('half-typed');
    // Leave the field by clicking away: the text stays, unconverted.
    await note.click('#title');
    assert.equal(await note.inputValue('#tagInput'), 'half-typed');
    const saved = await waitForStore(
      first.dataFile,
      (s) => s.notes.find((n) => n.id === id)?.tagDraft === 'half-typed',
      'tag draft on disk'
    );
    assert.deepEqual(saved.notes.find((n) => n.id === id).tags, tagsBefore, 'the draft is not added as a tag');
    await first.app.close();
    running = running.filter((a) => a !== first.app);

    const second = await start({ userDataDir: first.userDataDir });
    const again = await firstNote(second.app);
    assert.equal(noteIdOf(again), id);
    await waitFor(async () => (await again.inputValue('#tagInput')) === 'half-typed', 'draft back in the tag field');
    assert.equal(await again.locator('.tag').count(), tagsBefore.length);
    // Adding it on purpose clears the saved draft.
    await again.focus('#tagInput');
    await again.keyboard.press('Enter');
    const after = await waitForStore(
      second.dataFile,
      (s) => s.notes.find((n) => n.id === id)?.tags.includes('half-typed'),
      'draft added as a tag'
    );
    assert.equal(after.notes.find((n) => n.id === id).tagDraft, '');
    assert.equal(await again.inputValue('#tagInput'), '');
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

  it('the formatting toolbar is one Tab stop, moved through with the arrow keys', async () => {
    const { app } = await start();
    const note = await firstNote(app);
    await startEditing(note);
    await note.click('#editor');
    const toolbar = note.getByRole('toolbar', { name: 'Markdown toolbar' });
    assert.equal(await toolbar.count(), 1);
    const focusedLabel = () => note.evaluate(() => document.activeElement.getAttribute('aria-label'));
    const stops = () => note.locator('#mdToolbar button[tabindex="0"]').count();
    assert.equal(await stops(), 1);
    // The toolbar sits above the text, so Shift+Tab from the text enters it, at its first button.
    await note.keyboard.press('Shift+Tab');
    assert.equal(await focusedLabel(), 'Heading', 'Shift+Tab from the text enters the toolbar');
    await note.keyboard.press('ArrowRight');
    assert.equal(await focusedLabel(), 'Bold');
    await note.keyboard.press('ArrowLeft');
    await note.keyboard.press('ArrowLeft');
    const last = await focusedLabel();
    assert.notEqual(last, 'Heading', 'Left from the first button wraps to the last');
    await note.keyboard.press('Home');
    assert.equal(await focusedLabel(), 'Heading');
    await note.keyboard.press('End');
    assert.equal(await focusedLabel(), last);
    assert.equal(await stops(), 1);
    // Tab leaves the toolbar for the text instead of walking through every button.
    await note.keyboard.press('Tab');
    assert.equal(await note.evaluate(() => document.activeElement.id), 'editor');
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
    // The window is the paper; saved bounds are the paper plus 8px on every side.
    const after = await waitForStore(
      dataFile,
      (s) => {
        const n = s.notes.find((x) => x.id === id);
        return n && n.bounds.x === 132 && n.bounds.y === 142 && n.bounds.width === 436 && n.bounds.height === 376;
      },
      'new bounds on disk'
    );
    assert.equal(after.notes[0].updatedAt, editedAt);
    assert.ok(note);
  });

  it('notes in the corners of the screen keep their windows on screen and stay put', async () => {
    const first = await start();
    await firstNote(first.app);
    await waitForStore(first.dataFile, (s) => s.notes.length === 1, 'welcome note on disk');
    const display = await first.app.evaluate(({ screen }) => {
      const { id, workArea } = screen.getPrimaryDisplay();
      return { id, area: workArea };
    });
    await first.app.close();
    const { area } = display;
    const size = { width: 400, height: 300 };
    const corners = {
      note_corner_tl: { x: area.x, y: area.y },
      note_corner_br: { x: area.x + area.width - size.width, y: area.y + area.height - size.height }
    };
    const seeded = readStore(first.dataFile);
    const welcome = seeded.notes[0];
    seeded.notes = Object.entries(corners).map(([id, at]) => ({ ...welcome, id, bounds: { ...at, ...size }, displayId: display.id }));
    fs.writeFileSync(first.dataFile, JSON.stringify(seeded, null, 2));

    // A note's window (the paper) sits 8px inside its saved bounds, so a note saved flush
    // with a corner of the work area is already inside it: no window manager pushes it, and
    // it stays exactly where it was saved on every platform. macOS may round its work area,
    // so its edges can land a pixel further in.
    const expected = corners;
    const placed = [];
    for (let run = 0; run < 2; run++) {
      const { app } = await start({ userDataDir: first.userDataDir });
      const shown = () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((w) => w.isVisible() && w.webContents.getURL().includes('note.html')).length
        );
      await waitFor(async () => (await shown()) === 2, 'both notes shown');
      await new Promise((r) => setTimeout(r, 1000));
      const windows = {};
      for (const id of Object.keys(corners)) windows[id] = await windowBounds(app, id);
      await app.close();
      const notes = readStore(first.dataFile).notes;
      for (const id of Object.keys(corners)) {
        const { bounds } = notes.find((n) => n.id === id);
        const where = `${id} saved at ${JSON.stringify(bounds)}, work area ${JSON.stringify(area)}`;
        assert.ok(Math.abs(bounds.x - expected[id].x) <= 1 && Math.abs(bounds.y - expected[id].y) <= 1, where);
        assert.deepEqual({ width: bounds.width, height: bounds.height }, size, where);
        assert.deepEqual({ x: windows[id].x, y: windows[id].y }, { x: bounds.x + 8, y: bounds.y + 8 }, `${id} window`);
      }
      placed.push(notes.map((n) => n.bounds));
    }
    assert.deepEqual(placed[1], placed[0], 'the notes stay put after a restart');
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

  it('keyboard focus moves to the bubble on collapsing and back into the note on expanding', async () => {
    const { app } = await start();
    const note = await firstNote(app);
    const id = noteIdOf(note);
    const activeId = () => note.evaluate(() => document.activeElement && document.activeElement.id);
    await note.focus('#btnCollapse');
    await note.keyboard.press('Enter');
    await waitFor(async () => (await windowBounds(app, id)).width < 100, 'bubble size');
    await note.waitForSelector('#bubble:not([hidden])');
    await waitFor(async () => (await activeId()) === 'bubble', 'bubble focused');
    await note.keyboard.press('Enter');
    await note.waitForSelector('#shell', { state: 'visible' });
    // The welcome note shows formatted when idle, so focus returns to the note text.
    await waitFor(async () => ['preview', 'editor'].includes(await activeId()), 'focus back in the note');

    // While editing, collapsing and expanding returns to the editor.
    await startEditing(note);
    await note.click('#editor');
    await note.click('#btnCollapse');
    await note.waitForSelector('#bubble:not([hidden])');
    await waitFor(async () => (await activeId()) === 'bubble', 'bubble focused after a click');
    await note.keyboard.press('Enter');
    await note.waitForSelector('#shell', { state: 'visible' });
    await waitFor(async () => (await activeId()) === 'editor', 'editor focused again');
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
