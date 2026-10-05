'use strict';

// Helpers shared by the demo scripts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { _electron } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const DATA_FILE = 'ghost-notetaker-data.json';
const SCALE = 2;
/** Logical size of the area every screenshot and video shows; it is rendered at 2x and scaled to 1600x1000. */
const FRAME = { width: 1120, height: 700 };
const OUTPUT_WIDTH = 1600;
/** A large cursor theme keeps the pointer readable after scaling. */
const CURSOR = { XCURSOR_THEME: 'Bibata-Modern-Classic', XCURSOR_SIZE: '48' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Value of a `--name=value` command-line flag, or `fallback` when it is absent. */
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const display = () => process.env.DISPLAY || ':21';
const xEnv = () => ({ ...process.env, ...CURSOR, DISPLAY: display() });

/** Run xdotool on the demo display and return its output. */
function xdo(...args) {
  return execFileSync('xdotool', args.map(String), { encoding: 'utf8', env: xEnv() }).trim();
}

/**
 * Render an HTML file (a path relative to this folder) to a PNG with Electron.
 * `width` and `height` are CSS pixels; the PNG is `scale` times larger. `hash`
 * becomes the page's URL fragment.
 */
async function renderHtml(file, { width, height, scale = SCALE, out, hash = '' }) {
  const app = await _electron.launch({
    args: [
      path.join(__dirname, 'render-main.js'),
      `--force-device-scale-factor=${scale}`,
      `--file=${path.resolve(__dirname, file)}`,
      `--size=${width}x${height}`,
      `--hash=${encodeURIComponent(hash)}`
    ],
    env: xEnv(),
    timeout: 60000
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
  } finally {
    await app.close();
  }
  return out;
}

/** Launch Ghost Notetaker (the source tree, or a packaged build) on a profile. */
function launchApp(profile, executable) {
  return _electron.launch({
    executablePath: executable || undefined,
    args: [...(executable ? [] : [ROOT]), `--user-data-dir=${profile}`, `--force-device-scale-factor=${SCALE}`],
    env: xEnv(),
    timeout: 60000
  });
}

/** Logical size of the demo display. */
function displaySize() {
  const [width, height] = xdo('getdisplaygeometry').split(' ').map(Number);
  return { width: width / SCALE, height: height / SCALE };
}

/**
 * desktop.html as a PNG of `size` (logical px): the wallpaper, with `card` (see
 * desktop.html) on it when given.
 */
const renderDesktop = (out, size, card) => renderHtml('desktop.html', { ...size, out, hash: JSON.stringify(card ? { card } : {}) });

/** The alpha mask that rounds the corners of a video of `size` (logical px) like a desktop.html card. */
const renderCardMask = (out, size) => renderHtml('desktop.html', { ...size, out, hash: JSON.stringify({ mask: true }) });

/**
 * The desktop under the notes: a borderless window that shows `image` (the
 * wallpaper when omitted). A real window, not the root, so a click on it takes
 * focus away from a note.
 */
async function showBackdrop(image) {
  const { width, height } = displaySize();
  const file = image || (await renderDesktop(path.join(os.tmpdir(), `ghost-desktop-${width}x${height}.png`), { width, height }));
  spawnSync('xsetroot', ['-cursor_name', 'left_ptr'], { env: xEnv() });
  const geometry = `${width * SCALE}x${height * SCALE}+0+0`;
  const proc = spawn('feh', ['--borderless', '--title', 'ghost-backdrop', '--geometry', geometry, file], { env: xEnv(), stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      return { proc, win: xdo('search', '--onlyvisible', '--name', '^ghost-backdrop$').split('\n')[0] };
    } catch {
      await sleep(100);
    }
  }
  proc.kill();
  throw new Error('The backdrop window did not appear');
}

/** Note pages of the app, once `count` of them have loaded. */
async function notePages(app, count) {
  for (let i = 0; i < 300; i++) {
    const pages = app.windows().filter((w) => w.url().includes('note.html'));
    if (pages.length >= count) {
      for (const page of pages) await page.waitForFunction(() => document.getElementById('title').value !== '');
      return pages;
    }
    await sleep(100);
  }
  throw new Error(`Expected ${count} note windows`);
}

/** Open the Notes Manager the way a second launch does, sized to `size` (logical px). */
async function openManager(app, size) {
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('manager.html') });
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance', {}, [], ''));
  const page = await opened;
  await page.waitForSelector('.note-card');
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('manager.html'));
    win.setContentSize(s.width, s.height);
  }, size);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Scale a 2x capture down to the README width with a Lanczos filter, then shrink the PNG. */
function finishPng(src, dest) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${OUTPUT_WIDTH}:-2:flags=lanczos`, dest]);
  spawnSync('pngquant', ['--force', '--skip-if-larger', '--quality=90-99', '--strip', '--output', dest, dest], { stdio: 'inherit' });
  execFileSync('optipng', ['-quiet', '-o2', '-strip', 'all', dest]);
  console.log(`${path.relative(ROOT, dest)} ${fs.statSync(dest).size} bytes`);
}

module.exports = {
  ROOT,
  DATA_FILE,
  SCALE,
  FRAME,
  OUTPUT_WIDTH,
  arg,
  display,
  xEnv,
  xdo,
  sleep,
  renderHtml,
  displaySize,
  renderDesktop,
  renderCardMask,
  launchApp,
  showBackdrop,
  notePages,
  openManager,
  finishPng
};
