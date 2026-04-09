// renderer.js — render current node as DOM cards

import { NODE_TYPE_LABELS } from '../config.js';
import { goTo, goBack, getCurrent, getChildren, getRoots, canGoBack, getHistoryNodes } from './navigator.js';

let _container  = null;
let _topBar     = null;
let _breadcrumb = null;
let _onLoad     = null; // callback when user requests file import

// ── Public API ────────────────────────────────────────────────────────────────

export function initRenderer({ container, topBar, breadcrumb, onLoad }) {
  _container  = container;
  _topBar     = topBar;
  _breadcrumb = breadcrumb;
  _onLoad     = onLoad;
}

/** Render the initial load screen (no tree loaded). */
export function renderLoadScreen() {
  _setTitle('Discuss');
  _hideBreadcrumb();
  _updateBackButton(false);

  _container.innerHTML = `
    <div id="load-screen">
      <div class="load-card">
        <h1>Discuss</h1>
        <p>Load an argument map to begin</p>
        <button class="btn-primary js-import">Import JSON</button>
        <button class="btn-ghost js-what">What is this?</button>
      </div>
    </div>
  `;

  _container.querySelector('.js-import').addEventListener('click', _onLoad);
  _container.querySelector('.js-what').addEventListener('click', () => {
    document.getElementById('btn-help')?.click();
  });
}

/** Render root-selection screen when multiple roots exist. */
export function renderRoots(title) {
  const roots = getRoots();
  _setTitle(title || 'Discuss');
  _hideBreadcrumb();
  _updateBackButton(false);

  _container.innerHTML = `
    <div id="roots-screen">
      <div class="responses-section">
        <p class="responses-heading">Entry Points</p>
        ${roots.map(n => _responseCardHTML(n)).join('')}
      </div>
    </div>
  `;

  _container.querySelectorAll('.response-card').forEach(card => {
    card.addEventListener('click', () => {
      goTo(card.dataset.id);
      renderCurrent(title);
    });
  });
}

/** Render the current node view. */
export function renderCurrent(title) {
  const node     = getCurrent();
  const children = node ? getChildren(node.id) : [];

  _setTitle(title || 'Discuss');
  _updateBackButton(canGoBack());
  _renderBreadcrumb();

  if (!node) {
    renderRoots(title);
    return;
  }

  const hasNotes   = node.notes && node.notes.trim().length > 0;
  const hasLinks   = node.links && node.links.length > 0;
  const typeLabel  = NODE_TYPE_LABELS[node.type] || node.type || '';

  _container.innerHTML = `
    <div id="node-view">
      <div class="node-header">
        <span class="type-badge">${_esc(typeLabel)}</span>
        <h2 class="node-label">${_esc(node.label)}</h2>
      </div>

      ${hasNotes ? `
        <details>
          <summary>Notes</summary>
          <p class="notes-body">${_escNL(node.notes)}</p>
        </details>
      ` : ''}

      ${hasLinks ? `
        <details open>
          <summary>Sources</summary>
          <div class="sources-list">
            ${node.links.map(link => `
              <a href="${_esc(link.url || '#')}" target="_blank" rel="noopener noreferrer">
                ${_esc(link.label || link.url || 'Link')}
              </a>
            `).join('')}
          </div>
        </details>
      ` : ''}

      <div class="responses-section">
        <p class="responses-heading">Possible Responses</p>
        ${children.length
          ? children.map(n => _responseCardHTML(n)).join('')
          : '<p class="terminal-note">This is a terminal argument.</p>'
        }
      </div>
    </div>
  `;

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Wire up response cards
  _container.querySelectorAll('.response-card').forEach(card => {
    card.addEventListener('click', () => {
      goTo(card.dataset.id);
      renderCurrent(title);
    });
  });
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _responseCardHTML(node) {
  const typeLabel = NODE_TYPE_LABELS[node.type] || '';
  return `
    <button class="response-card" data-id="${_esc(node.id)}">
      <span class="response-label">${_esc(node.label)}</span>
      <span class="node-type">${_esc(typeLabel)}</span>
      <span class="arrow">→</span>
    </button>
  `;
}

function _setTitle(title) {
  const el = _topBar?.querySelector('.title');
  if (el) el.textContent = title;
}

function _updateBackButton(enabled) {
  const btn = _topBar?.querySelector('.js-back');
  if (!btn) return;
  btn.style.visibility = enabled ? 'visible' : 'hidden';
}

function _renderBreadcrumb() {
  if (!_breadcrumb) return;
  const history = getHistoryNodes();
  if (!history.length) { _hideBreadcrumb(); return; }

  const MAX = 3;
  const visible = history.slice(-MAX);
  const hasMore = history.length > MAX;

  _breadcrumb.textContent = [
    hasMore ? '…' : null,
    ...visible.map(n => n.label),
  ].filter(Boolean).join(' › ');
}

function _hideBreadcrumb() {
  if (_breadcrumb) _breadcrumb.textContent = '';
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escNL(str) {
  return _esc(str).replace(/\n/g, '<br>');
}
