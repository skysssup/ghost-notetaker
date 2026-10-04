'use strict';

/**
 * Small Markdown subset → safe HTML.
 * Supports headings, bold/italic/strikethrough, inline and fenced code, links,
 * images stored by the app, bullet/numbered/task lists (with indentation),
 * tables, blockquotes, and horizontal rules. Every block is preceded by a
 * comment naming the source line it starts on, and list items carry a
 * data-line attribute, so a click in the preview can place the caret there.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const IMAGE = /!\[([^\]]*)\]\((ghost-image:\/\/img\/[a-f0-9]{16}\.(?:png|jpg|gif|webp))\)/g;

function formatSpan(text) {
  let s = escapeHtml(text);
  s = s.replace(IMAGE, '<img src="$2" alt="$1" loading="lazy" />');
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

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isTableStart(lines, i) {
  return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && TABLE_RULE.test(lines[i + 1]);
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Each block is preceded by a <!--L{n}--> comment naming its first source line. */
function mark(line) {
  return `<!--L${line}-->`;
}

function depthClass(indent) {
  const depth = Math.min(3, Math.floor(indent.replace(/\t/g, '  ').length / 2));
  return depth ? ` class="depth-${depth}"` : '';
}

function renderMarkdown(src) {
  const lines = String(src || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol' | 'task'
  let listBuf = [];
  let listStart = 0;
  let listFirstNumber = 1;

  function flushList() {
    if (!listType) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    const cls = listType === 'task' ? ' class="task-list"' : '';
    const start = listType === 'ol' && listFirstNumber !== 1 ? ` start="${listFirstNumber}"` : '';
    out.push(`${mark(listStart)}<${tag}${cls}${start}>${listBuf.join('')}</${tag}>`);
    listType = null;
    listBuf = [];
  }

  function addListItem(type, line, html) {
    if (listType && listType !== type) flushList();
    if (!listType) listStart = line;
    listType = type;
    listBuf.push(html);
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushList();
      const start = i;
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`${mark(start)}<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^(\s*)---+\s*$/.test(line) || /^(\s*)\*\*\*+\s*$/.test(line)) {
      flushList();
      out.push(`${mark(i)}<hr/>`);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      flushList();
      const start = i;
      const head = tableCells(line);
      const aligns = tableCells(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''
      );
      const cell = (tag, text, col) =>
        `<${tag}${aligns[col] ? ` style="text-align:${aligns[col]}"` : ''}>${inlineFormat(text)}</${tag}>`;
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(`<tr>${tableCells(lines[i]).map((c, col) => cell('td', c, col)).join('')}</tr>`);
        i += 1;
      }
      out.push(
        `${mark(start)}<table><thead><tr>${head.map((c, col) => cell('th', c, col)).join('')}</tr></thead>` +
          `<tbody>${rows.join('')}</tbody></table>`
      );
      continue;
    }

    const quote = /^(\s*)>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      const start = i;
      const parts = [quote[2]];
      i += 1;
      while (i < lines.length) {
        const cont = /^(\s*)>\s?(.*)$/.exec(lines[i]);
        if (!cont) break;
        parts.push(cont[2]);
        i += 1;
      }
      out.push(`${mark(start)}<blockquote>${parts.map(inlineFormat).join('<br/>')}</blockquote>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`${mark(i)}<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const checked = /x/i.test(task[2]);
      addListItem(
        'task',
        i,
        `<li${depthClass(task[1]).replace('class="', 'class="task-item ') || ' class="task-item"'} data-line="${i}" data-task-line="${i}">` +
          `<label><input type="checkbox" class="task-check" ${checked ? 'checked' : ''}/>` +
          `<span>${inlineFormat(task[3])}</span></label></li>`
      );
      i += 1;
      continue;
    }

    const ul = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      addListItem('ul', i, `<li${depthClass(ul[1])} data-line="${i}">${inlineFormat(ul[2])}</li>`);
      i += 1;
      continue;
    }

    const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== 'ol') listFirstNumber = Number(ol[2]);
      addListItem('ol', i, `<li${depthClass(ol[1])} data-line="${i}">${inlineFormat(ol[3])}</li>`);
      i += 1;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushList();
      i += 1;
      continue;
    }

    flushList();
    const start = i;
    const para = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (/^\s*$/.test(next)) break;
      if (/^#{1,6}\s+/.test(next)) break;
      if (/^```/.test(next)) break;
      if (/^\s*[-*+]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      if (/^\s*>\s?/.test(next)) break;
      if (/^\s*---+\s*$/.test(next)) break;
      if (isTableStart(lines, i)) break;
      para.push(next);
      i += 1;
    }
    out.push(`${mark(start)}<p>${para.map(inlineFormat).join('<br/>')}</p>`);
  }

  flushList();
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

/** Character offset where a source line starts (for placing the caret). */
function lineOffset(src, lineIndex) {
  const lines = String(src || '').split('\n');
  let offset = 0;
  for (let i = 0; i < Math.min(lineIndex, lines.length); i += 1) offset += lines[i].length + 1;
  return Math.min(offset, String(src || '').length);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMarkdown, toggleTaskAtLine, lineOffset, escapeHtml, inlineFormat };
}

if (typeof window !== 'undefined') {
  window.GhostMarkdown = { renderMarkdown, toggleTaskAtLine, lineOffset };
}
