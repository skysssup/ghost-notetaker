'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, toggleTaskAtLine, lineOffset } = require('../renderer/note/markdown');

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

  it('shows code spans literally instead of formatting inside them', () => {
    const html = renderMarkdown('Use `a*b*c` and `[x](https://e.com)` but **bold** works');
    assert.match(html, /<code>a\*b\*c<\/code>/);
    assert.match(html, /<code>\[x\]\(https:\/\/e\.com\)<\/code>/);
    assert.doesNotMatch(html, /<a /);
    assert.match(html, /<strong>bold<\/strong>/);
  });

  it('toggles the task marker, not brackets inside the task text', () => {
    assert.equal(toggleTaskAtLine('- [x] keep [ ] text', 0), '- [ ] keep [ ] text');
    assert.equal(toggleTaskAtLine('  * [ ] nested', 0), '  * [x] nested');
    assert.equal(toggleTaskAtLine('not a task [ ]', 0), 'not a task [ ]');
  });

  it('only links http and https URLs', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](file:///etc/passwd) [c](https://ok.example)');
    assert.equal((html.match(/<a /g) || []).length, 1);
    assert.match(html, /href="https:\/\/ok\.example"/);
  });

  it('renders strikethrough', () => {
    const html = renderMarkdown('gone ~~old~~ stay');
    assert.match(html, /<del>old<\/del>/);
    assert.match(html, /gone/);
    assert.match(html, /stay/);
  });
  it('renders tables with column alignment and escapes cell text', () => {
    const html = renderMarkdown('| Step | Time |\n| :-- | --: |\n| Intro | 2 <b>min</b> |');
    assert.match(html, /<table><thead><tr><th>Step<\/th><th style="text-align:right">Time<\/th><\/tr><\/thead>/);
    assert.match(html, /<td>Intro<\/td><td style="text-align:right">2 &lt;b&gt;min&lt;\/b&gt;<\/td>/);
  });

  it('renders nested and numbered lists with their depth and start number', () => {
    const html = renderMarkdown('- one\n  - two\n    - three\n\n3. third\n4. fourth');
    assert.match(html, /<li data-line="0">one<\/li><li class="depth-1" data-line="1">two<\/li><li class="depth-2" data-line="2">three<\/li>/);
    assert.match(html, /<ol start="3"><li data-line="4">third<\/li>/);
  });

  it('shows only images stored with the note; remote and file images stay links or text', () => {
    const html = renderMarkdown(
      '![shot](ghost-image://img/0123456789abcdef.png) ![remote](https://example.com/a.png) ![file](file:///etc/passwd)'
    );
    assert.match(html, /<img src="ghost-image:\/\/img\/0123456789abcdef\.png" alt="shot"/);
    assert.equal((html.match(/<img /g) || []).length, 1);
    assert.match(html, /<a href="https:\/\/example\.com\/a\.png"/);
    assert.match(html, /!\[file\]\(file:\/\/\/etc\/passwd\)/);
    const evil = renderMarkdown('![" onerror="alert(1)](ghost-image://img/0123456789abcdef.png)');
    assert.match(evil, /alt="&quot; onerror=&quot;alert\(1\)"/);
  });

  it('marks each block with its source line so a click can place the caret there', () => {
    const src = '# Title\n\nSome text\n\n- [ ] task';
    const html = renderMarkdown(src);
    assert.ok(html.indexOf('<!--L0-->') < html.indexOf('<h1>'));
    assert.ok(html.includes('<!--L2--><p>'));
    assert.ok(html.includes('<!--L4-->'));
    assert.equal(lineOffset(src, 2), src.indexOf('Some text'));
    assert.equal(lineOffset(src, 99), src.length);
  });
});
