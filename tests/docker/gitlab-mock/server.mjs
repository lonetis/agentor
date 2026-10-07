// Minimal stand-in for a self-managed GitLab server, for the dockerized test
// stack (stack.yml → service `gitlab-mock`, GITLAB_INSTANCES=mock=...).
//
// Serves the slice of the REST API v4 the orchestrator uses (user, projects,
// groups, namespaces, branches, project creation) and real git smart HTTP for
// the seeded repositories, so a worker can clone with its per-host token.
// Every request needs MOCK_TOKEN: as a Bearer / PRIVATE-TOKEN header for the
// API, as the Basic-auth password for git.
//
// Pages are capped at 2 items so clients must paginate, and `Link` headers
// point at a host that does not exist — like a self-managed instance whose
// configured external URL differs from the URL it is reached at. Clients have
// to follow `X-Next-Page`.
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.MOCK_TOKEN || 'glpat-agentor-mock-token';
const PAGE_CAP = 2;
const REPO_ROOT = join(tmpdir(), 'gitlab-mock-repos');

const user = { id: 1, username: 'mock-user', name: 'Mock User' };
const namespaces = [
  { id: 1, full_path: 'mock-user', kind: 'user' },
  { id: 10, full_path: 'group', kind: 'group' },
  { id: 11, full_path: 'group/sub', kind: 'group' },
];
const groups = namespaces.filter((n) => n.kind === 'group');

let nextProjectId = 100;
const projects = [];

function addProject(fullPath, visibility, defaultBranch, branches) {
  const project = {
    id: nextProjectId++,
    path_with_namespace: fullPath,
    path: fullPath.split('/').pop(),
    name: fullPath.split('/').pop(),
    visibility,
    default_branch: defaultBranch,
    branches,
  };
  projects.push(project);
  return project;
}

/** A bare repo with one commit per branch, each adding `<branch>.txt`. */
function seedRepo(fullPath, branches) {
  const bare = join(REPO_ROOT, `${fullPath}.git`);
  mkdirSync(bare, { recursive: true });
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Mock', '-c', 'user.email=mock@example.test', ...args], { cwd, stdio: 'pipe' });
  git(bare, 'init', '--bare', '--initial-branch', branches[0]);
  const work = mkdtempSync(join(tmpdir(), 'gitlab-mock-seed-'));
  git(work, 'init', '--initial-branch', branches[0]);
  for (const [i, branch] of branches.entries()) {
    if (i > 0) git(work, 'checkout', '-b', branch);
    execFileSync('sh', ['-c', `echo "${fullPath} ${branch}" > ${branch}.txt`], { cwd: work });
    git(work, 'add', '.');
    git(work, 'commit', '-m', `seed ${branch}`);
  }
  git(work, 'push', bare, ...branches);
  rmSync(work, { recursive: true, force: true });
}

addProject('group/sub/project', 'private', 'main', ['main', 'feature-x']);
addProject('group/public-proj', 'public', 'develop', ['develop']);
addProject('mock-user/personal', 'internal', 'main', ['main']);
seedRepo('group/sub/project', ['main', 'feature-x']);
seedRepo('group/public-proj', ['develop']);

const apiProject = ({ branches: _branches, ...p }) => p;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function paginate(req, res, url, items) {
  const perPage = Math.min(Number(url.searchParams.get('per_page') || 20), PAGE_CAP);
  const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  const hasNext = page * perPage < items.length;
  const headers = { 'X-Page': String(page), 'X-Per-Page': String(perPage), 'X-Next-Page': hasNext ? String(page + 1) : '' };
  if (hasNext) {
    const next = new URL(url.pathname + url.search, 'https://gitlab.invalid');
    next.searchParams.set('page', String(page + 1));
    headers.Link = `<${next}>; rel="next"`;
  }
  send(res, 200, slice, headers);
}

function findProject(id) {
  const decoded = decodeURIComponent(id);
  return projects.find((p) => String(p.id) === decoded || p.path_with_namespace === decoded);
}

function findNamespace(id) {
  const decoded = decodeURIComponent(id);
  return namespaces.find((n) => String(n.id) === decoded || n.full_path === decoded);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function apiAuthorized(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  return bearer === TOKEN || req.headers['private-token'] === TOKEN;
}

async function handleApi(req, res, url) {
  if (!apiAuthorized(req)) return send(res, 401, { message: '401 Unauthorized' });
  const path = url.pathname.slice('/api/v4'.length);
  let m;

  if (req.method === 'GET' && path === '/user') return send(res, 200, user);
  if (req.method === 'GET' && path === '/projects') return paginate(req, res, url, projects.map(apiProject));
  if (req.method === 'GET' && path === '/groups') return paginate(req, res, url, groups);
  if (req.method === 'GET' && (m = path.match(/^\/namespaces\/([^/]+)$/))) {
    const ns = findNamespace(m[1]);
    return ns ? send(res, 200, ns) : send(res, 404, { message: '404 Namespace Not Found' });
  }
  if (req.method === 'GET' && (m = path.match(/^\/projects\/([^/]+)$/))) {
    const p = findProject(m[1]);
    return p ? send(res, 200, apiProject(p)) : send(res, 404, { message: '404 Project Not Found' });
  }
  if (req.method === 'GET' && (m = path.match(/^\/projects\/([^/]+)\/repository\/branches$/))) {
    const p = findProject(m[1]);
    if (!p) return send(res, 404, { message: '404 Project Not Found' });
    return paginate(req, res, url, p.branches.map((name) => ({ name, default: name === p.default_branch })));
  }
  if (req.method === 'POST' && path === '/projects') {
    const body = await readJson(req);
    if (!body || typeof body.name !== 'string' || !body.name) return send(res, 400, { message: { name: ["can't be blank"] } });
    const ns = body.namespace_id === undefined ? namespaces[0] : namespaces.find((n) => n.id === body.namespace_id);
    if (!ns) return send(res, 404, { message: '404 Namespace Not Found' });
    const slug = body.path || body.name;
    if (!/^[a-zA-Z0-9_.-]+$/.test(slug)) return send(res, 400, { message: { path: ['can contain only letters, digits, \'_\', \'-\' and \'.\''] } });
    const fullPath = `${ns.full_path}/${slug}`;
    if (findProject(fullPath)) {
      return send(res, 400, { message: { name: ['has already been taken'], path: ['has already been taken'] } });
    }
    // A new project is empty: no branches yet, so no default branch either.
    return send(res, 201, apiProject(addProject(fullPath, body.visibility || 'private', null, [])));
  }
  return send(res, 404, { message: '404 Not Found' });
}

/** Proxies git smart HTTP to `git http-backend` (CGI) after Basic auth. */
function handleGit(req, res, url) {
  const basic = req.headers.authorization?.match(/^Basic (.+)$/)?.[1];
  const password = basic ? Buffer.from(basic, 'base64').toString().split(':').slice(1).join(':') : '';
  if (password !== TOKEN) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitLab"', 'Content-Type': 'text/plain' });
    return res.end('HTTP Basic: Access denied\n');
  }
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: REPO_ROOT,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] || '',
      REMOTE_USER: 'mock-user',
      REMOTE_ADDR: req.socket.remoteAddress || '',
    },
  });
  req.pipe(backend.stdin);

  let head = Buffer.alloc(0);
  let headersSent = false;
  backend.stdout.on('data', (chunk) => {
    if (headersSent) return res.write(chunk);
    head = Buffer.concat([head, chunk]);
    const sep = head.indexOf('\r\n\r\n') >= 0 ? head.indexOf('\r\n\r\n') : head.indexOf('\n\n');
    if (sep < 0) return;
    const sepLen = head[sep] === 13 ? 4 : 2;
    let status = 200;
    const headers = {};
    for (const line of head.subarray(0, sep).toString().split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
      else headers[key] = value;
    }
    res.writeHead(status, headers);
    headersSent = true;
    res.write(head.subarray(sep + sepLen));
  });
  backend.on('close', () => {
    if (!headersSent) res.writeHead(500);
    res.end();
  });
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const done = (err) => {
    console.error(`[gitlab-mock] ${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) send(res, 500, { message: '500 Internal Server Error' });
    else res.end();
  };
  try {
    if (url.pathname.startsWith('/api/v4/')) handleApi(req, res, url).catch(done);
    else if (/\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.test(url.pathname)) handleGit(req, res, url);
    else send(res, 404, { message: '404 Not Found' });
  } catch (err) {
    done(err);
  }
}).listen(PORT, () => console.log(`[gitlab-mock] listening on :${PORT}`));
