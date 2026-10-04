# Demo assets

Scripts that make the README screenshots and the demo GIF/MP4. Every note, person, number and the Kestrel app in them are made up.

| File | What it does |
| --- | --- |
| `seed.js` | Writes a Ghost Notetaker profile with sample notes. Scenarios: `manager`, `desktop`, `demo`. |
| `desktop.html` | Sample slide ("Q3 roadmap review") the notes float over. Sizes scale with the window. |
| `chart.html` | Sample bar chart. Seeded notes show it, and the demo pastes it from the clipboard. |
| `render-main.js` | Minimal Electron entry that `lib.js` uses to render the HTML files to PNG. |
| `lib.js` | Shared helpers: `renderHtml`, `xdo`, `sleep`, `arg`, `DEMO_OUT`. |
| `stage.js` | Takes the four README screenshots. |
| `record.js` | Drives the app with real X11 input over the slide and records the demo: `capture.mkv` and `events.json`. |
| `compose.js` | Turns the recording into `notes.gif` and `notes.mp4`. |

## Environment

Linux with X11 (tested on Ubuntu 24.04). Install the tools:

```sh
sudo apt install xvfb xfwm4 dbus-daemon xdotool xclip feh x11-xserver-utils ffmpeg pngquant optipng fonts-noto-core
```

Start a 4K virtual screen on display `:21` with a compositing window manager (the notes are transparent windows):

```sh
Xvfb :21 -screen 0 3840x2160x24 -nolisten tcp &
DISPLAY=:21 dbus-run-session -- xfwm4 --display=:21 --compositor=on &
```

The app runs with `--force-device-scale-factor=2`, so one logical pixel is two screen pixels. The scripts use the display in `DISPLAY` (`:21` when it is unset); `record.js` and `compose.js` also take `--display=:N`.

`record.js` sets up the desktop itself: `xsetroot -solid '#e9e7e3'` for the root and the slide in a borderless `feh` window. The slide must be a real window, because under xfwm4 clicking a `feh --bg-fill` root background does not take focus away from a note, and a note only switches to formatted Markdown when it loses focus.

## Build

```sh
npx electron-builder --linux dir --publish never
```

This writes `dist/linux-unpacked/ghost-notetaker`.

## Run

```sh
export DISPLAY=:21
node scripts/demo/stage.js --executable=dist/linux-unpacked/ghost-notetaker
node scripts/demo/record.js --executable=dist/linux-unpacked/ghost-notetaker
node scripts/demo/compose.js
```

`stage.js` writes the screenshots to `docs/screenshots`. Without `--executable`, `stage.js` and `record.js` run the source tree (`record.js --app=DIR` picks another checkout). `record.js` and `compose.js` work in `dist/demo` unless you pass `--out=DIR`:

- `capture.mkv`: lossless FFV1 capture of the 1200x750 logical region (2400x1500 screen pixels) at logical (360, 165), 15 fps.
- `events.json`: every pointer position, mouse down, mouse up and click, the beat boundaries and the sync flashes, with wall-clock times.
- `frames/`: the composed 1000x624 frames (`capture-frames/` holds the decoded capture).
- `notes.gif` (15 fps, or 12 fps if needed to stay under 3 MB) and `notes.mp4` (H.264, yuv420p, faststart).

The README shows `docs/demo/notes.gif`; copy the new `notes.gif` there.

`compose.js` prints the duration, frame rate, size and byte count of both files. It fails if the GIF is over 3 MB or the demo is not 15 to 18 s long.

## How the recording works

ffmpeg captures with `-draw_mouse 0`, so the video has no cursor. `compose.js` draws the pointer and the click rings afterwards from the positions recorded in `events.json`, then adds the beat 3 zoom and caption and downscales each frame to 1000 px wide with a Lanczos filter.

Frames and events are matched by wall-clock time: ffmpeg keeps each frame's grab time (`-copyts`) and `record.js` logs events on the same clock. Before beat 1, `record.js` raises a small magenta square above the slide eight times, each at a different point of the frame grid. `compose.js` finds the flashes in the frames to check that the two clocks agree and to measure how late window changes reach the screen (60 to 130 ms with xfwm4 on Xvfb, different on every run). It uses that delay to time the end hold.

A dragged bubble lags further behind the pointer, so `record.js` also logs the window's own moves, and `compose.js` draws the pointer wherever each frame shows the bubble along that path.
