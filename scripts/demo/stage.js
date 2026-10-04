'use strict';

// Takes the README screenshots (1600x1000 PNG each) from seeded sample profiles:
//   notes.png          notes on a plain desktop, one open for editing
//   manager-board.png  the Notes Manager as a board
//   manager-dark.png   the list in the dark theme, with a note's menu open
//
//   DISPLAY=:21 node scripts/demo/stage.js [--executable=PATH] [--out=docs/screenshots]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, SCALE, FRAME, arg, display, xdo, sleep, launchApp, showBackdrop, notePages, openManager, finishPng } = require('./lib');
const { seed } = require('./seed');

const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', 'screenshots')));
const EXECUTABLE = arg('executable', '') && path.resolve(arg('executable'));
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-stage-'));
const profile = (name) => fs.mkdtempSync(path.join(RAW, `${name}-`));
const raw = (name) => path.join(RAW, name);

async function notesShot() {
  const dir = profile('desktop');
  await seed(dir, 'desktop');
  const backdrop = await showBackdrop();
  const app = await launchApp(dir, EXECUTABLE);
  try {
    const pages = await notePages(app, 6);
    for (const page of pages) {
      if ((await page.inputValue('#title')) !== 'Weekend') continue;
      await page.focus('#preview');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#editor:not(.hidden)');
    }
    xdo('mousemove', 2000 * SCALE, 2000 * SCALE);
    await sleep(1200);
    const size = `${FRAME.width * SCALE}x${FRAME.height * SCALE}`;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', size, '-i', `${display()}.0+0,0`, '-frames:v', '1', raw('notes.png')]);
    finishPng(raw('notes.png'), path.join(OUT, 'notes.png'));
  } finally {
    await app.close();
    backdrop.proc.kill();
  }
}

async function managerShots() {
  const dir = profile('manager');
  await seed(dir, 'manager');
  const app = await launchApp(dir, EXECUTABLE);
  try {
    await notePages(app, 4);
    const page = await openManager(app, FRAME);
    const theme = async (value) => {
      await page.evaluate((t) => window.ghostManager.updateSettings({ theme: t }), value);
      await page.waitForFunction((t) => document.documentElement.dataset.theme === t, value);
    };
    const shot = async (name) => {
      await sleep(500);
      await page.screenshot({ path: raw(name) });
      finishPng(raw(name), path.join(OUT, name));
    };

    await theme('light');
    await page.click('#btnBoard');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.mouse.move(2, 690);
    await shot('manager-board.png');

    await theme('dark');
    await page.click('#btnList');
    const rows = page.locator('#noteList .note-card');
    await rows.nth(1).click({ button: 'right', position: { x: 180, y: 22 } });
    await page.waitForSelector('#menu:not(.hidden)');
    await rows.nth(4).hover({ position: { x: 520, y: 24 } });
    await shot('manager-dark.png');
  } finally {
    await app.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await notesShot();
  await managerShots();
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(RAW, { recursive: true, force: true }));
