'use strict';

// Regenerates the PNG icons in build/ from their SVG sources.
// Run with: npx electron scripts/render-icons.js
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const buildDir = path.join(__dirname, '..', 'build');
const outputs = [
  { svg: 'icon.svg', png: 'icon.png', size: 1024 },
  { svg: 'trayTemplate.svg', png: 'trayTemplate.png', size: 16 },
  { svg: 'trayTemplate.svg', png: 'trayTemplate@2x.png', size: 32 }
];

async function render(svgFile, size) {
  const svg = fs.readFileSync(path.join(buildDir, svgFile), 'utf8');
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  });
  const html = `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return image.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  for (const { svg, png, size } of outputs) {
    fs.writeFileSync(path.join(buildDir, png), await render(svg, size));
    console.log(`build/${png} (${size}x${size})`);
  }
  app.quit();
});
