'use strict';

// Records the README videos with real X11 input, at 2x, scaled to 1600x1000, each
// with an animated WebP of it for the README (GitHub plays no video committed to a repository):
//   notes.mp4    write a note, tick a task, change a color, make a bubble, hide and show all
//   manager.mp4  search, board view, recolor a note, dark theme; shown as a window on the wallpaper
//
//   DISPLAY=:21 node scripts/demo/record.js [--executable=PATH] [--out=docs/demo] [--only=notes|manager]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { ROOT, SCALE, FRAME, OUTPUT_WIDTH, arg, display, xEnv, xdo, sleep, renderDesktop, renderCardMask, launchApp, showBackdrop, notePages, openManager } =
  require('./lib');
const { seed } = require('./seed');

const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', 'demo')));
const EXECUTABLE = arg('executable', '') && path.resolve(arg('executable'));
const ONLY = arg('only', '');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-record-'));
const FPS = 30;
/** The manager video is the window's content, placed on the wallpaper at CARD (logical px of a CANVAS-sized picture). */
const CANVAS = { width: 1280, height: 800 };
const CARD = { x: 80, y: 50, ...FRAME };

let pointer = [0, 0];
const px = (v) => Math.round(v * SCALE);
const easeInOut = (k) => (1 - Math.cos(Math.PI * k)) / 2;
const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];

function moveTo([x, y]) {
  pointer = [x, y];
  xdo('mousemove', px(x), px(y));
}

/** Move the pointer to `to` (logical screen px) along an eased path. */
async function glide(to, ms) {
  const from = pointer;
  const duration = ms || Math.min(800, 320 + 0.55 * Math.hypot(to[0] - from[0], to[1] - from[1]));
  const start = Date.now();
  for (let k = 0; k < 1; ) {
    await sleep(14);
    k = Math.min(1, (Date.now() - start) / duration);
    const e = easeInOut(k);
    moveTo([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
  }
}

const click = () => xdo('click', 1);
const rightClick = () => xdo('click', 3);
const key = (combo) => xdo('key', '--clearmodifiers', combo);
const type = (text, delay = 55) => xdo('type', '--delay', delay, '--', text);

async function clickAt(target, { settle = 160, ms } = {}) {
  await glide(target, ms);
  await sleep(settle);
  click();
}

/** ffmpeg capture of a logical screen rect; stop() ends it and returns the file. */
function startCapture(name, rect) {
  const file = path.join(WORK, `${name}.mkv`);
  const ff = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', FPS, '-video_size', `${px(rect.width)}x${px(rect.height)}`,
      '-i', `${display()}.0+${px(rect.x)},${px(rect.y)}`, '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', 0, '-y', file].map(String),
    { stdio: ['pipe', 'ignore', 'inherit'], env: xEnv() }
  );
  const exited = new Promise((resolve) => ff.once('exit', resolve));
  return {
    async stop() {
      ff.stdin.end('q');
      if ((await exited) !== 0) throw new Error(`ffmpeg failed while recording ${name}`);
      return file;
    }
  };
}

/** Scale the capture to the README width as H.264 that plays everywhere, and as an animated WebP. */
function encode(src, name) {
  const video = path.join(OUT, `${name}.mp4`);
  const webp = path.join(OUT, `${name}.webp`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${OUTPUT_WIDTH}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264',
    '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an', video]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-vf', `fps=20,scale=${OUTPUT_WIDTH}:-2:flags=lanczos`, '-c:v', 'libwebp_anim',
    '-quality', '76', '-compression_level', '5', '-loop', '0', '-an', webp]);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }));
  for (const file of [video, webp]) console.log(`${path.relative(ROOT, file)} ${seconds.toFixed(1)} s, ${fs.statSync(file).size} bytes`);
}

/** Put a capture of the manager's content on the wallpaper, with round corners and a shadow. */
async function onDesktop(src) {
  const desktop = await renderDesktop(path.join(WORK, 'desktop.png'), CANVAS, CARD);
  const mask = await renderCardMask(path.join(WORK, 'mask.png'), FRAME);
  const out = path.join(WORK, 'on-desktop.mkv');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-framerate', FPS, '-i', desktop, '-i', src, '-loop', '1', '-framerate', FPS, '-i', mask,
    '-filter_complex', `[1:v]format=rgba[v];[2:v]format=gray[m];[v][m]alphamerge=shortest=1[card];[0:v][card]overlay=${px(CARD.x)}:${px(CARD.y)}:shortest=1`,
    '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', 0, out].map(String));
  return out;
}

/** Playwright makes every page report focus; a note only formats itself when its window really loses focus. */
async function useRealFocus(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

const noteBounds = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.isVisible() && w.webContents.getURL().includes('note.html'))
      .map((w) => ({ id: new URL(w.webContents.getURL()).searchParams.get('id'), bounds: w.getBounds() }))
  );

async function pageOf(app, id) {
  for (;;) {
    const page = app.windows().find((p) => p.url().includes(`id=${id}`));
    if (page) return page;
    await sleep(50);
  }
}

/** Screen rect (logical px) of an element in a note window. */
async function rectIn(app, id, selector) {
  const page = await pageOf(app, id);
  const r = await page.$eval(selector, (el) => el.getBoundingClientRect().toJSON());
  const { bounds } = (await noteBounds(app)).find((w) => w.id === id);
  return { x: bounds.x + r.x, y: bounds.y + r.y, width: r.width, height: r.height };
}

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(40);
  }
}

async function recordNotes() {
  const dir = path.join(WORK, 'notes-profile');
  await seed(dir, 'demo');
  const backdrop = await showBackdrop();
  const app = await launchApp(dir, EXECUTABLE);
  try {
    const seeded = await notePages(app, 2);
    for (const page of seeded) {
      await useRealFocus(page);
      await page.waitForFunction(() => document.getElementById('preview').checkVisibility());
    }
    xdo('windowactivate', '--sync', backdrop.win);
    moveTo([660, 500]);
    await sleep(800);

    const capture = startCapture('notes', { x: 0, y: 0, ...FRAME });
    await sleep(1000);

    // A new note from the keyboard, next to the pointer. Chromium on X11 can hold on to an old
    // pointer position after the pointer moved over another app's window; asking once refreshes it.
    await glide([528, 150]);
    await sleep(250);
    await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    const before = new Set((await noteBounds(app)).map((w) => w.id));
    key('ctrl+shift+n');
    const { id, bounds } = await waitFor(async () => (await noteBounds(app)).find((w) => !before.has(w.id)), 'the new note');
    if (Math.abs(bounds.x - 536) > 2 || Math.abs(bounds.y - 158) > 2) throw new Error(`The new note opened at ${bounds.x},${bounds.y}; run again`);
    const page = await pageOf(app, id);
    await useRealFocus(page);
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'editor');
    await sleep(500);
    await clickAt(center(await rectIn(app, id, '#title')));
    key('ctrl+a');
    type('Weekend', 70);
    await sleep(250);
    const editor = await rectIn(app, id, '#editor');
    await clickAt([editor.x + editor.width / 2, editor.y + 30]);
    await sleep(200);
    type('## Saturday');
    key('Return');
    type('- [ ] Farmers market');
    key('Return');
    type('- [ ] Bike to the lake');
    key('Return');
    key('Return');
    type('**Sunday:** brunch at 11');
    await sleep(700);

    // Clicking the desktop shows it formatted. xfwm4 now and then keeps the focus on the note.
    await clickAt([720, 560]);
    const formatted = () => page.waitForFunction(() => document.getElementById('preview').checkVisibility(), null, { timeout: 2500 });
    await formatted().catch(() => {
      xdo('windowactivate', backdrop.win);
      return formatted();
    });
    await sleep(1100);

    // Tick a task in the formatted view.
    const today = 'note_today';
    const boxes = await (await pageOf(app, today)).$$('#preview .task-check');
    const box = await boxes[1].boundingBox();
    const todayWin = (await noteBounds(app)).find((w) => w.id === today).bounds;
    await clickAt([todayWin.x + box.x + box.width / 2, todayWin.y + box.y + box.height / 2]);
    await sleep(900);

    // A new paper from the note's own menu.
    const groceries = 'note_groceries';
    await glide(center(await rectIn(app, groceries, '.preview')));
    await sleep(350);
    await clickAt(center(await rectIn(app, groceries, '#btnMore')), { settle: 250 });
    await (await pageOf(app, groceries)).waitForSelector('#morePanel:not(.hidden)');
    await sleep(500);
    await clickAt(center(await rectIn(app, groceries, '#palette [data-color="teal"]')), { settle: 250 });
    await sleep(600);
    key('Escape');
    await sleep(500);

    // Shrink the new note to a bubble and park it at the edge.
    await glide(center(await rectIn(app, id, '.preview')));
    await sleep(300);
    await clickAt(center(await rectIn(app, id, '#btnCollapse')), { settle: 300 });
    await page.waitForFunction(() => document.getElementById('bubble').checkVisibility());
    await waitFor(async () => (await noteBounds(app)).find((w) => w.id === id && w.bounds.width < 200), 'the bubble');
    await sleep(500);
    await glide(center(await rectIn(app, id, '#bubble')), 450);
    await sleep(150);
    xdo('mousedown', 1);
    await sleep(120);
    await glide([990, 560], 1100);
    xdo('mouseup', 1);
    await sleep(900);

    // Hide every note and bring them back.
    await glide([780, 520], 500);
    key('ctrl+shift+h');
    await waitFor(async () => (await noteBounds(app)).length === 0, 'the notes to hide');
    await sleep(1100);
    key('ctrl+shift+h');
    await waitFor(async () => (await noteBounds(app)).length === 3, 'the notes to return');
    await sleep(1600);

    encode(await capture.stop(), 'notes');
  } finally {
    await app.close();
    backdrop.proc.kill();
  }
}

async function recordManager() {
  const dir = path.join(WORK, 'manager-profile');
  await seed(dir, 'manager');
  const app = await launchApp(dir, EXECUTABLE);
  try {
    await notePages(app, 4);
    // Notes stay "on screen" for the counts, but their windows would cover the manager.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('note.html')) w.hide();
    });
    const page = await openManager(app, FRAME);
    const content = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('manager.html'));
      win.setPosition(120, 60);
      win.focus();
      return win.getContentBounds();
    });
    await sleep(600);
    const at = (r) => [content.x + r.x + r.width / 2, content.y + r.y + r.height / 2];
    const rectOf = (selector) => page.$eval(selector, (el) => el.getBoundingClientRect().toJSON());
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    moveTo([content.x + 700, content.y + 520]);
    await sleep(500);

    const capture = startCapture('manager', content);
    await sleep(1200);

    await clickAt(at(await rectOf('#search')));
    type('gro', 120);
    await page.waitForFunction(() => document.querySelectorAll('#noteList .note-card').length === 1);
    await sleep(1200);
    key('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#noteList .note-card').length > 1);
    await sleep(700);

    await clickAt(at(await rectOf('#btnBoard')));
    await page.waitForSelector('#noteList.board');
    await sleep(1300);

    const card = page.locator('#noteList .note-card', { hasText: 'Workout' });
    await glide(at(await card.evaluate((el) => el.getBoundingClientRect().toJSON())));
    await sleep(300);
    rightClick();
    await page.waitForSelector('#menu:not(.hidden)');
    await sleep(600);
    const mint = await page.$eval('#menu .swatch-btn[data-color="mint"]', (el) => getComputedStyle(el).backgroundColor);
    await clickAt(at(await rectOf('#menu .swatch-btn[data-color="mint"]')), { settle: 250 });
    await page.waitForFunction((color) => {
      const el = Array.from(document.querySelectorAll('#noteList .note-card')).find((c) => c.textContent.includes('Workout'));
      return el && getComputedStyle(el).backgroundColor === color;
    }, mint);
    await sleep(1000);

    await clickAt(at(await rectOf('#btnSettings')));
    await page.waitForSelector('#settingsView:not([hidden])');
    await sleep(800);
    await clickAt(at(await rectOf('.theme-option[data-theme="dark"]')));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await sleep(900);
    await clickAt(at(await rectOf('#wsList .side-btn')));
    await page.waitForSelector('#notesView:not([hidden])');
    await sleep(1800);

    encode(await onDesktop(await capture.stop()), 'manager');
  } finally {
    await app.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (ONLY !== 'manager') await recordNotes();
  if (ONLY !== 'notes') await recordManager();
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(WORK, { recursive: true, force: true }));
