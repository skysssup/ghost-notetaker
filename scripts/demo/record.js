'use strict';

// Records the README demo: Ghost Notetaker driven with real X11 input over a
// sample slide, captured by ffmpeg without the cursor. Writes capture.mkv
// (lossless; frames keep their wall-clock grab time) and events.json (pointer,
// clicks, beats and sync flashes on the same clock) for compose.js. Beat 3
// holds 0.35 s extra so compose.js can ease its zoom out before beat 4.
//
//   DISPLAY=:21 node scripts/demo/record.js [--executable=PATH | --app=DIR] [--out=DIR] [--display=:N]

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const { _electron } = require('playwright');
const { ROOT, renderHtml, xdo, sleep, arg, DEMO_OUT } = require('./lib');
const { seed } = require('./seed');

const display = arg('display', process.env.DISPLAY || ':21');
const outDir = path.resolve(arg('out', DEMO_OUT));
const executable = arg('executable') && path.resolve(arg('executable'));
const appDir = path.resolve(arg('app', ROOT));

const SCALE = 2;
const FPS = 15;
const REGION = { x: 360, y: 165, width: 1200, height: 750 };
const CHART = { width: 560, height: 220 };
const SYNC = { x: 12, y: 12, size: 16, color: [255, 0, 255], flashes: 8 };
const BUTTER = 'note_review';
const REST = [640, 610];
const NEW_NOTE_AT = [400, 418];
const DROP = { inset: 14, y: 600 };
const STEP_MS = 16;
const ZOOM_EASE_MS = 350;
const HOLD = { start: 1200, typed: 1000, pasted: 800, formatted: 1500, ticked: 800, dropped: 800, hidden: 1000, end: 1500 };

const clock = () => performance.timeOrigin + performance.now();
const events = [];
const log = (type, extra) => events.push({ t: clock(), type, ...extra });
const children = [];
let app = null;
let pointer = null;

const onSlide = ([x, y]) => [REGION.x + x, REGION.y + y];
const capturePx = ([x, y]) => ({ x: (x - REGION.x) * SCALE, y: (y - REGION.y) * SCALE });
const captureRect = (r) => ({ ...capturePx([r.x, r.y]), width: r.width * SCALE, height: r.height * SCALE });
const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];
const easeInOut = (k) => (1 - Math.cos(Math.PI * k)) / 2;

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(20);
  }
}

/** Pointer positions are whole logical px, so the app never sees half-pixel moves at 2x. */
function moveTo([x, y]) {
  pointer = [Math.round(x), Math.round(y)];
  xdo(display, 'mousemove', pointer[0] * SCALE, pointer[1] * SCALE);
  log('move', capturePx(pointer));
}

/** Move the pointer to `to` (logical screen px) along a straight, eased path, one small step per frame. */
async function glide(to, ms = Math.min(750, 300 + 0.6 * Math.hypot(to[0] - pointer[0], to[1] - pointer[1]))) {
  const from = pointer;
  const start = clock();
  log('move', capturePx(from));
  for (let k = 0; k < 1; ) {
    await sleep(STEP_MS);
    k = Math.min(1, (clock() - start) / ms);
    const e = easeInOut(k);
    moveTo([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
  }
}

function click() {
  xdo(display, 'click', 1);
  log('click', capturePx(pointer));
}

function press() {
  xdo(display, 'mousedown', 1);
  log('down', capturePx(pointer));
}

function release() {
  xdo(display, 'mouseup', 1);
  log('up', capturePx(pointer));
}

const key = (combo) => xdo(display, 'key', '--clearmodifiers', combo);
const type = (text) => xdo(display, 'type', '--delay', 45, '--', text);
const beat = (n) => log('beat', { n });

function findWindow(title) {
  try {
    return xdo(display, 'search', '--onlyvisible', '--name', `^${title}$`);
  } catch {
    return null;
  }
}

/** Show a PNG 1:1 in a borderless feh window at logical screen px [x, y]; resolves once it is mapped. */
async function showImage(file, [x, y], [width, height], title) {
  const geometry = `${width}x${height}+${x * SCALE}+${y * SCALE}`;
  const proc = spawn('feh', ['--borderless', '--geometry', geometry, '--title', title, file], { stdio: 'ignore' });
  children.push(proc);
  const win = await waitFor(() => findWindow(title), `the ${title} window`);
  return { proc, win };
}

function solidPng(file, size, color) {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...color, 255], i);
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}

/** Start ffmpeg on the region; `started` resolves once frames are being written. */
function startCapture(file) {
  const input = ['-f', 'x11grab', '-draw_mouse', 0, '-framerate', FPS, '-video_size', `${REGION.width * SCALE}x${REGION.height * SCALE}`];
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-stats_period', 0.1, ...input,
    '-i', `${display}.0+${REGION.x * SCALE},${REGION.y * SCALE}`, '-copyts', '-c:v', 'ffv1', '-level', 3, '-slices', 4, '-y', file];
  const ff = spawn('ffmpeg', args.map(String), { stdio: ['pipe', 'pipe', 'inherit'] });
  children.push(ff);
  const exited = new Promise((resolve) => ff.once('exit', resolve));
  const firstFrame = new Promise((resolve) => ff.stdout.on('data', (chunk) => /frame=[1-9]/.test(chunk) && resolve()));
  return {
    started: Promise.race([firstFrame, exited.then((code) => Promise.reject(new Error(`ffmpeg exited early (code ${code})`)))]),
    async stop() {
      ff.stdin.end('q');
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    }
  };
}

/**
 * Raise a solid square (kept painted behind the slide) above the slide a few
 * times, each flash 1/8 frame later against the capture's frame grid than the
 * last, so compose.js can check the clocks and time window changes to a few ms.
 */
async function syncFlashes(marker, slideWin) {
  const cycle = (4 + 1 / SYNC.flashes) * (1000 / FPS);
  const start = clock();
  const flashes = [];
  for (let k = 0; k < SYNC.flashes; k++) {
    await sleep(Math.max(0, start + k * cycle - clock()));
    xdo(display, 'windowraise', marker);
    const on = clock();
    await sleep(cycle / 2);
    xdo(display, 'windowraise', slideWin);
    flashes.push({ on, off: clock() });
  }
  return flashes;
}

/** Visible note windows with their bounds (logical screen px). */
const noteWindows = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.isVisible() && w.webContents.getURL().includes('note.html'))
      .map((w) => ({ id: new URL(w.webContents.getURL()).searchParams.get('id'), bounds: w.getBounds() }))
  );

const pageOf = (id) => waitFor(() => app.windows().find((p) => new URL(p.url()).searchParams.get('id') === id), `the page of ${id}`);

/**
 * A dragged window reaches the screen well after the pointer moves. Log the
 * window's own moves, as the point the pointer holds, so compose.js can find
 * the window along that path in each frame and draw the pointer on it.
 * Returns a function that adds them to the events.
 */
async function watchMoves(id) {
  const grab = await app.evaluate(({ BrowserWindow }, [id, px, py]) => {
    const win = BrowserWindow.getAllWindows().find((w) => new URL(w.webContents.getURL()).searchParams.get('id') === id);
    const moves = (globalThis.demoMoves = []);
    win.on('move', () => moves.push([performance.timeOrigin + performance.now(), ...win.getPosition()]));
    const [x, y] = win.getPosition();
    return [px - x, py - y];
  }, [id, ...pointer]);
  return async () => {
    for (const [t, x, y] of await app.evaluate(() => globalThis.demoMoves)) {
      events.push({ t, type: 'drag', ...capturePx([x + grab[0], y + grab[1]]) });
    }
    events.sort((a, b) => a.t - b.t);
  };
}

/** Playwright makes every page report focus; blur-to-format needs the real window focus. */
async function useRealFocus(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

/** Screen rect (logical px) of the first element matching `selector` in a note window. */
async function rectOf(id, selector) {
  const page = await pageOf(id);
  const r = await page.$eval(selector, (el) => el.getBoundingClientRect().toJSON());
  const { bounds } = (await noteWindows()).find((w) => w.id === id);
  return { x: bounds.x + r.x, y: bounds.y + r.y, width: r.width, height: r.height };
}

async function record() {
  process.env.DISPLAY = display;
  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.join(outDir, 'profile');
  fs.rmSync(profile, { recursive: true, force: true });
  await seed(profile, 'demo', { origin: [REGION.x, REGION.y] });
  const slide = await renderHtml('desktop.html', { ...REGION, scale: SCALE, out: path.join(outDir, 'slide.png') });
  const chart = await renderHtml('chart.html', { ...CHART, scale: SCALE, out: path.join(outDir, 'chart.png') });
  const syncSize = SYNC.size * SCALE;
  const syncAt = onSlide([SYNC.x, SYNC.y]);

  execFileSync('xsetroot', ['-solid', '#e9e7e3']);
  const slideSize = [REGION.width * SCALE, REGION.height * SCALE];
  const { win: slideWin } = await showImage(slide, onSlide([0, 0]), slideSize, 'ghost-demo-slide');
  const marker = solidPng(path.join(outDir, 'sync.png'), syncSize, SYNC.color);
  const { win: markerWin } = await showImage(marker, syncAt, [syncSize, syncSize], 'ghost-demo-sync');
  children.push(spawn('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-quiet', '-i', chart], { stdio: 'ignore' }));

  app = await _electron.launch({
    executablePath: executable || undefined,
    args: [...(executable ? [] : [appDir]), `--user-data-dir=${profile}`, `--force-device-scale-factor=${SCALE}`, '--ozone-platform=x11'],
    timeout: 60000
  });
  const seeded = await waitFor(async () => {
    const wins = await noteWindows();
    return wins.length === 2 && wins;
  }, 'the two seeded notes');
  for (const { id } of seeded) {
    const page = await pageOf(id);
    await useRealFocus(page);
    await page.waitForFunction(() => document.getElementById('preview').checkVisibility());
  }
  xdo(display, 'windowactivate', '--sync', slideWin);
  moveTo(onSlide(REST));

  const capture = startCapture(path.join(outDir, 'capture.mkv'));
  await capture.started;
  await sleep(1000);
  const flashes = await syncFlashes(markerWin, slideWin);
  const sync = { ...capturePx(syncAt), width: syncSize, height: syncSize, color: SYNC.color, flashes };
  await sleep(300);

  beat(1);
  await sleep(HOLD.start);

  beat(2);
  await glide(onSlide(NEW_NOTE_AT), 600);
  await sleep(150);
  const seededIds = new Set(seeded.map((w) => w.id));
  key('ctrl+shift+n');
  const { id } = await waitFor(async () => (await noteWindows()).find((w) => !seededIds.has(w.id)), 'the new note');
  const page = await pageOf(id);
  await useRealFocus(page);
  await page.waitForFunction(() => document.hasFocus() && document.activeElement.id === 'editor');
  type('## Questions from Priya');
  key('Return');
  type('- [ ] SSO timeline');
  await page.waitForFunction(() => document.getElementById('editor').value.endsWith('## Questions from Priya\n- [ ] SSO timeline'));
  await sleep(HOLD.typed);

  beat(3);
  key('ctrl+v');
  await page.waitForFunction(() => /!\[[^\]]*\]\(/.test(document.getElementById('editor').value));
  await sleep(HOLD.pasted);
  const paper = await rectOf(id, '#shell');
  await glide([paper.x + paper.width / 4, paper.y - 36]);
  await sleep(120);
  click();
  await page.waitForFunction(() => {
    const images = Array.from(document.querySelectorAll('#preview img'));
    const formatted = !document.getElementById('editor').checkVisibility() && document.getElementById('preview').checkVisibility();
    return formatted && images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
  });
  const newNote = captureRect(await rectOf(id, '#shell'));
  await sleep(HOLD.formatted + ZOOM_EASE_MS);

  beat(4);
  const butter = await pageOf(BUTTER);
  const ticked = await butter.$$eval('#preview .task-check:checked', (list) => list.length);
  await glide(center(await rectOf(BUTTER, '#preview .task-check:not(:checked)')));
  await sleep(150);
  click();
  await butter.waitForFunction((n) => document.querySelectorAll('#preview .task-check:checked').length > n, ticked);
  await sleep(HOLD.ticked);

  beat(5);
  await glide(center(await rectOf(id, '#btnCollapse')));
  await sleep(350);
  click();
  await page.waitForFunction(() => document.getElementById('bubble').checkVisibility());
  await waitFor(async () => (await noteWindows()).find((w) => w.id === id && w.bounds.width < 200), 'the bubble window');
  const bubble = await rectOf(id, '#bubble');
  await sleep(200);
  await glide(center(bubble), 450);
  await sleep(100);
  const logDrag = await watchMoves(id);
  press();
  await sleep(150);
  await glide(onSlide([REGION.width - DROP.inset - bubble.width / 2, DROP.y]), 900);
  release();
  await sleep(HOLD.dropped);
  await logDrag();

  beat(6);
  key('ctrl+shift+h');
  await waitFor(async () => (await noteWindows()).length === 0, 'the notes to hide');
  await sleep(HOLD.hidden);
  key('ctrl+shift+h');
  await waitFor(async () => (await noteWindows()).length === 3, 'the notes to return');
  log('restored');
  await sleep(HOLD.end + 300);
  await capture.stop();

  const file = path.join(outDir, 'events.json');
  const meta = { capture: 'capture.mkv', fps: FPS, scale: SCALE, region: REGION, sync, newNote, events };
  fs.writeFileSync(file, JSON.stringify(meta, null, 1));
  console.log(`Wrote ${path.join(outDir, 'capture.mkv')} and ${file}`);
}

async function cleanup() {
  if (app) {
    const proc = app.process();
    await Promise.race([app.close().catch(() => {}), sleep(5000)]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    app = null;
  }
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cleanup().then(() => process.exit(130)));

record()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
