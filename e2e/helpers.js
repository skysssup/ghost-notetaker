'use strict';

// Shared helpers for the end-to-end tests. Every test drives the real Electron
// app (main process, preload bridges, renderers, and the JSON store on disk)
// through Playwright. Only native OS dialogs are replaced, because a test
// cannot click a GTK/Win32/Cocoa file picker.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = 'ghost-notetaker-data.json';

function tempDir(prefix = 'ghost-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Launch the app with an isolated profile. Returns { app, userDataDir, dataFile }. */
async function launch({ userDataDir = tempDir(), env = {} } = {}) {
  const executablePath = process.env.GHOST_E2E_EXECUTABLE || undefined;
  const args = [...(executablePath ? [] : [ROOT]), `--user-data-dir=${userDataDir}`];
  const app = await _electron.launch({
    executablePath,
    args,
    cwd: ROOT,
    env: { ...process.env, ...env },
    timeout: 60000
  });
  return { app, userDataDir, dataFile: path.join(userDataDir, DATA_FILE) };
}

function readStore(dataFile) {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return null;
  }
}

async function waitFor(check, label = 'condition', timeoutMs = 10000) {
  const start = Date.now();
  let last;
  for (;;) {
    last = await check();
    if (last) return last;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Poll the JSON file on disk until `predicate(store)` is truthy. */
function waitForStore(dataFile, predicate, label = 'store change', timeoutMs = 10000) {
  return waitFor(() => {
    const store = readStore(dataFile);
    return store && predicate(store) ? store : null;
  }, label, timeoutMs);
}

async function firstNote(app) {
  const page = await app.firstWindow();
  await page.waitForSelector('#editor', { state: 'attached' });
  await waitFor(async () => (await page.inputValue('#title')) !== '', 'note to load');
  return page;
}

function noteIdOf(page) {
  return new URL(page.url()).searchParams.get('id');
}

async function noteWindow(app, noteId) {
  const match = (w) => w.url().includes(`id=${noteId}`);
  const page = app.windows().find(match) || (await app.waitForEvent('window', { predicate: match }));
  await page.waitForSelector('#editor', { state: 'attached' });
  await waitFor(async () => (await page.inputValue('#title')) !== '', 'note to load');
  return page;
}

/** Open the Notes Manager the way a second launch of the app does. */
async function openManager(app) {
  const isManager = (w) => w.url().includes('manager.html');
  let page = app.windows().find(isManager);
  if (!page) {
    const opened = app.waitForEvent('window', { predicate: isManager });
    await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, [], ''));
    page = await opened;
  }
  await page.waitForSelector('#noteList');
  await waitFor(async () => (await page.locator('.note-card, #empty:not(.hidden)').count()) > 0, 'manager list');
  return page;
}

async function openWindowIds(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((w) => w.webContents.getURL())
      .filter((u) => u.includes('note.html'))
      .map((u) => new URL(u).searchParams.get('id'))
  );
}

/** Replace the native file dialogs with fixed answers and record what was asked. */
async function stubDialogs(app, { savePath = null, openPath = null } = {}) {
  await app.evaluate(({ dialog }, answers) => {
    globalThis.__dialogCalls = [];
    // Options are always the last argument; the first may be a parent BrowserWindow.
    const options = (args) => args[args.length - 1] || {};
    dialog.showSaveDialog = async (...args) => {
      globalThis.__dialogCalls.push({ kind: 'save', ...options(args) });
      return answers.savePath ? { canceled: false, filePath: answers.savePath } : { canceled: true };
    };
    dialog.showOpenDialog = async (...args) => {
      globalThis.__dialogCalls.push({ kind: 'open', ...options(args) });
      return answers.openPath
        ? { canceled: false, filePaths: [answers.openPath] }
        : { canceled: true, filePaths: [] };
    };
  }, { savePath, openPath });
}

function dialogCalls(app) {
  return app.evaluate(() => globalThis.__dialogCalls || []);
}

/** Record shell.openExternal calls instead of opening a browser. */
async function stubOpenExternal(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url);
    };
  });
}

function hasXdotool() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  try {
    execFileSync('xdotool', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function xdotool(...args) {
  return execFileSync('xdotool', args.map(String), { encoding: 'utf8' }).trim();
}

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Focus the note editor with the caret after the last character. */
async function focusEditorEnd(page) {
  if (await page.isVisible('#preview')) await page.click('#btnPreview');
  await page.click('#editor');
  await page.evaluate(() => {
    const ta = document.getElementById('editor');
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

module.exports = {
  ROOT,
  tempDir,
  launch,
  readStore,
  waitFor,
  waitForStore,
  firstNote,
  noteIdOf,
  noteWindow,
  openManager,
  openWindowIds,
  stubDialogs,
  dialogCalls,
  stubOpenExternal,
  hasXdotool,
  xdotool,
  modKey,
  focusEditorEnd
};
