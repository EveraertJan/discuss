// github-ui.js — Modal UI for GitHub setup, save, and load
//
// Usage:
//   openGitHubModal({ mode: 'save', getState })         — builder
//   openGitHubModal({ mode: 'load', onLoad })            — reader / builder import
//   openGitHubModal({ mode: 'settings' })                — settings only

import {
  configure, getConfig, isConfigured, clearConfig,
  verifyConfig, listMaps, saveMap, getMap, deleteMap, buildShareUrl,
} from './github.js';

// ── Entry point ───────────────────────────────────────────────────────────────

export function openGitHubModal({ mode = 'load', getState = null, onLoad = null } = {}) {
  _removeModal();
  const overlay = _el('div', { className: 'gh-overlay' });
  document.body.appendChild(overlay);

  // Clicking the backdrop closes the modal
  overlay.addEventListener('click', e => { if (e.target === overlay) _removeModal(); });

  if (!isConfigured()) {
    _renderSetup(overlay, () => _renderMain(overlay, mode, getState, onLoad));
  } else {
    _renderMain(overlay, mode, getState, onLoad);
  }
}

// ── Setup screen ──────────────────────────────────────────────────────────────

function _renderSetup(overlay, onConnected) {
  const cfg = getConfig() ?? {};
  overlay.innerHTML = `
    <div class="gh-modal">
      <div class="gh-modal-header">
        <h2>Connect to GitHub</h2>
        <button class="btn-ghost gh-close">✕</button>
      </div>
      <div class="gh-modal-body">
        <p class="gh-hint">
          Maps are saved as JSON files in a GitHub repository you own.
          Changes are tracked as commits — you can see the full history on GitHub.
        </p>
        <div class="field">
          <label for="gh-owner">GitHub username or org</label>
          <input id="gh-owner" placeholder="janeveraert" value="${_esc(cfg.owner || '')}" />
        </div>
        <div class="field">
          <label for="gh-repo">Repository name</label>
          <input id="gh-repo" placeholder="discuss-maps" value="${_esc(cfg.repo || '')}" />
        </div>
        <div class="field">
          <label for="gh-token">
            Personal Access Token
            <a class="gh-pat-link" href="https://github.com/settings/tokens/new?scopes=repo&description=Discuss+maps" target="_blank" rel="noopener">
              ↗ Create one
            </a>
          </label>
          <input id="gh-token" type="password" placeholder="github_pat_…" value="${_esc(cfg.token || '')}" />
        </div>
        <div class="field">
          <label for="gh-author">Your name <span style="opacity:.5;font-weight:400;text-transform:none">(shown in commits)</span></label>
          <input id="gh-author" placeholder="Jan" value="${_esc(cfg.author || '')}" />
        </div>
        <p class="gh-error" style="display:none"></p>
      </div>
      <div class="gh-modal-footer">
        <button class="btn-ghost gh-close">Cancel</button>
        <button class="btn-primary gh-connect">Connect →</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.gh-close').forEach(b => b.addEventListener('click', _removeModal));

  overlay.querySelector('.gh-connect').addEventListener('click', async () => {
    const owner  = overlay.querySelector('#gh-owner').value.trim();
    const repo   = overlay.querySelector('#gh-repo').value.trim();
    const token  = overlay.querySelector('#gh-token').value.trim();
    const author = overlay.querySelector('#gh-author').value.trim();
    const errEl  = overlay.querySelector('.gh-error');

    if (!owner || !repo || !token) {
      _showError(errEl, 'Please fill in username, repository, and token.');
      return;
    }

    _setLoading(overlay, true);
    configure({ owner, repo, token, author });

    try {
      await verifyConfig();
      _setLoading(overlay, false);
      onConnected();
    } catch (err) {
      clearConfig();
      _setLoading(overlay, false);
      _showError(errEl, `Could not connect: ${err.message}`);
    }
  });
}

// ── Main screen (save / load) ─────────────────────────────────────────────────

async function _renderMain(overlay, mode, getState, onLoad) {
  const cfg = getConfig();
  overlay.innerHTML = `
    <div class="gh-modal">
      <div class="gh-modal-header">
        <h2>${mode === 'save' ? 'Save to GitHub' : 'Load from GitHub'}</h2>
        <button class="btn-ghost gh-close">✕</button>
      </div>
      <div class="gh-modal-body">
        <p class="gh-repo-label">
          <a href="https://github.com/${cfg.owner}/${cfg.repo}" target="_blank" rel="noopener">
            ${_esc(cfg.owner)}/${_esc(cfg.repo)} ↗
          </a>
        </p>
        ${mode === 'save' ? '<button class="btn-primary gh-save-btn" style="width:100%;justify-content:center;margin-bottom:16px">Save current map</button>' : ''}
        <p class="gh-section-label">SAVED MAPS</p>
        <div class="gh-map-list gh-loading-list">Loading…</div>
        <p class="gh-error" style="display:none"></p>
      </div>
      <div class="gh-modal-footer">
        <button class="btn-ghost gh-settings">⚙ Settings</button>
        <button class="btn-ghost gh-close">Close</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.gh-close').forEach(b => b.addEventListener('click', _removeModal));

  overlay.querySelector('.gh-settings')?.addEventListener('click', () => {
    _renderSetup(overlay, () => _renderMain(overlay, mode, getState, onLoad));
  });

  // Save button
  if (mode === 'save' && getState) {
    overlay.querySelector('.gh-save-btn')?.addEventListener('click', async () => {
      const errEl = overlay.querySelector('.gh-error');
      _setLoading(overlay, true);
      try {
        const { commitUrl, filePath } = await saveMap(getState());
        _setLoading(overlay, false);
        _showSuccess(overlay, commitUrl, filePath);
        // Refresh the list after saving
        await _loadMapList(overlay, mode, getState, onLoad);
      } catch (err) {
        _setLoading(overlay, false);
        _showError(errEl, `Save failed: ${err.message}`);
      }
    });
  }

  await _loadMapList(overlay, mode, getState, onLoad);
}

async function _loadMapList(overlay, mode, getState, onLoad) {
  const listEl = overlay.querySelector('.gh-map-list');
  const errEl  = overlay.querySelector('.gh-error');
  if (!listEl) return;

  listEl.classList.add('gh-loading-list');
  listEl.textContent = 'Loading…';

  try {
    const maps = await listMaps();
    listEl.classList.remove('gh-loading-list');

    if (!maps.length) {
      listEl.innerHTML = '<p class="gh-empty">No maps saved yet.</p>';
      return;
    }

    listEl.innerHTML = maps.map(m => `
      <div class="gh-map-row" data-path="${_esc(m.path)}" data-sha="${_esc(m.sha)}">
        <span class="gh-map-name">${_esc(m.name)}</span>
        <div class="gh-map-actions">
          <button class="btn-ghost gh-load-map" title="Load this map">Load</button>
          <button class="btn-ghost gh-delete-map" title="Delete">✕</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.gh-load-map').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row  = btn.closest('.gh-map-row');
        const path = row.dataset.path;
        _setLoading(overlay, true);
        try {
          const tree = await getMap(path);
          _removeModal();
          onLoad?.(tree);
        } catch (err) {
          _setLoading(overlay, false);
          _showError(errEl, `Load failed: ${err.message}`);
        }
      });
    });

    listEl.querySelectorAll('.gh-delete-map').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row  = btn.closest('.gh-map-row');
        const name = row.querySelector('.gh-map-name').textContent;
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        _setLoading(overlay, true);
        try {
          await deleteMap(row.dataset.path, row.dataset.sha);
          _setLoading(overlay, false);
          await _loadMapList(overlay, mode, getState, onLoad);
        } catch (err) {
          _setLoading(overlay, false);
          _showError(errEl, `Delete failed: ${err.message}`);
        }
      });
    });

  } catch (err) {
    listEl.classList.remove('gh-loading-list');
    _showError(errEl, `Could not list maps: ${err.message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _removeModal() {
  document.querySelector('.gh-overlay')?.remove();
}

function _el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

function _setLoading(overlay, on) {
  const btn = overlay.querySelector('.gh-connect, .gh-save-btn');
  if (btn) btn.disabled = on;
  overlay.querySelector('.gh-modal')?.classList.toggle('gh-busy', on);
}

function _showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function _showSuccess(overlay, commitUrl, filePath) {
  const existing = overlay.querySelector('.gh-success');
  if (existing) existing.remove();

  const shareUrl  = filePath ? buildShareUrl(filePath) : null;
  const el        = _el('div', { className: 'gh-success' });

  el.innerHTML = `
    <span>${commitUrl ? `Saved. <a href="${_esc(commitUrl)}" target="_blank" rel="noopener">View commit ↗</a>` : 'Saved.'}</span>
    ${shareUrl ? `<button class="btn-primary gh-copy-link" style="margin-top:8px;width:100%;justify-content:center">Copy reader link</button>` : ''}
  `;

  if (shareUrl) {
    el.querySelector('.gh-copy-link')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(shareUrl).catch(() => prompt('Copy this link:', shareUrl));
      const btn = el.querySelector('.gh-copy-link');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy reader link'; }, 2000); }
    });
  }

  overlay.querySelector('.gh-modal-body')?.prepend(el);
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
