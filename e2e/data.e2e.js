'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ROOT,
  tempDir,
  launch,
  readStore,
  waitFor,
  waitForStore,
  firstNote,
  openManager,
  openWindowIds,
  stubDialogs,
  dialogCalls,
  noteMenuAction
} = require('./helpers');

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

async function start(options) {
  const ctx = await launch(options);
  running.push(ctx.app);
  ctx.note = await firstNote(ctx.app);
  ctx.manager = await openManager(ctx.app);
  await waitForStore(ctx.dataFile, (s) => s.notes.length === 1, 'welcome note on disk');
  return ctx;
}

const FIXTURE = path.join(__dirname, 'fixtures', 'answer-message-box.js');

/** Start the dev app directly so the startup prompt can be answered by the fixture. */
function startWithAnswer(userDataDir, response, log) {
  return spawn(require('electron'), [ROOT, `--user-data-dir=${userDataDir}`], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${FIXTURE}`,
      GHOST_E2E_MESSAGE_RESPONSE: String(response),
      ...(log ? { GHOST_E2E_MESSAGE_LOG: log } : {})
    },
    stdio: 'ignore'
  });
}
const devOnly = { skip: Boolean(process.env.GHOST_E2E_EXECUTABLE) && 'needs NODE_OPTIONS (dev build only)' };

describe('backup, import, and export', () => {
  it('exports every note to a private JSON backup and merges it back in', async () => {
    const ctx = await start();
    const backup = path.join(tempDir(), 'backup.json');
    await stubDialogs(ctx.app, { savePath: backup, openPath: backup });

    await ctx.manager.click('#btnSettings');
    await ctx.manager.click('#btnExport');
    await ctx.manager.waitForSelector('#toast:not(.hidden)');
    assert.match(await ctx.manager.locator('#toast').textContent(), /Exported 1 note to .*backup\.json/);
    const exported = JSON.parse(fs.readFileSync(backup, 'utf8'));
    assert.equal(exported.app, 'ghost-notetaker');
    assert.equal(exported.notes.length, 1);
    if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    const [call] = await dialogCalls(ctx.app);
    assert.match(path.basename(call.defaultPath), /^ghost-notetaker-backup-\d{4}-\d{2}-\d{2}\.json$/);

    await ctx.manager.click('#btnImport');
    await ctx.manager.click('#modalFooter button:has-text("Merge")');
    await ctx.manager.waitForSelector('#modalTitle:has-text("Import complete")');
    const summary = await ctx.manager.locator('#modalBody').textContent();
    assert.match(summary, /1 note imported/);
    assert.match(summary, /collision/);
    const store = await waitForStore(ctx.dataFile, (s) => s.notes.length === 2, 'merged notes');
    assert.equal(store.notes.filter((n) => !n.visible).length, 1);
    assert.notEqual(store.notes[0].id, store.notes[1].id);
  });

  it('replace import swaps the notebook and keeps the screen-capture setting', async () => {
    const ctx = await start();
    const backup = path.join(tempDir(), 'replace.json');
    fs.writeFileSync(
      backup,
      JSON.stringify({
        app: 'ghost-notetaker',
        version: 2,
        workspaces: [{ id: 'ws_team', name: 'Team' }],
        activeWorkspaceId: 'ws_team',
        settings: { contentProtection: false },
        notes: [
          { id: 'note_a', workspaceId: 'ws_team', title: 'Retro', content: 'Went well', visible: true },
          { id: 'note_b', workspaceId: 'ws_team', title: 'Hiring', content: 'Loop', visible: true }
        ]
      })
    );
    await stubDialogs(ctx.app, { openPath: backup });
    await ctx.manager.click('#btnSettings');
    await ctx.manager.click('#btnImport');
    await ctx.manager.click('#modalFooter button:has-text("Replace all")');
    await ctx.manager.waitForSelector('#modalTitle:has-text("Import complete")');
    const store = await waitForStore(ctx.dataFile, (s) => s.notes.length === 2, 'replaced notes');
    assert.deepEqual(store.notes.map((n) => n.title).sort(), ['Hiring', 'Retro']);
    assert.ok(store.notes.every((n) => !n.visible));
    assert.equal(store.settings.contentProtection, true);
    assert.deepEqual(store.workspaces.map((w) => w.name), ['Team']);
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 0, 'old window closed');
  });

  it('a file that is not a backup shows an error and changes nothing', async () => {
    const ctx = await start();
    const bad = path.join(tempDir(), 'bad.json');
    fs.writeFileSync(bad, '{"notes": [ not json');
    const before = fs.readFileSync(ctx.dataFile, 'utf8');
    await stubDialogs(ctx.app, { openPath: bad });
    await ctx.manager.click('#btnSettings');
    await ctx.manager.click('#btnImport');
    await ctx.manager.click('#modalFooter button:has-text("Merge")');
    await ctx.manager.waitForSelector('#modalTitle:has-text("Import failed")');
    assert.match(await ctx.manager.locator('#modalBody').textContent(), /Could not read that file as a Ghost Notetaker backup/);
    assert.equal(await ctx.manager.locator('#modalFooter button:has-text("Try again")').count(), 1);
    assert.equal(fs.readFileSync(ctx.dataFile, 'utf8'), before);
  });

  it('exports one note as Markdown under a safe file name', async () => {
    const ctx = await start();
    await ctx.note.click('#title');
    await ctx.note.fill('#title', 'Q3/Q4: plan?');
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.title === 'Q3/Q4: plan?', 'title on disk');
    const out = path.join(tempDir(), 'out.md');
    await stubDialogs(ctx.app, { savePath: out });
    await noteMenuAction(ctx.manager, 'Q3/Q4: plan?', 'Export as Markdown');
    await ctx.manager.waitForSelector('#toast:not(.hidden)');
    assert.match(fs.readFileSync(out, 'utf8'), /^# Q3\/Q4: plan\?\n\n# Welcome/);
    const [call] = await dialogCalls(ctx.app);
    assert.equal(path.basename(call.defaultPath), 'Q3-Q4- plan.md');
  });

  it('a corrupt notes file is set aside before starting an empty notebook', devOnly, async () => {
    const userDataDir = tempDir();
    const dataFile = path.join(userDataDir, 'ghost-notetaker-data.json');
    const log = path.join(userDataDir, 'prompts.log');
    fs.writeFileSync(dataFile, '{"notes": [truncated');
    const child = startWithAnswer(userDataDir, 0, log);
    try {
      await waitForStore(dataFile, (s) => s.notes.length === 1, 'fresh notebook with welcome note', 30000);
    } finally {
      child.kill();
    }
    const prompts = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(prompts[0].message, 'Your notes file could not be read');
    assert.deepEqual(prompts[0].buttons, ['Start Empty Notebook', 'Quit']);
    const kept = fs.readdirSync(userDataDir).filter((f) => f.includes('.corrupt.'));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(userDataDir, kept[0]), 'utf8'), '{"notes": [truncated');
  });

  it('a notes file that cannot be read stops startup with an error instead of replacing it', { ...devOnly, skip: devOnly.skip || process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    const userDataDir = tempDir();
    const dataFile = path.join(userDataDir, 'ghost-notetaker-data.json');
    const log = path.join(userDataDir, 'prompts.log');
    fs.writeFileSync(dataFile, JSON.stringify({ notes: [{ id: 'n1', title: 'Keep me' }] }));
    fs.chmodSync(dataFile, 0o000);
    try {
      const child = startWithAnswer(userDataDir, 0, log);
      const code = await new Promise((resolve) => child.on('exit', resolve));
      assert.equal(code, 1);
    } finally {
      fs.chmodSync(dataFile, 0o600);
    }
    const [entry] = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(entry.errorBox, 'Ghost Notetaker could not start');
    assert.match(entry.content, /EACCES/);
    assert.deepEqual(fs.readdirSync(userDataDir).filter((f) => f.includes('.corrupt.')), []);
    assert.equal(readStore(dataFile).notes[0].title, 'Keep me');
  });

  it('asks before quitting when changes cannot be saved, and stays open if asked to', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    const ctx = await start();
    await ctx.app.evaluate(({ dialog }) => {
      globalThis.__prompts = [];
      dialog.showMessageBox = async (...args) => {
        const options = args[args.length - 1];
        globalThis.__prompts.push({ message: options.message, buttons: options.buttons });
        return { response: 0, checkboxChecked: false };
      };
    });
    fs.chmodSync(ctx.userDataDir, 0o500);
    try {
      await ctx.app.evaluate(({ app: electronApp }) => electronApp.quit());
      const prompts = await waitFor(async () => {
        const list = await ctx.app.evaluate(() => globalThis.__prompts);
        return list.length ? list : null;
      }, 'quit prompt');
      assert.equal(prompts[0].message, 'Some changes could not be saved');
      assert.deepEqual(prompts[0].buttons, ['Keep Open', 'Quit Without Saving']);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal((await openWindowIds(ctx.app)).length, 1, 'the app should still be running');
    } finally {
      fs.chmodSync(ctx.userDataDir, 0o700);
    }
  });

  it('choosing Quit at the corrupt-file prompt exits without writing a new notes file', devOnly, async () => {
    const userDataDir = tempDir();
    const dataFile = path.join(userDataDir, 'ghost-notetaker-data.json');
    fs.writeFileSync(dataFile, 'definitely not json');
    const child = startWithAnswer(userDataDir, 1);
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('app did not exit'));
      }, 30000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    assert.equal(code, 0);
    assert.equal(fs.existsSync(dataFile), false);
    const kept = fs.readdirSync(userDataDir).filter((f) => f.includes('.corrupt.'));
    assert.equal(fs.readFileSync(path.join(userDataDir, kept[0]), 'utf8'), 'definitely not json');
    assert.equal(readStore(dataFile), null);
  });
});
