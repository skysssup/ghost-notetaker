'use strict';

// Minimal Electron entry that lib.js uses to render an HTML file to PNG: one
// frameless window of the requested size; Playwright takes the screenshot.
const { app, BrowserWindow } = require('electron');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};

app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  const [width, height] = arg('size').split('x').map(Number);
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    frame: false,
    resizable: false,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  win.loadFile(arg('file'));
});
