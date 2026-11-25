// Minimal GitHub REST client for the family-tree workflows (Node ≥ 20 global fetch, no dependencies).
//
//   const gh = createGitHub({token, owner, repo, fetch?, apiUrl?, sleep?})
//   gh.getIssue(n) · gh.listIssues({state, labels}) · gh.listComments(n) · gh.getComment(id) · gh.createComment(n, body)
//   gh.updateComment(id, body) · gh.addLabels(n, names) · gh.removeLabel(n, name) · gh.ensureLabels(defs)
//   gh.closeIssue(n, reason) · gh.listIssueEvents(n) · gh.getRepo() · gh.latestPagesBuild() · gh.requestPagesBuild()
//   gh.listReleases() · gh.createRelease(params) · gh.uploadReleaseAsset(release, name, content, type)
//   gh.deleteRelease(id) · gh.deleteTag(tag)
//
// The same interface is implemented in memory by fake-github.mjs (tests, offline dry runs); `readOnlyGitHub(gh, log)`
// wraps a client so that every write is only logged (workflow_dispatch dry_run).

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(`GitHub API ${status}: ${message}`);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/** Methods that change something on GitHub (used by readOnlyGitHub). */
export const WRITE_METHODS = Object.freeze([
  'createComment', 'updateComment', 'addLabels', 'removeLabel', 'ensureLabels', 'closeIssue', 'requestPagesBuild',
  'createRelease', 'uploadReleaseAsset', 'deleteRelease', 'deleteTag',
]);

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createGitHub({
  token, owner, repo, fetch: fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com',
  uploadUrl = 'https://uploads.github.com', sleep = defaultSleep, userAgent = 'family-tree-bot',
} = {}) {
  if (!owner || !repo) throw new Error('createGitHub: owner and repo are required');
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function request(method, path, { body, query, raw, headers = {}, url, allow = [] } = {}) {
    let target = url || `${apiUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      if ([...qs].length) target += `${target.includes('?') ? '&' : '?'}${qs}`;
    }
    const h = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': userAgent,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    };
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['content-type'] = 'application/json';
    }
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(target, { method, headers: h, body: payload });
      if (allow.includes(res.status)) return { status: res.status, data: null, headers: res.headers };
      const text = res.status === 204 ? '' : await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      const retryable = res.status >= 500 || res.status === 429
        || (res.status === 403 && /rate limit/i.test(typeof data === 'object' ? data?.message || '' : String(data)));
      if (res.ok) return { status: res.status, data, headers: res.headers };
      if (retryable && attempt < 3) {
        const after = Number(res.headers?.get?.('retry-after')) || 0;
        await sleep(Math.min(after ? after * 1000 : 2000 * attempt, 30000));
        continue;
      }
      throw new GitHubError(res.status, (data && typeof data === 'object' && data.message) || res.statusText || 'request failed', data);
    }
  }

  /** GET every page of a list endpoint (per_page=100, up to `max` items). */
  async function paginate(path, query = {}, max = 1000) {
    const out = [];
    for (let page = 1; out.length < max; page++) {
      const { data } = await request('GET', path, { query: { ...query, per_page: 100, page } });
      const list = Array.isArray(data) ? data : [];
      out.push(...list);
      if (list.length < 100) break;
    }
    return out.slice(0, max);
  }

  return {
    owner,
    repo,
    request,
    async getRepo() { return (await request('GET', base)).data; },
    async getIssue(n) { return (await request('GET', `${base}/issues/${n}`)).data; },
    async listIssues({ state = 'open', labels, max = 300 } = {}) {
      const list = await paginate(`${base}/issues`, { state, labels, sort: 'created', direction: 'asc' }, max);
      return list.filter((i) => !i.pull_request);
    },
    async listComments(n) { return paginate(`${base}/issues/${n}/comments`, {}, 3000); },
    async getComment(id) { return (await request('GET', `${base}/issues/comments/${id}`)).data; },
    async createComment(n, body) { return (await request('POST', `${base}/issues/${n}/comments`, { body: { body } })).data; },
    async updateComment(id, body) { return (await request('PATCH', `${base}/issues/comments/${id}`, { body: { body } })).data; },
    async addLabels(n, names) {
      if (!names.length) return [];
      return (await request('POST', `${base}/issues/${n}/labels`, { body: { labels: names } })).data;
    },
    async removeLabel(n, name) {
      await request('DELETE', `${base}/issues/${n}/labels/${encodeURIComponent(name)}`, { allow: [404] });
    },
    async ensureLabels(defs) {
      const have = new Set((await paginate(`${base}/labels`, {}, 1000)).map((l) => String(l.name).toLowerCase()));
      const created = [];
      for (const d of defs) {
        if (have.has(d.name.toLowerCase())) continue;
        await request('POST', `${base}/labels`, { body: d, allow: [422] });
        created.push(d.name);
      }
      return created;
    },
    async closeIssue(n, reason = 'completed') {
      return (await request('PATCH', `${base}/issues/${n}`, { body: { state: 'closed', state_reason: reason } })).data;
    },
    async listIssueEvents(n) { return paginate(`${base}/issues/${n}/events`, {}, 3000); },
    async latestPagesBuild() { return (await request('GET', `${base}/pages/builds/latest`)).data; },
    async requestPagesBuild() { return (await request('POST', `${base}/pages/builds`)).data; },
    async listReleases() { return paginate(`${base}/releases`, {}, 1000); },
    async createRelease(params) { return (await request('POST', `${base}/releases`, { body: params })).data; },
    async uploadReleaseAsset(release, name, content, contentType = 'application/json') {
      const url = `${uploadUrl}${base}/releases/${release.id ?? release}/assets?name=${encodeURIComponent(name)}`;
      return (await request('POST', '', { url, raw: content, headers: { 'content-type': contentType } })).data;
    },
    async deleteRelease(id) { await request('DELETE', `${base}/releases/${id}`, { allow: [404] }); },
    async deleteTag(tag) { await request('DELETE', `${base}/git/refs/tags/${encodeURIComponent(tag)}`, { allow: [404, 422] }); },
  };
}

/** Wrap a client: reads go through, writes are logged and answered with harmless placeholders. */
export function readOnlyGitHub(gh, log = console.log) {
  const wrapped = { ...gh, writes: [] };
  let fakeId = 900000000;
  for (const m of WRITE_METHODS) {
    wrapped[m] = async (...args) => {
      const shown = args.map((a) => (typeof a === 'string' && a.length > 400 ? `${a.slice(0, 400)}… (${a.length} chars)` : a));
      wrapped.writes.push({ method: m, args });
      log(`[dry-run] would call ${m}(${shown.map((a) => JSON.stringify(a)).join(', ')})`);
      if (m === 'createComment') return { id: ++fakeId, body: args[1], user: { login: 'github-actions[bot]' } };
      if (m === 'createRelease') return { id: ++fakeId, ...args[0] };
      if (m === 'ensureLabels') return [];
      return null;
    };
  }
  return wrapped;
}
