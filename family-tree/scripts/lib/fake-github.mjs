// In-memory GitHub with the same interface as github.mjs — used by the tests and by offline dry runs
// (`--dry-run --event <file>` without GITHUB_TOKEN: the event's issue/comment, plus an optional "_fixture" block,
// seed the state). Every write is recorded in `calls`.
//
//   const gh = createFakeGitHub({issues, comments: {n: […]}, events: {n: […]}, labels, pages, releases})
//   Simulate people:  gh.userComment(n, login, body) · gh.userLabel(n, name, login) · gh.userOpen({…}) · gh.userEdit(n, body)

import { BOT_LOGIN } from './labels.mjs';

export function createFakeGitHub(seed = {}) {
  const state = {
    issues: new Map(),
    comments: new Map(),
    events: new Map(),
    labels: new Set((seed.labels || []).map((l) => (typeof l === 'string' ? l : l.name))),
    pages: 'pages' in seed ? seed.pages : { status: 'built', commit: '' },
    pagesRequests: 0,
    releases: (seed.releases || []).map((r) => ({ assets: [], ...r })),
    tagsDeleted: [],
  };
  let clock = Date.parse(seed.start || '2026-01-01T00:00:00Z');
  let nextId = 1000;
  const tick = () => new Date((clock += 1000)).toISOString();
  const calls = [];
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const labelObjs = (names) => names.map((name) => ({ name }));

  for (const i of seed.issues || []) {
    state.issues.set(i.number, {
      state: 'open', title: '', body: '', created_at: tick(), user: { login: 'someone' }, ...clone(i),
      labels: labelObjs((i.labels || []).map((l) => (typeof l === 'string' ? l : l.name))),
    });
  }
  for (const [n, list] of Object.entries(seed.comments || {})) {
    state.comments.set(Number(n), list.map((c) => ({ id: c.id ?? nextId++, created_at: tick(), ...clone(c) })));
  }
  for (const [n, list] of Object.entries(seed.events || {})) state.events.set(Number(n), clone(list));

  const issue = (n) => {
    const i = state.issues.get(Number(n));
    if (!i) { const e = new Error(`GitHub API 404: issue ${n} not found`); e.status = 404; throw e; }
    return i;
  };
  const commentsOf = (n) => { if (!state.comments.has(Number(n))) state.comments.set(Number(n), []); return state.comments.get(Number(n)); };
  const eventsOf = (n) => { if (!state.events.has(Number(n))) state.events.set(Number(n), []); return state.events.get(Number(n)); };
  const record = (method, ...args) => calls.push({ method, args: clone(args) });

  function addLabel(n, name, actor) {
    const i = issue(n);
    state.labels.add(name);
    if (!i.labels.some((l) => l.name === name)) i.labels.push({ name });
    eventsOf(n).push({ event: 'labeled', label: { name }, actor: { login: actor }, created_at: tick() });
  }
  function dropLabel(n, name, actor) {
    const i = issue(n);
    const before = i.labels.length;
    i.labels = i.labels.filter((l) => l.name !== name);
    if (i.labels.length !== before) eventsOf(n).push({ event: 'unlabeled', label: { name }, actor: { login: actor }, created_at: tick() });
  }
  function addComment(n, login, body) {
    issue(n);
    const c = { id: nextId++, body, user: { login }, created_at: tick(), updated_at: null };
    commentsOf(n).push(c);
    return c;
  }

  const gh = {
    owner: seed.owner || 'owner',
    repo: seed.repo || 'repo',
    state,
    calls,
    botLogin: BOT_LOGIN,

    // --- simulation helpers (people acting on GitHub) ---
    userComment: (n, login, body) => clone(addComment(n, login, body)),
    userLabel: (n, name, login) => addLabel(n, name, login),
    userUnlabel: (n, name, login) => dropLabel(n, name, login),
    userOpen({ number, title = '', body = '', login = 'relative', labels = [] }) {
      const n = number ?? Math.max(0, ...state.issues.keys()) + 1;
      state.issues.set(n, { number: n, title, body, state: 'open', created_at: tick(), user: { login }, labels: [] });
      for (const l of labels) addLabel(n, l, login);
      return n;
    },
    userEdit(n, body) { issue(n).body = body; },
    userClose(n) { issue(n).state = 'closed'; },
    commentsOf: (n) => clone(commentsOf(n)),
    botComments: (n) => clone(commentsOf(n).filter((c) => c.user.login === BOT_LOGIN)),
    labelsOf: (n) => issue(n).labels.map((l) => l.name),

    // --- the client interface ---
    async getRepo() { return { default_branch: seed.defaultBranch || 'main' }; },
    async getIssue(n) { return clone(issue(n)); },
    async listIssues({ state: st = 'open', labels } = {}) {
      const want = labels ? String(labels).split(',').filter(Boolean) : [];
      return clone([...state.issues.values()]
        .filter((i) => !i.pull_request && (st === 'all' || i.state === st))
        .filter((i) => want.every((w) => i.labels.some((l) => l.name === w)))
        .sort((a, b) => a.number - b.number));
    },
    async listComments(n) { return clone(commentsOf(n)); },
    async getComment(id) {
      for (const list of state.comments.values()) {
        const c = list.find((x) => x.id === Number(id));
        if (c) return clone(c);
      }
      const e = new Error(`GitHub API 404: comment ${id} not found`); e.status = 404; throw e;
    },
    async createComment(n, body) { record('createComment', n, body); return clone(addComment(n, BOT_LOGIN, body)); },
    async updateComment(id, body) {
      record('updateComment', id, body);
      for (const list of state.comments.values()) {
        const c = list.find((x) => x.id === Number(id));
        if (c) { c.body = body; c.updated_at = tick(); return clone(c); }
      }
      const e = new Error('GitHub API 404'); e.status = 404; throw e;
    },
    async addLabels(n, names) { record('addLabels', n, names); for (const name of names) addLabel(n, name, BOT_LOGIN); return []; },
    async removeLabel(n, name) { record('removeLabel', n, name); dropLabel(n, name, BOT_LOGIN); },
    async ensureLabels(defs) {
      const created = defs.map((d) => d.name).filter((name) => !state.labels.has(name));
      created.forEach((name) => state.labels.add(name));
      if (created.length) record('ensureLabels', created);
      return created;
    },
    async closeIssue(n, reason = 'completed') {
      record('closeIssue', n, reason);
      const i = issue(n);
      i.state = 'closed';
      i.state_reason = reason;
      return clone(i);
    },
    async listIssueEvents(n) { return clone(eventsOf(n)); },
    async latestPagesBuild() {
      if (state.pages === null) { const e = new Error('GitHub API 404'); e.status = 404; throw e; }
      return clone(state.pages);
    },
    async requestPagesBuild() { record('requestPagesBuild'); state.pagesRequests++; return { status: 'queued' }; },
    async listReleases() { return clone(state.releases); },
    async createRelease(params) {
      record('createRelease', params);
      const r = { id: nextId++, assets: [], created_at: tick(), ...clone(params) };
      state.releases.unshift(r);
      return clone(r);
    },
    async uploadReleaseAsset(release, name, content, contentType) {
      record('uploadReleaseAsset', release.id ?? release, name, contentType);
      const r = state.releases.find((x) => x.id === (release.id ?? release));
      const a = { id: nextId++, name, size: Buffer.byteLength(content) };
      r?.assets.push(a);
      return a;
    },
    async deleteRelease(id) { record('deleteRelease', id); state.releases = state.releases.filter((r) => r.id !== id); },
    async deleteTag(tag) { record('deleteTag', tag); state.tagsDeleted.push(tag); },
  };
  return gh;
}

/** Seed for an offline dry run from an event payload (+ optional "_fixture": {issues, comments, events, labels}). */
export function fakeFromEvent(event = {}) {
  const fx = event._fixture || {};
  const issues = [...(fx.issues || [])];
  if (event.issue && !issues.some((i) => i.number === event.issue.number)) {
    issues.push({ ...event.issue, labels: (event.issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)) });
  }
  const comments = { ...(fx.comments || {}) };
  if (event.comment && event.issue) {
    const n = event.issue.number;
    const list = comments[n] ? [...comments[n]] : [];
    if (!list.some((c) => c.id === event.comment.id)) list.push(event.comment);
    comments[n] = list;
  }
  return createFakeGitHub({ issues, comments, events: fx.events || {}, labels: fx.labels || [], ...('pages' in fx ? { pages: fx.pages } : {}) });
}
