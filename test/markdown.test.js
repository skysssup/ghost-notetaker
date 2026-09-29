'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, toggleTaskAtLine } = require('../renderer/note/markdown');

describe('markdown', () => {
  it('renders headings and emphasis', () => {
    const html = renderMarkdown('# Hello\n\nThis is **bold** and *italic*.');
    assert.match(html, /<h1>Hello<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
  });

  it('renders task lists with line indices', () => {
    const src = '- [ ] one\n- [x] two';
    const html = renderMarkdown(src);
    assert.match(html, /task-list/);
    assert.match(html, /data-task-line="0"/);
    assert.match(html, /checked/);
  });

  it('toggles checkboxes in source', () => {
    const src = '- [ ] one\n- [x] two';
    const next = toggleTaskAtLine(src, 0);
    assert.match(next.split('\n')[0], /\[x\]/);
    const back = toggleTaskAtLine(next, 1);
    assert.match(back.split('\n')[1], /\[ \]/);
  });

  it('escapes raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });


  it('renders blockquotes', () => {
    const html = renderMarkdown('> spoken line\n> second');
    assert.match(html, /<blockquote>/);
    assert.match(html, /spoken line/);
    assert.match(html, /<br\/>/);
  });

  it('renders fenced code', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    assert.match(html, /<pre><code>const x = 1;/);
  });

  it('renders strikethrough', () => {
    const html = renderMarkdown('gone ~~old~~ stay');
    assert.match(html, /<del>old<\/del>/);
    assert.match(html, /gone/);
    assert.match(html, /stay/);
  });
});
