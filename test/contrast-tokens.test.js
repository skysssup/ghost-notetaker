'use strict';

// More contrast (prefers-contrast: more) may only make inks stronger. The
// secondary paper inks are the full inks by default, so the contrast block must
// not override them with a translucent (lighter) value.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'tokens.css'), 'utf8');

function block(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `${header} exists`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${header} is not closed`);
}

const alpha = (value) => {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(value);
  return m ? Number(m[1]) : 1;
};

describe('more-contrast tokens', () => {
  const root = block(css, ':root {');
  const more = block(css, '@media (prefers-contrast: more)');
  const decl = (src, name) => {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(src);
    return m && m[1].trim();
  };

  it('secondary paper inks are the full inks by default', () => {
    assert.equal(decl(root, '--paper-ink-secondary'), 'var(--paper-ink)');
    assert.equal(decl(root, '--paper-ink-light-secondary'), 'var(--paper-ink-light)');
  });

  it('more contrast does not make the secondary paper inks lighter', () => {
    for (const name of ['--paper-ink-secondary', '--paper-ink-light-secondary']) {
      const value = decl(more, name);
      if (value === null) continue; // falls back to the full ink
      assert.ok(alpha(value) >= 1, `${name} under more contrast is ${value}`);
    }
  });

  it('more contrast never lowers a paper ink alpha below its default', () => {
    for (const [, name, value] of more.matchAll(/(--paper-ink[\w-]*):\s*([^;]+);/g)) {
      const base = decl(root, name);
      if (!base || !base.startsWith('rgba')) continue;
      assert.ok(alpha(value) >= alpha(base), `${name}: ${value} is weaker than ${base}`);
    }
  });
});
