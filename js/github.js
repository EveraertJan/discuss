// github.js — GitHub REST API wrapper for saving/loading maps
//
// Maps are stored as JSON files in a `maps/` directory in the configured repo.
// All reads and writes use a Personal Access Token (PAT) stored in localStorage.
// No server required — GitHub's API has permissive CORS headers.

const LS_KEY   = 'discuss_github_config';
const API_BASE = 'https://api.github.com';
const MAPS_DIR = 'maps';

// ── Config ────────────────────────────────────────────────────────────────────

export function configure({ owner, repo, token, author }) {
  localStorage.setItem(LS_KEY, JSON.stringify({ owner, repo, token, author }));
}

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? null; }
  catch { return null; }
}

export function isConfigured() {
  const cfg = getConfig();
  return !!(cfg?.owner && cfg?.repo && cfg?.token);
}

export function clearConfig() {
  localStorage.removeItem(LS_KEY);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function _req(method, path, body) {
  const cfg = getConfig();
  if (!cfg) throw new Error('GitHub not configured');

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${cfg.token}`,
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }

  return res.status === 204 ? null : res.json();
}

function _repoPath(rest = '') {
  const { owner, repo } = getConfig();
  return `/repos/${owner}/${repo}/contents/${MAPS_DIR}${rest ? `/${rest}` : ''}`;
}

// Base64 encode/decode with full Unicode support
function _b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function _b64decode(b64) {
  // GitHub returns the content with newlines — strip them first
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns an array of { name, path, sha, download_url } for all maps in the repo. */
export async function listMaps() {
  try {
    const items = await _req('GET', _repoPath());
    return items
      .filter(f => f.type === 'file' && f.name.endsWith('.json'))
      .map(f => ({ name: f.name.replace(/\.json$/, ''), path: f.path, sha: f.sha, download_url: f.download_url }));
  } catch (err) {
    // 404 means the maps/ directory doesn't exist yet — return empty list
    if (err.message.includes('404') || err.message.includes('Not Found')) return [];
    throw err;
  }
}

/** Fetch and parse a single map by its repo path. */
export async function getMap(filePath) {
  const data = await _req('GET', `/repos/${getConfig().owner}/${getConfig().repo}/contents/${filePath}`);
  return JSON.parse(_b64decode(data.content));
}

/**
 * Save the current state as a map file.
 * If a file with the same name already exists, updates it (preserving git history).
 * Returns the commit URL.
 */
export async function saveMap(state) {
  const cfg      = getConfig();
  const slug     = (state.title || 'untitled').replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '-') || 'map';
  const filename = `${slug}.json`;
  const content  = _b64encode(JSON.stringify({ title: state.title, nodes: state.nodes }, null, 2));
  const now      = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const author   = cfg.author ? `${cfg.author}` : cfg.owner;
  const message  = `${state.title} — saved by ${author} on ${now}`;

  // Check if file already exists (need its SHA to update)
  let sha;
  try {
    const existing = await _req('GET', _repoPath(filename));
    sha = existing.sha;
  } catch {
    sha = undefined; // New file
  }

  const body     = { message, content, ...(sha ? { sha } : {}) };
  const result   = await _req('PUT', _repoPath(filename), body);
  const filePath = `${MAPS_DIR}/${filename}`;
  return {
    commitUrl: result?.commit?.html_url ?? null,
    filePath,
  };
}

/**
 * Delete a map file from the repo.
 * sha must be the current sha of the file (from listMaps).
 */
export async function deleteMap(filePath, sha) {
  const cfg     = getConfig();
  const name    = filePath.split('/').pop().replace(/\.json$/, '');
  const message = `Delete: ${name}`;
  await _req('DELETE', `/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`, { message, sha });
}

/** Quick connectivity check — verifies the token and repo exist. */
export async function verifyConfig() {
  const cfg = getConfig();
  const res = await _req('GET', `/repos/${cfg.owner}/${cfg.repo}`);
  return res?.full_name ?? null;
}

/**
 * Build a shareable reader URL for a saved map.
 * The link encodes owner/repo/file as URL params so anyone can open it —
 * the reader fetches the latest version from GitHub without needing any config.
 *
 * @param {string} filePath  e.g. "maps/my-argument.json"
 */
export function buildShareUrl(filePath) {
  const cfg    = getConfig();
  const base   = window.location.href.replace(/[^/]*$/, ''); // strip current filename
  const params = new URLSearchParams({ owner: cfg.owner, repo: cfg.repo, file: filePath });
  return `${base}reader.html?${params}`;
}

/**
 * Fetch a map from a public GitHub repo by URL params — no PAT required.
 * Falls back to the GitHub API with the stored PAT if the raw fetch fails
 * (covers private repos where the user already has config stored).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath  e.g. "maps/my-argument.json"
 */
export async function fetchPublicMap(owner, repo, filePath) {
  // Try raw GitHub CDN first (no auth, works for public repos, always latest)
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`;
  const rawRes = await fetch(rawUrl);
  if (rawRes.ok) return rawRes.json();

  // Fall back to API (uses stored PAT if available, covers private repos)
  const cfg     = getConfig();
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (cfg?.token) headers['Authorization'] = `Bearer ${cfg.token}`;

  const apiRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${filePath}`, { headers });
  if (!apiRes.ok) throw new Error(`Could not load map (${apiRes.status})`);

  const data = await apiRes.json();
  return JSON.parse(_b64decode(data.content));
}
