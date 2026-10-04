'use strict';

// Launches a packaged Ghost Notetaker build and checks the first-run workflow:
// welcome note, typing persisted to disk, a second launch opening the Notes
// Manager, and a clean quit. Usage:
//   node scripts/smoke-packaged.js [path/to/executable]
// Without an argument it looks for the unpacked build in dist/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { _electron } = require('playwright');

function defaultExecutable() {
  const dist = path.join(__dirname, '..', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'win-unpacked', 'Ghost Notetaker.exe');
  if (process.platform === 'darwin') {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    return path.join(dist, dir, 'Ghost Notetaker.app', 'Contents', 'MacOS', 'Ghost Notetaker');
  }
  return path.join(dist, 'linux-unpacked', 'ghost-notetaker');
}

async function waitFor(check, label, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function readStore(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const executablePath = path.resolve(process.argv[2] || defaultExecutable());
  if (!fs.existsSync(executablePath)) throw new Error(`Executable not found: ${executablePath}`);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-smoke-'));
  const dataFile = path.join(userDataDir, 'ghost-notetaker-data.json');
  const userArgs = [`--user-data-dir=${userDataDir}`];
  const report = { executablePath, platform: `${process.platform}-${process.arch}` };

  const app = await _electron.launch({ executablePath, args: userArgs, timeout: 60000 });
  try {
    report.version = await app.evaluate(({ app }) => app.getVersion());

    const note = await app.firstWindow();
    await note.waitForSelector('#editor', { state: 'attached' });
    await waitFor(async () => (await note.inputValue('#title')) === 'Ghost Notetaker', 'welcome note');
    report.welcomeNote = true;

    const marker = `smoke ${Date.now()}`;
    await note.click('#btnPreview');
    await note.click('#editor');
    await note.evaluate(() => {
      const ta = document.getElementById('editor');
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    await note.keyboard.type(`\n${marker}`);
    await waitFor(() => {
      const store = readStore(dataFile);
      return store && store.notes.some((n) => n.content.includes(marker));
    }, 'typed text on disk');
    report.typingPersisted = true;

    report.contentProtected = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.isContentProtected())
    );

    // A second launch must hand over to the running instance and open the manager.
    const managerOpened = app.waitForEvent('window', {
      predicate: (w) => w.url().includes('manager.html'),
      timeout: 30000
    });
    const second = spawn(executablePath, userArgs, { stdio: 'ignore' });
    const secondExit = new Promise((resolve) => second.on('exit', (code) => resolve(code)));
    const manager = await managerOpened;
    await manager.waitForSelector('.note-card');
    report.managerNoteCount = await manager.locator('.note-card').count();
    report.secondInstanceExitCode = await secondExit;
  } finally {
    await app.close();
  }

  const store = readStore(dataFile);
  report.persistedAfterQuit = Boolean(store && store.notes.length === 1);
  console.log(JSON.stringify(report, null, 2));
  const expectProtection = process.platform === 'darwin' || process.platform === 'win32';
  const ok =
    report.welcomeNote &&
    report.typingPersisted &&
    report.managerNoteCount === 1 &&
    report.secondInstanceExitCode === 0 &&
    report.persistedAfterQuit &&
    report.contentProtected.every((v) => v === expectProtection);
  if (!ok) {
    console.error('Packaged smoke test FAILED');
    process.exit(1);
  }
  console.log('Packaged smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
