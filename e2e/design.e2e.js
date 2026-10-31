'use strict';

// The v3 look: things a reviewer would check by eye, pinned so they stay true.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launch, waitFor, waitForStore, firstNote, noteIdOf, noteWindow, openManager, startEditing } = require('./helpers');

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

async function start(opts) {
  const ctx = await launch(opts);
  running.push(ctx.app);
  ctx.note = await firstNote(ctx.app);
  return ctx;
}

async function sizeWindow(app, noteId, width, height) {
  await app.evaluate(({ BrowserWindow }, a) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`id=${a.noteId}`));
    win.setSize(a.width, a.height);
  }, { noteId, width, height });
}

describe('v3 design', () => {
  it('the Notes Manager paints no gradients, blur, glass or looping animation', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    const bad = await manager.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((el) => {
          const s = getComputedStyle(el);
          const hits = [];
          if (s.backgroundImage.includes('gradient')) hits.push('gradient');
          if (s.backdropFilter && s.backdropFilter !== 'none') hits.push('backdrop-filter');
          if (s.filter && s.filter !== 'none') hits.push('filter');
          if (s.animationIterationCount.includes('infinite') && s.animationName !== 'none') hits.push('infinite');
          return hits.length ? `${el.tagName.toLowerCase()}.${el.className}: ${hits.join(',')}` : null;
        })
        .filter(Boolean)
    );
    assert.deepEqual(bad, []);
  });

  it('list previews separate a note\'s lines with " · " and drop list and task markers', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.evaluate(() =>
      window.ghostManager.createNote({ title: 'Weekend', content: 'Saturday\n- [ ] Farmers market\n- Bike to the lake\n\n1. Sunday: brunch at 11' })
    );
    const card = manager.locator('#noteList .note-card', { hasText: 'Weekend' });
    await card.waitFor();
    assert.equal(await card.locator('.note-snippet').textContent(), 'Saturday · Farmers market · Bike to the lake · Sunday: brunch at 11');
  });

  it('list previews keep hyphens inside words and never end in a dangling separator', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    const long = Array.from({ length: 40 }, (_, i) => `- item-${i} blue-otter-42`).join('\n');
    await manager.evaluate((content) => window.ghostManager.createNote({ title: 'Wifi', content: `Network: blue-otter-42\n- re-check the router\n${content}` }), long);
    const card = manager.locator('#noteList .note-card', { hasText: 'Wifi' });
    await card.waitFor();
    const text = await card.locator('.note-snippet').textContent();
    assert.ok(text.startsWith('Network: blue-otter-42 · re-check the router · item-0 blue-otter-42'), text);
    assert.ok(text.length <= 300, `at most 300 characters (${text.length})`);
    assert.doesNotMatch(text, /[·\s]$/, `no trailing separator: …${JSON.stringify(text.slice(-30))}`);
  });

  it('with more contrast every paper keeps a note edge of at least 3:1', async () => {
    const ctx = await start();
    const papers = [...fs.readFileSync(require.resolve('../main/store.js'), 'utf8').matchAll(/id: '(\w+)', hex: '(#[0-9a-f]{6})'.*?ink: '(\w+)'/g)].map((m) => ({ id: m[1], hex: m[2], ink: m[3] }));
    assert.equal(papers.length, 12);
    await ctx.note.emulateMedia({ contrast: 'more' });
    const ratios = await ctx.note.evaluate((list) => {
      const shell = document.querySelector('.shell');
      const rgba = (v) => {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = v;
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data];
      };
      const lum = (rgb) => {
        const l = rgb.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      };
      const was = shell.classList.contains('ink-light');
      const out = {};
      for (const p of list) {
        shell.classList.toggle('ink-light', p.ink === 'light');
        const e = rgba(getComputedStyle(shell).getPropertyValue('--paper-edge').trim());
        const paper = rgba(p.hex);
        const a = e[3] / 255;
        const edge = [0, 1, 2].map((i) => e[i] * a + paper[i] * (1 - a));
        const [hi, lo] = [lum(edge), lum(paper)].sort((x, y) => y - x);
        out[p.id] = +((hi + 0.05) / (lo + 0.05)).toFixed(2);
      }
      shell.classList.toggle('ink-light', was);
      return { hc: matchMedia('(prefers-contrast: more)').matches, out };
    }, papers);
    assert.equal(ratios.hc, true, 'prefers-contrast: more is on');
    for (const [id, r] of Object.entries(ratios.out)) assert.ok(r >= 3, `${id} edge ${r}:1`);
  });

  it('list previews drop paired ** and __ markers and keep words with underscores', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.evaluate(() =>
      window.ghostManager.createNote({ title: 'Marks', content: '__bold__ and **strong** and _it_ and *em*\nsnake_case_name 2*3 __init__.py' })
    );
    const card = manager.locator('#noteList .note-card', { hasText: 'Marks' });
    await card.waitFor();
    const text = await card.locator('.note-snippet').textContent();
    assert.equal(text, 'bold and strong and it and em · snake_case_name 2*3 init.py');
  });

  it('list previews keep a "*" inside words and strip ***both*** markers', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.evaluate(() =>
      window.ghostManager.createNote({ title: 'Sums', content: '2*3*4 = 24\n***both*** and a*b and c*d\n**bold**, *it* and snake_case' })
    );
    const card = manager.locator('#noteList .note-card', { hasText: 'Sums' });
    await card.waitFor();
    const text = await card.locator('.note-snippet').textContent();
    assert.equal(text, '2*3*4 = 24 · both and a*b and c*d · bold, it and snake_case');
  });

  it('with more contrast note body text keeps the full ink (APCA Lc 75, 4.5:1 on every paper)', async () => {
    const ctx = await start();
    const papers = [...fs.readFileSync(require.resolve('../main/store.js'), 'utf8').matchAll(/id: '(\w+)', hex: '(#[0-9a-f]{6})'.*?ink: '(\w+)'/g)].map((m) => ({ id: m[1], hex: m[2], ink: m[3] }));
    assert.equal(papers.length, 12);
    const measure = () =>
      ctx.note.evaluate((list) => {
        const shell = document.querySelector('.shell');
        const rgba = (v) => {
          const c = document.createElement('canvas').getContext('2d');
          c.fillStyle = v;
          c.fillRect(0, 0, 1, 1);
          return [...c.getImageData(0, 0, 1, 1).data];
        };
        const lum = (rgb) => {
          const l = rgb.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
        };
        // APCA 0.0.98G-4g (W3C silver), |Lc| of text on background.
        const apca = (txt, bg) => {
          const y = (rgb) => {
            const v = 0.2126729 * (rgb[0] / 255) ** 2.4 + 0.7151522 * (rgb[1] / 255) ** 2.4 + 0.072175 * (rgb[2] / 255) ** 2.4;
            return v < 0.022 ? v + (0.022 - v) ** 1.414 : v;
          };
          const yt = y(txt);
          const yb = y(bg);
          const c = yb > yt ? (yb ** 0.56 - yt ** 0.57) * 1.14 : (yb ** 0.65 - yt ** 0.62) * 1.14;
          if (Math.abs(c) < 0.1) return 0;
          return Math.abs((c > 0 ? c - 0.027 : c + 0.027) * 100);
        };
        const was = shell.classList.contains('ink-light');
        const out = {};
        for (const p of list) {
          shell.classList.toggle('ink-light', p.ink === 'light');
          const s = getComputedStyle(shell);
          const ink2 = rgba(s.getPropertyValue('--ink-2').trim());
          const ink = rgba(s.getPropertyValue('--ink').trim());
          const paper = rgba(p.hex);
          const a = ink2[3] / 255;
          const text = [0, 1, 2].map((i) => Math.round(ink2[i] * a + paper[i] * (1 - a)));
          const [hi, lo] = [lum(text), lum(paper)].sort((x, y) => y - x);
          out[p.id] = { full: ink2.join() === ink.join(), ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), lc: +apca(text, paper).toFixed(1) };
        }
        shell.classList.toggle('ink-light', was);
        return { hc: matchMedia('(prefers-contrast: more)').matches, out };
      }, papers);
    const normal = await measure();
    await ctx.note.emulateMedia({ contrast: 'more' });
    const more = await measure();
    assert.equal(normal.hc, false);
    assert.equal(more.hc, true, 'prefers-contrast: more is on');
    for (const [id, r] of Object.entries(more.out)) {
      assert.equal(r.full, true, `${id}: body ink is the full ink under more contrast`);
      assert.ok(r.lc >= normal.out[id].lc, `${id}: Lc ${r.lc} is not below the default ${normal.out[id].lc}`);
      assert.ok(r.lc >= 75, `${id}: body Lc ${r.lc}`);
      assert.ok(r.ratio >= 4.5, `${id}: body ${r.ratio}:1`);
    }
  });

  it('the active tag filter chip shows a long tag in full', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.evaluate(() => window.ghostManager.createNote({ title: 'Review', content: 'x', tags: ['infrastructure-review', 'ops'] }));
    const row = manager.locator('.tag-row', { hasText: 'infrastructure-review' });
    await row.waitFor();
    await row.click();
    const chip = manager.locator('#activeTag .tag-pill');
    await chip.waitFor();
    assert.equal(await chip.textContent(), '#infrastructure-review');
    const fits = await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    assert.equal(fits, true, 'the chip is not cut to an ellipsis');
  });

  it('a dark paper in the Trash keeps a light initial', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    await manager.evaluate(async () => {
      const n = await window.ghostManager.createNote({ title: 'Weekend', content: 'x', color: 'teal' });
      await window.ghostManager.trashNote((n && (n.id || (n.note && n.note.id))) || n);
    });
    await manager.click('#btnTrash');
    const dot = manager.locator('#trashList .note-card', { hasText: 'Weekend' }).locator('.paper-dot');
    await dot.waitFor();
    const rgb = (await dot.evaluate((el) => getComputedStyle(el).color)).match(/[\d.]+/g).map(Number);
    assert.ok(rgb[0] + rgb[1] + rgb[2] > 3 * 150, `initial is light on the dark paper (${rgb})`);
  });

  it('workspace dots are by order and wrap after six', async () => {
    const ctx = await start();
    const manager = await openManager(ctx.app);
    for (let i = 2; i <= 7; i++) await manager.evaluate((n) => window.ghostManager.createWorkspace(n), `Space ${i}`);
    await waitFor(async () => (await manager.locator('#wsList .ws-badge').count()) >= 7, 'seven workspaces listed');
    const dots = await manager.locator('#wsList .ws-badge').evaluateAll((els) => els.map((e) => e.dataset.ws));
    assert.deepEqual(dots.slice(0, 7), ['1', '2', '3', '4', '5', '6', '1']);
  });

  it('a note saved at 10px shows at the 12px floor and keeps 10 on disk', async () => {
    const first = await start();
    const id = noteIdOf(first.note);
    await waitForStore(first.dataFile, (s) => s.notes.some((n) => n.id === id), 'note saved');
    await first.app.close();
    running = [];
    const raw = JSON.parse(fs.readFileSync(first.dataFile, 'utf8'));
    raw.notes.find((n) => n.id === id).fontSize = 10;
    fs.writeFileSync(first.dataFile, JSON.stringify(raw));

    const second = await launch({ userDataDir: first.userDataDir });
    running.push(second.app);
    const note = await noteWindow(second.app, id);
    const size = await note.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize);
    assert.equal(size, '12px');
    assert.equal(await note.inputValue('#fontSize'), '12');
    await note.focus('#preview');
    await note.keyboard.press('Enter');
    await note.locator('#editor:not(.hidden)').waitFor();
    await note.fill('#editor', 'edited after the upgrade');
    await waitForStore(
      first.dataFile,
      (s) => s.notes.some((n) => n.id === id && n.content.includes('edited after')),
      'edit saved'
    );
    const stored = JSON.parse(fs.readFileSync(first.dataFile, 'utf8'));
    assert.equal(stored.notes.find((n) => n.id === id).fontSize, 10);
  });

  it('removing a tag from the keyboard leaves focus in the tag row', async () => {
    const ctx = await start();
    const note = ctx.note;
    await note.focus('#tagInput');
    for (const t of ['alpha', 'beta', 'gamma']) {
      await note.keyboard.type(t);
      await note.keyboard.press('Enter');
    }
    await waitFor(async () => (await note.locator('#tagChips .tag').count()) === 3, 'three tags');
    await note.locator('#tagChips .tag').nth(1).focus();
    await note.keyboard.press('Enter');
    await waitFor(async () => (await note.locator('#tagChips .tag').count()) === 2, 'tag removed');
    assert.equal(await note.evaluate(() => document.activeElement.textContent), '#gamma');
    await note.keyboard.press('Enter');
    await waitFor(async () => (await note.locator('#tagChips .tag').count()) === 1, 'last tag removed');
    assert.equal(await note.evaluate(() => document.activeElement.textContent), '#alpha');
    await note.keyboard.press('Enter');
    await waitFor(async () => (await note.locator('#tagChips .tag').count()) === 0, 'no tags');
    assert.equal(await note.evaluate(() => document.activeElement.id), 'tagInput');
  });

  it('a 220x180 note keeps its title, text and controls apart while editing', async () => {
    const ctx = await start();
    const note = ctx.note;
    await sizeWindow(ctx.app, noteIdOf(note), 220, 180);
    await waitFor(async () => (await note.evaluate(() => window.innerWidth)) === 220, 'window at 220px');
    await startEditing(note);
    await note.click('#editor');
    await note.waitForTimeout(400);
    const g = await note.evaluate(() => {
      const r = (id) => document.getElementById(id)?.getBoundingClientRect();
      const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0);
      const editor = r('editor');
      const bar = document.querySelector('.md-toolbar')?.getBoundingClientRect();
      const tags = document.querySelector('.status')?.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        title: r('title').width,
        editorH: editor.height,
        barOver: bar && bar.height ? overlap(bar, editor) : 0,
        tagsOver: tags && tags.height ? overlap(tags, editor) : 0
      };
    });
    assert.equal(g.overflowX, 0, 'no sideways scroll');
    assert.ok(g.title >= 96, `title is at least 96px wide (${g.title})`);
    assert.ok(g.editorH >= 67, `text box is at least 67px tall (${g.editorH})`);
    assert.equal(g.barOver, 0, 'toolbar does not cover the text');
    assert.equal(g.tagsOver, 0, 'tag row does not cover the text');
  });
  it('a 220x180 note shows whole lines only, never half a line above the tags', async () => {
    const ctx = await start();
    const note = ctx.note;
    await sizeWindow(ctx.app, noteIdOf(note), 220, 180);
    await waitFor(async () => (await note.evaluate(() => window.innerWidth)) === 220, 'window at 220px');
    await startEditing(note);
    await note.fill('#editor', Array.from({ length: 30 }, (_, i) => `word${i} runs on`).join(' '));
    await note.keyboard.press('Escape');
    await note.waitForSelector('#preview:not(.hidden)');
    const check = () =>
      note.evaluate(() => {
        const p = document.getElementById('preview');
        const box = p.getBoundingClientRect();
        const body = p.querySelector('.preview-body');
        const m = /inset\(\S+ \S+ ([-\d.]+)px/.exec(body.style.clipPath || '');
        const visible = box.top + p.clientTop + p.clientHeight;
        const shown = m ? Math.min(visible, body.getBoundingClientRect().bottom - parseFloat(m[1])) : visible;
        const range = document.createRange();
        const cut = [];
        for (const t of p.querySelectorAll('p')) {
          range.selectNodeContents(t);
          for (const r of range.getClientRects()) if (r.top < shown - 0.5 && r.bottom > shown + 0.5) cut.push(t.textContent);
        }
        return { cut, clipped: Boolean(m), overflow: p.scrollHeight > p.clientHeight };
      });
    let clippedAny = false;
    for (const scroll of [0, 10, 37]) {
      await note.evaluate((y) => { document.getElementById('preview').scrollTop = y; }, scroll);
      await note.waitForTimeout(150);
      const g = await check();
      assert.ok(g.overflow, 'the text is longer than the note');
      assert.deepEqual(g.cut, [], `no line is cut by the bottom edge (scrolled ${scroll}px)`);
      clippedAny ||= g.clipped;
    }
    assert.ok(clippedAny, 'a partial line was there to clip');
  });

  it('a 220x180 note clipping its last line keeps the formatted view\'s focus ring whole', async () => {
    const { PNG } = require('pngjs');
    for (const theme of ['light', 'dark']) {
      const ctx = await start();
      const note = ctx.note;
      await ctx.app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, theme);
      await sizeWindow(ctx.app, noteIdOf(note), 220, 180);
      await waitFor(async () => (await note.evaluate(() => window.innerWidth)) === 220, 'window at 220px');
      await startEditing(note);
      await note.fill('#editor', Array.from({ length: 30 }, (_, i) => `word${i} runs on`).join(' '));
      await note.keyboard.press('Escape');
      await note.waitForSelector('#preview:focus-visible');
      await note.evaluate(() => { document.getElementById('preview').scrollTop = 10; });
      await note.waitForTimeout(300);
      const g = await note.evaluate(() => {
        const p = document.getElementById('preview');
        const r = p.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, clipped: Boolean(p.querySelector('.preview-body').style.clipPath), ring: (() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(p).outlineColor; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3).join(','); })(), dpr: devicePixelRatio };
      });
      assert.ok(g.clipped, `${theme}: the last line is being clipped`);
      const ring = g.ring.split(',').map(Number);
      const png = PNG.sync.read(await note.screenshot());
      const near = (x, y) => {
        const i = (Math.round(y * g.dpr) * png.width + Math.round(x * g.dpr)) * 4;
        return Math.abs(png.data[i] - ring[0]) + Math.abs(png.data[i + 1] - ring[1]) + Math.abs(png.data[i + 2] - ring[2]) < 60;
      };
      const span = (fn) => { let hit = 0, n = 0; for (let t = 0.2; t <= 0.8; t += 0.05) { n++; if (fn(t)) hit++; } return hit / n; };
      const bottom = span((t) => near(g.x + g.w * t, g.y + g.h - 1));
      const top = span((t) => near(g.x + g.w * t, g.y + 1));
      const left = span((t) => near(g.x + 1, g.y + g.h * t));
      const right = span((t) => near(g.x + g.w - 1, g.y + g.h * t));
      assert.ok(top > 0.9 && bottom > 0.9 && left > 0.9 && right > 0.9, `${theme}: ring on all four sides (top ${top}, right ${right}, bottom ${bottom}, left ${left})`);
      await ctx.app.close();
      running = running.filter((a) => a !== ctx.app);
    }
  });
});
