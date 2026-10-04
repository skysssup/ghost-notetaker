'use strict';

// Helpers shared by the demo scripts.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const DATA_FILE = 'ghost-notetaker-data.json';

/**
 * Render an HTML file from this folder to a PNG with Electron (driven by
 * Playwright). `width`/`height` are CSS pixels; `scale` is the device pixel
 * ratio, so the PNG is width*scale by height*scale.
 */
async function renderHtml(file, { width, height, scale = 2, out, query = {} }) {
  const app = await _electron.launch({
    args: [
      path.join(__dirname, 'render-main.js'),
      `--force-device-scale-factor=${scale}`,
      `--file=${path.join(__dirname, file)}`,
      `--size=${width}x${height}`,
      `--query=${new URLSearchParams(query)}`
    ],
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

/** Run xdotool on the demo display and return its output. */
function xdo(display, ...args) {
  return execFileSync('xdotool', args.map(String), { encoding: 'utf8', env: { ...process.env, DISPLAY: display } }).trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Value of a `--name=value` command-line flag, or `fallback` when it is absent. */
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Default folder for the recording (record.js) and the finished GIF and MP4 (compose.js). */
const DEMO_OUT = path.join(ROOT, 'dist', 'demo');

module.exports = { ROOT, DATA_FILE, renderHtml, xdo, sleep, arg, DEMO_OUT };
