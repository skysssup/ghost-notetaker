'use strict';

// Takes the four README screenshots, each 1600x1000 PNG, from seeded sample
// profiles: notes-desktop.png (notes over the sample slide, captured from the
// X display), notes-manager.png, notes-manager-board.png and settings.png
// (the Notes Manager page at its 820x520 minimum size).
//
//   DISPLAY=:21 node scripts/demo/stage.js [--executable=dist/linux-unpacked/ghost-notetaker] [--out=docs/screenshots]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { _electron } = require('playwright');
const { PNG } = require('pngjs');
const { ROOT, renderHtml, xdo, sleep } = require('./lib');
const { seed } = require('./seed');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', 'screenshots')));
const EXECUTABLE = arg('executable', '');
const DISPLAY = process.env.DISPLAY || ':21';
const env = { ...process.env, DISPLAY };
const MANAGER = { width: 820, height: 520 };

const tempProfile = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-stage-'));

function launch(userDataDir, scale) {
  return _electron.launch({
    executablePath: EXECUTABLE ? path.resolve(EXECUTABLE) : undefined,
    args: [...(EXECUTABLE ? [] : [ROOT]), `--user-data-dir=${userDataDir}`, `--force-device-scale-factor=${scale}`],
    env,
    timeout: 60000
  });
}

/** Cut a PNG down to width x height from its top-left corner. */
function trim(file, width, height) {
  const src = PNG.sync.read(fs.readFileSync(file));
  if (src.width < width || src.height < height) throw new Error(`${file} is only ${src.width}x${src.height}`);
  const out = new PNG({ width, height });
  PNG.bitblt(src, out, 0, 0, width, height, 0, 0);
  fs.writeFileSync(file, PNG.sync.write(out));
}

/** Shrink a PNG with pngquant (when it helps) and optipng. */
function optimize(file) {
  spawnSync('pngquant', ['--force', '--skip-if-larger', '--quality=85-98', '--strip', '--output', file, file], { stdio: 'inherit' });
  execFileSync('optipng', ['-quiet', '-o2', '-strip', 'all', file]);
  console.log(`${path.relative(ROOT, file)} ${fs.statSync(file).size} bytes`);
}

async function notePages(app, count) {
  for (;;) {
    const pages = app.windows().filter((w) => w.url().includes('note.html'));
    if (pages.length >= count) {
      for (const page of pages) await page.waitForSelector('#title', { state: 'attached' });
      return pages;
    }
    await sleep(200);
  }
}

async function notesDesktop() {
  const dir = tempProfile();
  await seed(dir, 'desktop');
  const slide = path.join(dir, 'slide.png');
  await renderHtml('desktop.html', { width: 800, height: 500, scale: 2, out: slide });
  execFileSync('xsetroot', ['-solid', '#e9e7e3'], { env });
  const feh = spawn('feh', ['--borderless', '--geometry', '1600x1000+0+0', slide], { env, stdio: 'ignore' });
  await sleep(800);
  const app = await launch(dir, 2);
  try {
    const pages = await notePages(app, 4);
    for (const page of pages) {
      if ((await page.inputValue('#title')) !== 'Follow-ups') continue;
      await page.focus('#preview');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#editor:not(.hidden)');
    }
    xdo(DISPLAY, 'mousemove', 3800, 2100);
    await sleep(1200);
    const file = path.join(OUT, 'notes-desktop.png');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', '1600x1000', '-i', `${DISPLAY}.0+0,0`, '-frames:v', '1', file]);
    optimize(file);
  } finally {
    await app.close();
    feh.kill();
  }
}

async function managerShots() {
  const dir = tempProfile();
  await seed(dir, 'manager');
  const scale = 1600 / MANAGER.width;
  const app = await launch(dir, scale);
  try {
    await notePages(app, 4);
    const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('manager.html') });
    await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, [], ''));
    const page = await opened;
    await page.waitForSelector('.note-card');
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('manager.html'));
      win.setContentSize(size.width, size.height);
    }, MANAGER);
    const shot = async (name) => {
      await sleep(400);
      const file = path.join(OUT, name);
      // The scale is fractional, so ask for a little more and trim to exactly 1600x1000.
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: MANAGER.width, height: 1001 / scale } });
      trim(file, 1600, 1000);
      optimize(file);
    };
    const theme = async (value) => {
      await page.evaluate((t) => window.ghostManager.updateSettings({ theme: t }), value);
      await page.waitForFunction((t) => document.documentElement.dataset.theme === t, value);
    };

    await theme('dark');
    const rows = page.locator('#noteList .note-card');
    await rows.nth(0).click({ button: 'right', position: { x: 120, y: 14 } });
    await page.waitForSelector('#menu:not(.hidden)');
    await rows.nth(4).hover({ position: { x: 360, y: 20 } });
    await shot('notes-manager.png');
    await page.keyboard.press('Escape');

    await theme('light');
    await page.click('#btnBoard');
    await page.mouse.move(4, 300);
    await shot('notes-manager-board.png');

    await page.click('#btnShortcuts');
    // The last four shortcuts at the top, the start of the Backups section below.
    await page.evaluate(() => {
      const scroller = document.getElementById('settingsScroller');
      const row = document.querySelectorAll('.shortcut-table tbody tr')[3].getBoundingClientRect();
      scroller.style.scrollBehavior = 'auto';
      scroller.scrollTop += row.top - scroller.getBoundingClientRect().top;
    });
    await page.mouse.move(4, 300);
    await shot('settings.png');
  } finally {
    await app.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await notesDesktop();
  await managerShots();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
