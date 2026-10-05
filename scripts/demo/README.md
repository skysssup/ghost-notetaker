# Demo assets

These scripts make the picture and videos in the README from sample notes.

| File | What it does |
| --- | --- |
| `seed.js` | Writes a profile with sample notes (`manager`, `hero`, `demo`). |
| `stage.js` | Takes `docs/screenshots/hero.png`: the Notes Manager as a window on the wallpaper, with notes beside it. |
| `record.js` | Records the `notes` and `manager` videos into `docs/demo` (MP4, plus an animated WebP for the README) with real mouse and keyboard input. |
| `wallpaper.html` | The desktop wallpaper, drawn for this project. |
| `desktop.html` | The wallpaper with a window on it as a card, and the mask that rounds the manager video's corners. |
| `chips.html` | The image in the sample "Living room paint" note. |

They need Linux with X11:

```sh
sudo apt install xvfb xfwm4 dbus-daemon xdotool feh x11-xserver-utils ffmpeg pngquant optipng bibata-cursor-theme
Xvfb :21 -screen 0 2880x1800x24 -nolisten tcp &
DISPLAY=:21 dbus-run-session -- xfwm4 --display=:21 --compositor=on &

export DISPLAY=:21
node scripts/demo/stage.js
node scripts/demo/record.js
```

Add `--executable=dist/linux-unpacked/ghost-notetaker` to use a packaged build instead of the source tree.
