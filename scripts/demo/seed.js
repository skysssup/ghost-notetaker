'use strict';

// Writes a Ghost Notetaker profile filled with sample notes for the README
// screenshots and the demo recording. Everything in it is fictional: Kestrel
// is a made-up field app, and the people and numbers are invented.
//
//   node scripts/demo/seed.js <userDataDir> <scenario>
//
// Scenarios:
//   manager  the whole sample notebook, mostly hidden, with trash and backups
//   desktop  four notes for the notes-desktop.png screenshot (800x500 region)
//   demo     two formatted notes for the hero recording (1200x750 region)
//
// Positions are logical screen pixels for the visible paper of each note; the
// region starts at --origin (default 0,0). The sample chart is rendered from
// chart.html, which needs a display (DISPLAY on Linux).

const fs = require('fs');
const path = require('path');
const { DATA_FILE, renderHtml } = require('./lib');

const CHART = '5a3c1e0f7b2d4c68.png';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Note bounds are stored with an 8px margin around the paper. */
const frame = ([x, y, width, height], [ox, oy]) => ({ x: ox + x - 8, y: oy + y - 8, width: width + 16, height: height + 16 });

const NOTES = {
  review: {
    title: 'Review prep',
    color: 'amber',
    tags: ['review'],
    ago: 12 * MIN,
    content: ['- [x] Pull Q3 numbers from Lena', '- [ ] Rehearse the pricing slide', '- [ ] Send the deck to Jonas by 4 pm'].join('\n')
  },
  milestones: {
    title: 'Q4 milestones',
    color: 'sky',
    tags: ['planning'],
    ago: 2 * HOUR,
    content: [
      '| Milestone | Date | Owner |',
      '| --- | --- | --- |',
      '| Beta to 40 crews | 14 Oct | Marco |',
      '| Admin SSO | 4 Nov | Priya |',
      '| Offline maps | 2 Dec | Lena |'
    ].join('\n')
  },
  questions: {
    title: 'Questions from Priya',
    color: 'ivory',
    tags: ['review'],
    ago: 25 * MIN,
    content: ['## Questions from Priya', '- [ ] SSO timeline', '- [ ] Who owns the crash dashboard?', '', `![Weekly active crews](ghost-image://img/${CHART})`].join('\n')
  },
  pricing: {
    title: 'Talking points: pricing',
    color: 'indigo',
    tags: ['review'],
    ago: 50 * MIN,
    content: ['1. Per-crew pricing stays at $18', '2. Fleet plan from 25 crews', '3. Annual billing: two months free'].join('\n')
  },
  followups: {
    title: 'Follow-ups',
    color: 'ivory',
    tags: ['review'],
    ago: 4 * MIN,
    content: ['## Follow-ups', '- [ ] Pricing FAQ to **Jonas**', '- [ ] Design review with Lena, *Thu*'].join('\n')
  },
  standup: {
    title: 'Standup, Tue 7 Oct',
    color: 'mint',
    tags: ['eng'],
    ago: 3 * HOUR,
    content: ['- **Marco**: offline sync spike, 2 days left', '- **Lena**: map tiles below 40 MB', '- **Sam**: regression pass on 2.4 RC'].join('\n')
  },
  sync: {
    title: 'Offline sync open questions',
    color: 'lavender',
    tags: ['eng'],
    ago: 26 * HOUR,
    content: [
      '- What wins when two crews edit one job sheet?',
      '- Keep photos local until Wi-Fi, or send over LTE?',
      '- Max queue size before we warn: `500` edits',
      '',
      'Marco to write it up by Friday.'
    ].join('\n')
  },
  hiring: {
    title: 'Interview loop: Android lead',
    color: 'rose',
    tags: ['hiring'],
    ago: 2 * DAY,
    content: ['- Mon 13 Oct: Priya, product', '- Tue 14 Oct: Marco, system design', '- Wed 15 Oct: Lena, design review'].join('\n')
  },
  feedback: {
    title: 'Crew feedback, week 40',
    color: 'peach',
    tags: ['research'],
    ago: 4 * DAY,
    content: ['> The map loads before I reach the site now.', '', '> I still re-type the meter reading twice.', '', 'From 6 calls with crews in Leeds and Bristol.'].join('\n')
  },
  release: {
    title: 'Release checklist 2.4',
    color: 'slate',
    tags: ['eng'],
    ago: 5 * DAY,
    content: [
      '- [x] Freeze strings',
      '- [x] Bump build to 2.4.0 (311)',
      '- [x] Regression pass on Pixel 6 and Galaxy A14',
      '- [ ] Store screenshots',
      '- [ ] Staged rollout: 10%',
      '- [ ] Release notes to support'
    ].join('\n')
  },
  vendors: {
    title: 'Vendor contacts',
    color: 'mist',
    tags: ['ops'],
    ago: 9 * DAY,
    content: ['| Vendor | Contact |', '| --- | --- |', '| Map tiles | Ines |', '| SMS gateway | Tomás |'].join('\n')
  },
  dentist: { title: 'Dentist Thu 9:30', color: 'coral', tags: [], ago: 6 * DAY, content: 'Bring the insurance card.' },
  groceries: { title: 'Groceries', color: 'teal', tags: [], ago: 8 * DAY, content: '- Oat milk\n- Coffee beans\n- Lemons' }
};

function noteRecord(key, workspaceId, now, extra = {}) {
  const n = NOTES[key];
  const updatedAt = new Date(now - n.ago).toISOString();
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
    bounds: { x: 200, y: 160, width: 340, height: 280 },
    displayId: null,
    createdAt: new Date(now - n.ago - 3 * DAY).toISOString(),
    updatedAt,
    ...extra
  };
}

function settings(extra = {}) {
  return {
    defaultOpacity: 1,
    defaultFontSize: 14,
    defaultColor: 'ivory',
    theme: 'light',
    managerView: 'list',
    ...extra
  };
}

const SCENARIOS = {
  manager(now) {
    const ws = [
      { id: 'ws_kestrel', name: 'Kestrel launch' },
      { id: 'ws_personal', name: 'Personal' }
    ];
    const k = (key, extra) => noteRecord(key, 'ws_kestrel', now, extra);
    const notes = [
      k('review', { visible: true }),
      k('questions', { visible: true }),
      k('pricing'),
      k('milestones', { visible: true }),
      k('standup', { visible: true, collapsed: true }),
      k('sync'),
      k('hiring'),
      k('feedback'),
      k('release'),
      k('vendors', { visible: true }),
      noteRecord('dentist', 'ws_personal', now),
      noteRecord('groceries', 'ws_personal', now),
      {
        ...k('vendors'),
        id: 'note_trash_pricing',
        title: 'Old pricing draft',
        color: 'peach',
        tags: [],
        content: '- $22 per crew\n- No fleet plan',
        trashedAt: new Date(now - 2 * DAY).toISOString()
      },
      {
        ...k('vendors'),
        id: 'note_trash_retro',
        title: 'Retro notes, sprint 38',
        color: 'mist',
        tags: [],
        content: '- Too many hotfixes\n- Pair on release days',
        trashedAt: new Date(now - 9 * DAY).toISOString()
      }
    ];
    return { workspaces: ws, activeWorkspaceId: 'ws_kestrel', notes, settings: settings({ recentNoteIds: ['note_review', 'note_questions', 'note_pricing', 'note_standup', 'note_milestones', 'note_sync'] }),
      backups: 4
    };
  },

  desktop(now, origin) {
    const ws = [{ id: 'ws_kestrel', name: 'Kestrel launch' }];
    const k = (key, rect, extra) => noteRecord(key, 'ws_kestrel', now, { visible: true, bounds: frame(rect, origin), ...extra });
    const notes = [
      k('review', [540, 12, 244, 222]),
      k('pricing', [540, 250, 244, 218]),
      k('followups', [196, 232, 336, 200]),
      k('standup', [112, 384, 300, 220], { collapsed: true })
    ];
    return { workspaces: ws, activeWorkspaceId: 'ws_kestrel', notes, settings: settings() };
  },

  demo(now, origin) {
    const ws = [{ id: 'ws_kestrel', name: 'Kestrel launch' }];
    const k = (key, rect) => noteRecord(key, 'ws_kestrel', now, { visible: true, bounds: frame(rect, origin) });
    const notes = [k('review', [856, 34, 306, 196]), k('milestones', [818, 262, 344, 206])];
    return { workspaces: ws, activeWorkspaceId: 'ws_kestrel', notes, settings: settings() };
  }
};

async function seed(userDataDir, scenario, { origin = [0, 0], now = Date.now() } = {}) {
  const build = SCENARIOS[scenario];
  if (!build) throw new Error(`Unknown scenario "${scenario}" (manager, desktop, demo)`);
  const { backups = 0, ...state } = build(now, origin);
  fs.mkdirSync(path.join(userDataDir, 'images'), { recursive: true, mode: 0o700 });
  const chart = path.join(userDataDir, 'images', CHART);
  if (!fs.existsSync(chart)) await renderHtml('chart.html', { width: 520, height: 300, scale: 2, out: chart });
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
  const originArg = process.argv.find((a) => a.startsWith('--origin='));
  const origin = originArg ? originArg.slice(9).split(',').map(Number) : [0, 0];
  if (!dir || !scenario) {
    console.error('Usage: node scripts/demo/seed.js <userDataDir> <manager|desktop|demo> [--origin=x,y]');
    process.exit(2);
  }
  seed(path.resolve(dir), scenario, { origin })
    .then((file) => console.log(file))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seed, NOTES };
