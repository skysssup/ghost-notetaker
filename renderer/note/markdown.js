'use strict';

/**
 * Tiny Markdown subset → safe HTML.
 * Supports: headings, bold/italic/strikethrough, inline code, fenced code, links,
 * unordered/ordered lists, task checkboxes, paragraphs, blockquotes, horizontal rules.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSpan(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^\w*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer noopener">$1</a>'
  );
  return s;
}

/** Inline Markdown; text inside `code spans` is shown literally. */
function inlineFormat(text) {
  return String(text)
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : formatSpan(part)))
    .join('');
}

function renderMarkdown(src) {
  const lines = String(src || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let codeBuf = [];
  let listType = null; // 'ul' | 'ol' | 'task'
  let listBuf = [];

  function flushList() {
    if (!listType) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    const cls = listType === 'task' ? ' class="task-list"' : '';
    out.push(`<${tag}${cls}>${listBuf.join('')}</${tag}>`);
    listType = null;
    listBuf = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    if (inCode) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        codeBuf.push(line);
      }
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      flushList();
      inCode = true;
      codeBuf = [];
      i += 1;
      continue;
    }

    if (/^(\s*)---+\s*$/.test(line) || /^(\s*)\*\*\*+\s*$/.test(line)) {
      flushList();
      out.push('<hr/>');
      i += 1;
      continue;
    }

    const quote = /^(\s*)>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      const parts = [quote[2]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        const cont = /^(\s*)>\s?(.*)$/.exec(next);
        if (!cont) break;
        parts.push(cont[2]);
        i += 1;
      }
      out.push(`<blockquote>${parts.map(inlineFormat).join('<br/>')}</blockquote>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      if (listType && listType !== 'task') flushList();
      listType = 'task';
      const checked = /x/i.test(task[2]);
      listBuf.push(
        `<li class="task-item" data-task-line="${i}">` +
          `<label><input type="checkbox" class="task-check" ${checked ? 'checked' : ''}/>` +
          `<span>${inlineFormat(task[3])}</span></label></li>`
      );
      i += 1;
      continue;
    }

    const ul = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listBuf.push(`<li>${inlineFormat(ul[2])}</li>`);
      i += 1;
      continue;
    }

    const ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listBuf.push(`<li>${inlineFormat(ol[2])}</li>`);
      i += 1;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushList();
      i += 1;
      continue;
    }

    flushList();
    // paragraph — gather consecutive non-empty non-special lines
    const para = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (/^\s*$/.test(next)) break;
      if (/^#{1,6}\s+/.test(next)) break;
      if (/^```/.test(next)) break;
      if (/^\s*[-*]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      if (/^\s*>\s?/.test(next)) break;
      if (/^\s*---+\s*$/.test(next)) break;
      para.push(next);
      i += 1;
    }
    out.push(`<p>${para.map(inlineFormat).join('<br/>')}</p>`);
  }

  flushList();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
}

/**
 * Toggle checkbox at a given source line index. Returns new markdown source.
 */
function toggleTaskAtLine(src, lineIndex) {
  const lines = String(src || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return src;
  const line = lines[lineIndex];
  const marker = /^(\s*[-*]\s+\[)([ xX])\]/.exec(line);
  if (!marker) return src;
  lines[lineIndex] = `${marker[1]}${marker[2] === ' ' ? 'x' : ' '}]${line.slice(marker[0].length)}`;
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMarkdown, toggleTaskAtLine, escapeHtml, inlineFormat };
}

if (typeof window !== 'undefined') {
  window.GhostMarkdown = { renderMarkdown, toggleTaskAtLine };
}
