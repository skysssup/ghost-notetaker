'use strict';

// Writes a Ghost Notetaker profile filled with everyday sample notes for the
// README screenshots and videos.
//
//   node scripts/demo/seed.js <userDataDir> <manager|hero|demo>
//
//   manager  the whole sample notebook, some notes on screen, with trash and backups
//   hero     the same notebook with three notes on the right of the screen, for the README picture
//   demo     two notes on screen for the demo video
//
// Positions are logical screen pixels of each note's paper.

const fs = require('fs');
const path = require('path');
const { DATA_FILE, renderHtml } = require('./lib');

const CHIPS = '3f9c1d7e5a2b4c60.png';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Note bounds are stored with an 8px margin around the paper. */
const frame = ([x, y, width, height]) => ({ x: x - 8, y: y - 8, width: width + 16, height: height + 16 });

const NOTES = {
  today: {
    title: 'Today',
    color: 'amber',
    tags: ['todo'],
    ago: 6 * MIN,
    content: ['- [x] Reply to Maya about Saturday', '- [ ] Pick up the dry cleaning', '- [ ] Book a haircut', '- [ ] Water the plants'].join('\n')
  },
  groceries: {
    title: 'Groceries',
    color: 'mint',
    tags: ['shopping'],
    ago: 25 * MIN,
    content: ['- Oat milk', '- Eggs', '- Lemons', '- Coffee beans', '- Fresh basil'].join('\n')
  },
  weekend: {
    title: 'Weekend',
    color: 'ivory',
    tags: [],
    ago: 2 * MIN,
    content: ['## Saturday', '- [ ] Farmers market', '- [ ] Bike to the lake', '', '**Sunday:** brunch at 11'].join('\n')
  },
  packing: {
    title: 'Packing list',
    color: 'slate',
    tags: ['travel'],
    ago: 50 * MIN,
    content: ['- [x] Passport', '- [x] Chargers', '- [ ] Rain jacket', '- [ ] Book for the flight'].join('\n')
  },
  pancakes: {
    title: 'Pancakes',
    color: 'peach',
    tags: ['recipes'],
    ago: 3 * HOUR,
    content: ['| Ingredient | Amount |', '| --- | ---: |', '| Flour | 200 g |', '| Milk | 300 ml |', '| Eggs | 2 |', '| Butter | 30 g |'].join('\n')
  },
  reading: {
    title: 'Reading list',
    color: 'sky',
    tags: [],
    ago: 26 * HOUR,
    content: ['1. *Middlemarch*', '2. *The Odyssey*', '3. *Moby-Dick*'].join('\n')
  },
  paint: {
    title: 'Living room paint',
    color: 'mist',
    tags: ['home'],
    ago: 2 * DAY,
    content: ['Shortlist from the store:', '', `![Paint chips](ghost-image://img/${CHIPS})`].join('\n')
  },
  workout: {
    title: 'Workout',
    color: 'lavender',
    tags: [],
    ago: 4 * DAY,
    content: ['- 3 × 10 squats', '- 3 × 12 push-ups', '- 20 min easy run'].join('\n')
  },
  gifts: {
    title: 'Gift ideas',
    color: 'rose',
    tags: [],
    ago: 6 * DAY,
    content: ['- Mom: a ceramic mug', '- Leo: climbing chalk bag', '- Ana: concert tickets'].join('\n')
  },
  wifi: {
    title: 'Guest Wi-Fi',
    color: 'teal',
    tags: ['home'],
    ago: 12 * DAY,
    content: ['Network: **Lighthouse**', '', 'Password: `blue-otter-42`'].join('\n')
  },
  standup: {
    title: 'Standup',
    color: 'mist',
    tags: ['work'],
    ago: HOUR,
    content: ['- Finished the onboarding emails', '- Today: review the settings page', '- Waiting on copy for the empty states'].join('\n')
  },
  questions: {
    title: 'Questions for Sam',
    color: 'amber',
    tags: ['work'],
    ago: 2 * HOUR,
    content: ['- [ ] Who owns the help center?', '- [ ] Can we ship on Thursday?'].join('\n')
  },
  bugs: {
    title: 'Bugs to file',
    color: 'coral',
    tags: ['work'],
    ago: 3 * DAY,
    content: ['1. Search ignores accents', '2. Dark mode flashes on launch'].join('\n')
  }
};

function noteRecord(key, workspaceId, now, extra = {}) {
  const n = NOTES[key];
  return {
    id: `note_${key}`,
    workspaceId,
    title: n.title,
    content: n.content,
    tags: n.tags,
    color: n.color,
    opacity: 1,
    fontSize: 14,
    monospace: false,
    pinned: true,
    clickThrough: false,
    previewMode: false,
    collapsed: false,
    visible: false,
    trashedAt: null,
    bounds: { x: 200, y: 160, width: 320, height: 260 },
    displayId: null,
    createdAt: new Date(now - n.ago - 3 * DAY).toISOString(),
    updatedAt: new Date(now - n.ago).toISOString(),
    ...extra
  };
}

function settings(extra = {}) {
  return { defaultOpacity: 1, defaultFontSize: 14, defaultColor: 'amber', theme: 'light', managerView: 'list', ...extra };
}

const PERSONAL = { id: 'ws_personal', name: 'Personal' };
const WORK = { id: 'ws_work', name: 'Work' };

const SCENARIOS = {
  manager(now) {
    const p = (key, extra) => noteRecord(key, PERSONAL.id, now, extra);
    const w = (key, extra) => noteRecord(key, WORK.id, now, extra);
    const trashed = (id, title, color, content, ago) => ({
      ...noteRecord('gifts', PERSONAL.id, now),
      id,
      title,
      color,
      tags: [],
      content,
      trashedAt: new Date(now - ago).toISOString()
    });
    const notes = [
      p('today', { visible: true }),
      p('groceries', { visible: true }),
      p('weekend'),
      p('packing', { visible: true }),
      p('pancakes'),
      p('reading', { visible: true, collapsed: true }),
      p('paint'),
      p('workout'),
      p('gifts'),
      p('wifi'),
      w('standup'),
      w('questions'),
      w('bugs'),
      trashed('note_trash_list', 'Old shopping list', 'mint', '- Rice\n- Tomatoes', 2 * DAY),
      trashed('note_trash_draft', 'Draft reply', 'sky', 'Thanks, Thursday works for me.', 9 * DAY)
    ];
    const recentNoteIds = ['note_today', 'note_groceries', 'note_packing', 'note_weekend', 'note_pancakes'];
    return { workspaces: [PERSONAL, WORK], activeWorkspaceId: PERSONAL.id, notes, settings: settings({ recentNoteIds }), backups: 4 };
  },

  hero(now, [ox, oy]) {
    const at = ([x, y, width, height]) => frame([ox + x, oy + y, width, height]);
    const place = { note_today: [806, 128, 270, 206], note_packing: [844, 366, 240, 212], note_reading: [744, 590, 264, 200] };
    const notebook = SCENARIOS.manager(now);
    const notes = notebook.notes.map((n) => ({ ...n, visible: n.id in place, bounds: place[n.id] ? at(place[n.id]) : n.bounds }));
    return { ...notebook, notes, settings: { ...notebook.settings, managerView: 'board' }, backups: 0 };
  },

  demo(now, [ox, oy]) {
    const at = ([x, y, width, height]) => frame([ox + x, oy + y, width, height]);
    const p = (key, rect) => noteRecord(key, PERSONAL.id, now, { visible: true, bounds: at(rect) });
    const notes = [p('today', [176, 100, 300, 222]), p('groceries', [176, 356, 264, 252])];
    return { workspaces: [PERSONAL, WORK], activeWorkspaceId: PERSONAL.id, notes, settings: settings({ defaultColor: 'lavender' }) };
  }
};

async function seed(userDataDir, scenario, { origin = [0, 0], now = Date.now() } = {}) {
  const build = SCENARIOS[scenario];
  if (!build) throw new Error(`Unknown scenario "${scenario}" (${Object.keys(SCENARIOS).join(', ')})`);
  const { backups = 0, ...state } = build(now, origin);
  fs.mkdirSync(path.join(userDataDir, 'images'), { recursive: true, mode: 0o700 });
  const chips = path.join(userDataDir, 'images', CHIPS);
  if (!fs.existsSync(chips)) await renderHtml('chips.html', { width: 480, height: 200, scale: 2, out: chips });
  const data = {
    version: 2,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces.map((w) => ({ ...w, createdAt: new Date(now - 30 * DAY).toISOString(), updatedAt: new Date(now - DAY).toISOString() })),
    notes: state.notes,
    settings: state.settings
  };
  const file = path.join(userDataDir, DATA_FILE);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (backups) {
    const dir = path.join(userDataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let i = 1; i <= backups; i++) {
      const when = new Date(now - i * DAY);
      const name = `ghost-notetaker-${when.toISOString().slice(0, 10)}.json`;
      fs.writeFileSync(path.join(dir, name), JSON.stringify(data), { mode: 0o600 });
      fs.utimesSync(path.join(dir, name), when, when);
    }
  }
  return file;
}

if (require.main === module) {
  const [dir, scenario] = process.argv.slice(2);
  if (!dir || !scenario) {
    console.error(`Usage: node scripts/demo/seed.js <userDataDir> <${Object.keys(SCENARIOS).join('|')}>`);
    process.exit(2);
  }
  seed(path.resolve(dir), scenario)
    .then((file) => console.log(file))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seed, NOTES };
