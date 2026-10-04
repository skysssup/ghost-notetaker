'use strict';

// Turns record.js output into notes.gif and notes.mp4. In JS with pngjs, each
// captured frame gets the pointer and click rings drawn from events.json, the
// beat 3 zoom and caption, and a Lanczos-3 downscale to 1000 px wide; ffmpeg
// only decodes the capture and encodes the results. Frames and events share
// the wall clock, which the sync flashes check; while a bubble is dragged, the
// pointer is drawn where each frame shows the bubble.
//
//   DISPLAY=:21 node scripts/demo/compose.js [--out=DIR] [--display=:N]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const { renderHtml, arg, DEMO_OUT } = require('./lib');

const outDir = path.resolve(arg('out', DEMO_OUT));
process.env.DISPLAY = arg('display', process.env.DISPLAY || ':21');

const OUT_W = 1000;
const OUT_H = 624;
const ZOOM = 1.6;
const ZOOM_EASE_MS = 350;
const END_HOLD_MS = 1500;
const RING = { ms: 400, from: 8, to: 34, width: 2, color: [0x15, 0x70, 0xd1], alpha: 0.9 };
const ARROW = [[0, 0], [0, 19.1], [4.4, 15], [7.45, 22], [10.36, 20.84], [7.45, 13.97], [13.5, 13.97]];
const ARROW_OUTLINE = 1.4;
const INK = [0x1d, 0x1a, 0x15];
const WHITE = [255, 255, 255];
const CAPTION = { text: 'Click away: formatted', margin: 16 };
const FONT_UI =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Adwaita Sans', Cantarell, " +
  "'Noto Sans', system-ui, sans-serif";
const DRAG = { searchMs: 300, templateRadius: 16 };
const GIF_MAX_BYTES = 3e6;
const LENGTH_S = [15, 18];

const run = (cmd, args) => execFileSync(cmd, args.map(String), { encoding: 'utf8', maxBuffer: 1 << 26 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;
const frameName = (i) => `${String(i).padStart(5, '0')}.png`;
const pixel = (img, x, y) => (clamp(Math.round(y), 0, img.height - 1) * img.width + clamp(Math.round(x), 0, img.width - 1)) * 4;

/** Position at time t, interpolated between timed samples and held before the first and after the last. */
const track = (samples) => (t) => {
  const i = samples.findLastIndex((e) => e.t <= t);
  const [a, b] = [samples[Math.max(0, i)], samples[i + 1]];
  if (i < 0 || !b) return a;
  const k = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
};

/** Decode the capture to PNGs; `pts` holds each frame's wall-clock grab time in ms. */
function decodeCapture(file, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = path.join(dir, '%05d.png');
  run('ffmpeg', ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-start_number', 0, '-compression_level', 1, frames]);
  const probe = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file];
  const pts = run('ffprobe', probe).trim().split('\n').map((s) => Number(s) * 1000);
  const count = fs.readdirSync(dir).length;
  if (count !== pts.length) throw new Error(`Decoded ${count} frames but the capture has ${pts.length}`);
  return { pts, read: (i) => PNG.sync.read(fs.readFileSync(path.join(dir, frameName(i)))) };
}

/**
 * How late window moves reach the screen: each sync flash edge (a window
 * raise) shows up between two frames, which bounds its delay. The flashes sit
 * at different phases of the frame grid, so the delay most edges agree on is
 * pinned down to a few ms; a stray edge (a late repaint) is outvoted.
 */
function measureWindowLatency({ sync }, capture, until) {
  const shows = [];
  for (let i = 0; capture.pts[i] < until; i++) {
    const img = capture.read(i);
    const at = pixel(img, sync.x + sync.width / 2, sync.y + sync.height / 2);
    shows.push(sync.color.every((c, k) => Math.abs(img.data[at + k] - c) < 40));
  }
  const runs = [];
  shows.forEach((on, i) => {
    if (on && !shows[i - 1]) runs.push([i, i]);
    else if (on) runs[runs.length - 1][1] = i;
  });
  if (runs.length !== sync.flashes.length || runs[0][0] === 0) {
    throw new Error(`Expected ${sync.flashes.length} sync flashes after the first frame, found ${runs.length}`);
  }
  const bounds = runs.flatMap(([a, b], k) => [
    [capture.pts[a - 1] - sync.flashes[k].on, capture.pts[a] - sync.flashes[k].on],
    [capture.pts[b] - sync.flashes[k].off, capture.pts[b + 1] - sync.flashes[k].off]
  ]);
  const ends = bounds.flatMap(([lo, hi]) => [[lo, 1], [hi, -1]]).sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  let depth = 0;
  let best = { depth: 0 };
  ends.forEach(([t, step], i) => {
    depth += step;
    if (depth > best.depth) best = { depth, lo: t, hi: ends[i + 1][0] };
  });
  const latency = (best.lo + best.hi) / 2;
  if (best.depth < bounds.length * 0.75) {
    throw new Error(`Only ${best.depth} of ${bounds.length} sync flash edges agree on the window latency`);
  }
  if (latency < 0 || latency > 250) {
    throw new Error(`Capture and event clocks disagree: the sync flashes put the window latency at ${latency.toFixed(0)} ms`);
  }
  return { ...best, latency, edges: bounds.length, end: runs[runs.length - 1][1] + 1 };
}

/** RGB of the pixels within `radius` of (x, y), with their offsets: a template to find a dragged window by. */
function disc(img, { x, y }, radius) {
  const samples = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = pixel(img, x + dx, y + dy);
      samples.push([dx, dy, img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  return samples;
}

/** Mean RGB difference between a disc template and the image around (x, y). */
function mismatch(img, template, { x, y }) {
  let sum = 0;
  for (const [dx, dy, r, g, b] of template) {
    const i = pixel(img, x + dx, y + dy);
    sum += Math.abs(img.data[i] - r) + Math.abs(img.data[i + 1] - g) + Math.abs(img.data[i + 2] - b);
  }
  return sum / template.length;
}

function blend(data, i, color, a) {
  for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] + (color[k] - data[i + k]) * a);
}

/** Signed distance from (x, y) to a polygon's outline, negative inside. */
function signedDistance(poly, x, y) {
  let min = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const k = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    min = Math.min(min, Math.hypot(x - ax - k * dx, y - ay - k * dy));
    if (ay > y !== by > y && x < ax + ((y - ay) * dx) / dy) inside = !inside;
  }
  return inside ? -min : min;
}

/** Visit the pixels of a box, clipped to the image, with their centers. */
function eachPixel(img, x0, y0, x1, y1, fn) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
      fn((y * img.width + x) * 4, x + 0.5, y + 0.5);
    }
  }
}

/** White arrow with a dark outline, tip at (x, y); `s` is capture px per logical px. */
function drawPointer(img, { x, y }, s) {
  const poly = ARROW.map(([px, py]) => [x + px * s, y + py * s]);
  const stroke = ARROW_OUTLINE * s;
  eachPixel(img, x - 2, y - 2, x + 14 * s + 2, y + 22 * s + 2, (i, px, py) => {
    const d = signedDistance(poly, px, py);
    if (d >= 0.5) return;
    blend(img.data, i, INK, clamp(0.5 - d, 0, 1));
    blend(img.data, i, WHITE, clamp(0.5 - d - stroke, 0, 1));
  });
}

/** Accent ring growing from RING.from to RING.to logical px across and fading out. */
function drawRing(img, { x, y }, k, s) {
  const outer = ((RING.from + (RING.to - RING.from) * easeOut(k)) * s) / 2;
  const half = (RING.width * s) / 2;
  const alpha = RING.alpha * (1 - k * k);
  eachPixel(img, x - outer - 1, y - outer - 1, x + outer + 1, y + outer + 1, (i, px, py) => {
    const d = Math.abs(Math.hypot(px - x, py - y) - (outer - half));
    blend(img.data, i, RING.color, clamp(half + 0.5 - d, 0, 1) * alpha);
  });
}

const lanczos3 = (x) => {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** Lanczos-3 taps for `count` outputs spanning [start, start + count * step) of a `size`-sample axis. */
function taps(count, start, step, size) {
  const scale = Math.max(1, step);
  const first = new Int32Array(count);
  const weights = [];
  for (let i = 0; i < count; i++) {
    const c = start + (i + 0.5) * step - 0.5;
    const lo = Math.max(0, Math.ceil(c - 3 * scale));
    const hi = Math.min(size - 1, Math.floor(c + 3 * scale));
    const w = new Float32Array(hi - lo + 1);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += w[j - lo] = lanczos3((j - c) / scale);
    for (let j = 0; j < w.length; j++) w[j] /= sum;
    first[i] = lo;
    weights.push(w);
  }
  return { first, weights };
}

/** Resample the `view` rect of an RGBA image to outW x outH (separable Lanczos-3). */
function resample(img, view, outW, outH) {
  const xs = taps(outW, view.x, view.width / outW, img.width);
  const ys = taps(outH, view.y, view.height / outH, img.height);
  const rowLo = ys.first[0];
  const rowHi = ys.first[outH - 1] + ys.weights[outH - 1].length - 1;
  const rows = new Float32Array((rowHi - rowLo + 1) * outW * 3);
  for (let y = rowLo; y <= rowHi; y++) {
    const src = y * img.width * 4;
    for (let x = 0, t = (y - rowLo) * outW * 3; x < outW; x++, t += 3) {
      const w = xs.weights[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0, p = src + xs.first[x] * 4; k < w.length; k++, p += 4) {
        r += img.data[p] * w[k];
        g += img.data[p + 1] * w[k];
        b += img.data[p + 2] * w[k];
      }
      rows[t] = r;
      rows[t + 1] = g;
      rows[t + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const w = ys.weights[y];
    const base = (ys.first[y] - rowLo) * outW * 3;
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0, t = base + x * 3; k < w.length; k++, t += outW * 3) {
        r += rows[t] * w[k];
        g += rows[t + 1] * w[k];
        b += rows[t + 2] * w[k];
      }
      const o = (y * outW + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width: outW, height: outH, data: Buffer.from(out.buffer) };
}

/**
 * Render the caption tag at its final pixel size, once over black and once
 * over white, and recover its exact alpha from the difference.
 */
async function renderCaption(dir) {
  const layers = [];
  for (const bg of ['black', 'white']) {
    const html = path.join(dir, `caption-${bg}.html`);
    fs.writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${bg}}span{display:inline-block;margin:2px;` +
        'padding:5px 10px;border:1px solid rgba(0,0,0,.08);border-radius:8px;background:#fdfcf9 padding-box;color:#1d1a15;' +
        `font:500 13px/18px ${FONT_UI}}</style><span>${CAPTION.text}</span>`
    );
    const png = html.replace(/html$/, 'png');
    await renderHtml(path.relative(__dirname, html), { width: 320, height: 40, scale: 1, out: png });
    layers.push(PNG.sync.read(fs.readFileSync(png)));
  }
  const [black, white] = layers;
  const alphaAt = (i) => 1 - [0, 1, 2].reduce((sum, k) => sum + white.data[i + k] - black.data[i + k], 0) / 765;
  let [x0, y0, x1, y1] = [black.width, black.height, 0, 0];
  for (let y = 0; y < black.height; y++) {
    for (let x = 0; x < black.width; x++) {
      if (alphaAt((y * black.width + x) * 4) < 0.004) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    }
  }
  const tag = { width: x1 - x0, height: y1 - y0 };
  tag.alpha = new Float32Array(tag.width * tag.height);
  tag.color = new Float32Array(tag.width * tag.height * 3);
  for (let y = 0; y < tag.height; y++) {
    for (let x = 0; x < tag.width; x++) {
      const i = ((y + y0) * black.width + x + x0) * 4;
      const j = y * tag.width + x;
      tag.alpha[j] = alphaAt(i);
      tag.color.set(black.data.subarray(i, i + 3), j * 3);
    }
  }
  return tag;
}

/** Composite the premultiplied caption tag at (x0, y0) with opacity `f`. */
function drawCaption(img, tag, x0, y0, f) {
  for (let y = 0; y < tag.height; y++) {
    for (let x = 0; x < tag.width; x++) {
      const j = y * tag.width + x;
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      for (let k = 0; k < 3; k++) {
        img.data[i + k] = Math.round(img.data[i + k] * (1 - tag.alpha[j] * f) + tag.color[j * 3 + k] * f);
      }
    }
  }
}

/** Source rect at zoom progress p: the full width at p = 0, 1/ZOOM of it around the note at p = 1. */
function viewAt(p, note, width, height) {
  const fullH = (width * OUT_H) / OUT_W;
  const w = width / ZOOM;
  const h = fullH / ZOOM;
  const x = clamp(note.x + note.width / 2 - w / 2, 0, width - w);
  const y = clamp(note.y + note.height / 2 - h / 2, 0, height - h);
  return { x: x * p, y: y * p, width: width + (w - width) * p, height: fullH + (h - fullH) * p };
}

function probe(file) {
  const entries = 'stream=width,height,nb_read_frames:format=duration';
  const args = ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'json', file];
  const info = JSON.parse(run('ffprobe', args));
  const { width, height, nb_read_frames: frames } = info.streams[0];
  const duration = Number(info.format.duration);
  return { file, width, height, duration, fps: Number(frames) / duration, bytes: fs.statSync(file).size };
}

function encode(framesDir) {
  const input = ['-v', 'error', '-y', '-framerate', 15, '-i', path.join(framesDir, '%05d.png')];
  const mp4 = path.join(outDir, 'notes.mp4');
  const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  run('ffmpeg', [...input, '-vf', 'scale=out_color_matrix=bt709', '-c:v', 'libx264', '-preset', 'slow', '-crf', 18, '-pix_fmt', 'yuv420p',
    ...bt709, '-movflags', '+faststart', mp4]);
  const gif = path.join(outDir, 'notes.gif');
  for (const fps of [15, 12]) {
    const palette = `fps=${fps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
    run('ffmpeg', [...input, '-vf', palette, '-loop', 0, gif]);
    if (fs.statSync(gif).size <= GIF_MAX_BYTES) break;
  }
  return [probe(gif), probe(mp4)];
}

async function compose() {
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'events.json'), 'utf8'));
  const capture = decodeCapture(path.join(outDir, meta.capture), path.join(outDir, 'capture-frames'));
  const beatAt = (n) => meta.events.find((e) => e.type === 'beat' && e.n === n).t;
  const sync = measureWindowLatency(meta, capture, beatAt(1));
  const { pts } = capture;
  const first = pts.findIndex((t) => t >= beatAt(1));
  const end = meta.events.find((e) => e.type === 'restored').t + sync.latency + END_HOLD_MS;
  if (first < sync.end) throw new Error('A sync flash is still on screen when beat 1 starts');
  if (pts[pts.length - 1] < end - 500 / meta.fps) throw new Error('The capture stops before the end hold is over');

  const pointerAt = track(meta.events.filter((e) => 'x' in e && e.type !== 'drag'));
  const drags = meta.events
    .filter((e) => e.type === 'down')
    .map((down) => {
      const up = meta.events.find((e) => e.type === 'up' && e.t > down.t);
      const moves = meta.events.filter((e) => e.type === 'drag' && e.t > down.t && e.t < up.t + DRAG.searchMs);
      if (!moves.length) throw new Error('A pressed window never moved, so there is no drag to follow');
      const pressed = capture.read(pts.findLastIndex((t) => t <= moves[0].t));
      const template = disc(pressed, down, DRAG.templateRadius * meta.scale);
      return { from: down.t, to: up.t + DRAG.searchMs, path: track([down, ...moves]), template };
    });
  const drawnPointerAt = (t, frame) => {
    const drag = drags.find((d) => t >= d.from && t <= d.to);
    if (!drag) return pointerAt(t);
    const scored = [];
    for (let lag = 0; lag <= DRAG.searchMs; lag += 5) {
      const p = drag.path(t - lag);
      scored.push([mismatch(frame, drag.template, p), p]);
    }
    return scored.reduce((best, s) => (s[0] < best[0] ? s : best))[1];
  };
  const rings = meta.events.filter((e) => e.type === 'click' || e.type === 'down');
  const zoomFrom = meta.events.find((e) => e.type === 'click' && e.t > beatAt(3)).t;
  const zoomTo = beatAt(4);
  const zoomAt = (t) => easeInOut(clamp(Math.min((t - zoomFrom) / ZOOM_EASE_MS, (zoomTo - t) / ZOOM_EASE_MS), 0, 1));

  const tag = await renderCaption(outDir);
  const framesDir = path.join(outDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);
  let source = first;
  let decoded = null;
  let held = 0;
  const count = Math.floor(((end - pts[first]) * meta.fps) / 1000) + 1;
  for (let n = 0; n < count; n++) {
    const t = pts[first] + (n * 1000) / meta.fps;
    const before = source;
    while (source + 1 < pts.length && Math.abs(pts[source + 1] - t) <= Math.abs(pts[source] - t)) source++;
    if (n > 0 && source === before) held++;
    if (!decoded || decoded.index !== source) decoded = { index: source, png: capture.read(source) };
    const img = { width: decoded.png.width, height: decoded.png.height, data: Buffer.from(decoded.png.data) };
    for (const ring of rings) {
      const k = (t - ring.t) / RING.ms;
      if (k >= 0 && k < 1) drawRing(img, ring, k, meta.scale);
    }
    drawPointer(img, drawnPointerAt(pts[source], decoded.png), meta.scale);
    const p = zoomAt(t);
    const out = resample(img, viewAt(p, meta.newNote, img.width, img.height), OUT_W, OUT_H);
    if (p > 0) drawCaption(out, tag, CAPTION.margin, OUT_H - CAPTION.margin - tag.height, p);
    fs.writeFileSync(path.join(framesDir, frameName(n)), PNG.sync.write(out, { colorType: 2, deflateLevel: 3 }));
  }
  const { latency, depth, edges, lo, hi } = sync;
  console.log(`Composed ${count} frames from capture frames ${first}-${source} (${held} held for a missing capture frame).`);
  console.log(`Window latency ${latency.toFixed(0)} ms (${depth} of ${edges} sync flash edges agree on ${lo.toFixed(0)}-${hi.toFixed(0)} ms).`);

  const results = encode(framesDir);
  for (const r of results) {
    const size = `${(r.bytes / 1e6).toFixed(2)} MB (${r.bytes} bytes)`;
    console.log(`${r.file}: ${r.duration.toFixed(2)} s, ${r.fps.toFixed(2)} fps, ${r.width}x${r.height}, ${size}`);
  }
  const [gif] = results;
  if (gif.bytes > GIF_MAX_BYTES) throw new Error(`notes.gif is ${(gif.bytes / 1e6).toFixed(2)} MB, over the 3 MB limit even at 12 fps`);
  for (const r of results) {
    if (r.duration < LENGTH_S[0] || r.duration > LENGTH_S[1]) {
      throw new Error(`${path.basename(r.file)} is ${r.duration.toFixed(2)} s long, outside ${LENGTH_S.join('-')} s`);
    }
  }
}

compose().catch((err) => {
  console.error(err);
  process.exit(1);
});
