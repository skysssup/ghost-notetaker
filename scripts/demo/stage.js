'use strict';

// Takes the README picture, docs/screenshots/hero.png (1600x1000): the Notes Manager
// as a window on the wallpaper, with notes on screen beside it.
//
//   DISPLAY=:21 node scripts/demo/stage.js [--executable=PATH] [--out=docs/screenshots]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, SCALE, FRAME, arg, display, xdo, sleep, displaySize, renderDesktop, launchApp, showBackdrop, notePages, openManager, finishPng } =
  require('./lib');
const { seed } = require('./seed');

const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', 'screenshots')));
const EXECUTABLE = arg('executable', '') && path.resolve(arg('executable'));
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-stage-'));
const raw = (name) => path.join(RAW, name);
/** Where the Notes Manager sits in the picture, in logical px. */
const WINDOW = { x: 40, y: 52, width: 860, height: 580 };

async function hero() {
  const dir = path.join(RAW, 'profile');
  await seed(dir, 'hero');
  const app = await launchApp(dir, EXECUTABLE);
  let backdrop;
  try {
    await notePages(app, 3);
    const page = await openManager(app, WINDOW);
    await page.evaluate(() => window.ghostManager.updateSettings({ theme: 'light' }));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.mouse.move(1, 1);
    await sleep(600);
    await page.screenshot({ path: raw('manager.png') });
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('manager.html')) w.hide();
    });

    await renderDesktop(raw('desktop.png'), displaySize(), { ...WINDOW, image: raw('manager.png') });
    backdrop = await showBackdrop(raw('desktop.png'));
    xdo('mousemove', 2000 * SCALE, 2000 * SCALE);
    await sleep(1200);
    const size = `${FRAME.width * SCALE}x${FRAME.height * SCALE}`;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', size, '-i', `${display()}.0+0,0`, '-frames:v', '1', raw('hero.png')]);
    finishPng(raw('hero.png'), path.join(OUT, 'hero.png'));
  } finally {
    await app.close();
    if (backdrop) backdrop.proc.kill();
  }
}

fs.mkdirSync(OUT, { recursive: true });
hero()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(RAW, { recursive: true, force: true }));
