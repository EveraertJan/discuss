// sidebar.js — bottom sheet (mobile) / right panel (desktop) for node editing
//
// KEY INVARIANT: never replace _sidebar.innerHTML while a field has focus.
// _onStateChange only does a full re-render when the *selected node id* changes.
// While the same node is open, only the links section is refreshed (on add/delete).
// All other field updates (label, notes, link text) come from the sidebar itself
// so the DOM never needs to change — no re-render, no lost focus.

import { dispatch, getState, subscribe } from '../store.js';
import { NODE_TYPES, NODE_TYPE_LABELS } from '../config.js';
import { isEnabled as isHelperEnabled, analyseNode, getNextPrompt } from './helper.js';

let _sidebar          = null;
let _currentNodeId    = null;   // id of node currently rendered in sidebar
let _currentLinkCount = 0;      // track link count to detect add/remove (not edit)
let _helperCollapsed  = false;  // session-only collapse state for the Helper Panel

// ── Public API ────────────────────────────────────────────────────────────────

export function initSidebar(sidebarEl) {
  _sidebar = sidebarEl;
  subscribe(_onStateChange);
}

// ── State handler ─────────────────────────────────────────────────────────────

function _onStateChange(state) {
  const node = state.selectedId
    ? state.nodes.find(n => n.id === state.selectedId)
    : null;

  if (!node) {
    // Deselected — show placeholder (keep sidebar open)
    _currentNodeId    = null;
    _currentLinkCount = 0;
    _renderPlaceholder();
    return;
  }

  const linkCount = (node.links || []).length;

  if (node.id !== _currentNodeId) {
    // Different node selected — do a full re-render
    _currentNodeId    = node.id;
    _currentLinkCount = linkCount;
    _helperCollapsed  = false;  // reset collapse on new node
    _sidebar.classList.add('open');
    _render(node, state.nodes);

  } else if (linkCount !== _currentLinkCount) {
    // Same node, but a link was added or removed — refresh only the links list
    _currentLinkCount = linkCount;
    _refreshLinks(node);
    _renderHelperPanel(node, state.nodes);

  } else {
    // Same node, same link count — user is typing in a field.
    // Do NOT touch the fields, but refresh the helper panel analysis.
    _renderHelperPanel(node, state.nodes);
  }
}

// ── Placeholder (no node selected) ───────────────────────────────────────────

function _renderPlaceholder() {
  _sidebar.classList.add('open');
  _sidebar.innerHTML = `
    <div class="sidebar-header">
      <h2>Node</h2>
    </div>
    <div class="sidebar-placeholder">
      <span>Select a node to adjust</span>
    </div>
  `;
}

// ── Full render (only on node change) ────────────────────────────────────────

function _render(node, allNodes) {
  _sidebar.innerHTML = `
    <div class="sidebar-header">
      <h2>Edit Node</h2>
    </div>
    <div class="sidebar-body">
      <div class="js-helper-panel"></div>
      <div class="field">
        <label for="sb-label">Label</label>
        <textarea id="sb-label" rows="3">${_esc(node.label)}</textarea>
      </div>
      <div class="field">
        <label for="sb-type">Type</label>
        <select id="sb-type">
          ${Object.entries(NODE_TYPE_LABELS).map(([val, lbl]) =>
            `<option value="${val}" ${val === node.type ? 'selected' : ''}>${lbl}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="sb-score">Score override</label>
        <input
          id="sb-score"
          type="number"
          placeholder="default (by type)"
          value="${node.score !== undefined && node.score !== null ? node.score : ''}"
          style="width:100%; box-sizing:border-box;"
        />
        <div style="font-size:10px; color:#888; margin-top:4px; line-height:1.5;">
          Conviction change when this node is picked.<br>
          Leave blank to use the type default
          (objection&nbsp;+40, support&nbsp;+20, claim&nbsp;0, fallacy&nbsp;−40).
        </div>
      </div>
      <div class="field">
        <label for="sb-notes">Notes</label>
        <textarea id="sb-notes" rows="4">${_esc(node.notes || '')}</textarea>
      </div>
      <div class="field">
        <label>Sources &amp; Links</label>
        <div class="links-list js-links">
          ${(node.links || []).map((link, i) => _linkRow(link, i)).join('')}
        </div>
        <button class="btn-ghost js-add-link" style="margin-top:8px">+ Add link</button>
      </div>
    </div>
    <div class="sidebar-footer">
      <button class="btn-primary js-add-response">+ Add Response</button>
      <button class="btn-primary js-add-entry">+ Add Entry Point</button>
      <button class="btn-primary btn-delete js-delete">Delete Node</button>
    </div>
  `;

  // ── Label — write directly to state, do NOT re-render ──────────────────
  _sidebar.querySelector('#sb-label').addEventListener('input', e => {
    dispatch({ type: 'UPDATE_NODE', id: node.id, changes: { label: e.target.value } });
  });

  // ── Type ─────────────────────────────────────────────────────────────────
  _sidebar.querySelector('#sb-type').addEventListener('change', e => {
    dispatch({ type: 'UPDATE_NODE', id: node.id, changes: { type: e.target.value } });
  });

  // ── Score override ───────────────────────────────────────────────────────
  _sidebar.querySelector('#sb-score').addEventListener('input', e => {
    const raw   = e.target.value.trim();
    const score = raw === '' ? undefined : Number(raw);
    dispatch({ type: 'UPDATE_NODE', id: node.id, changes: { score } });
  });

  // ── Notes ────────────────────────────────────────────────────────────────
  _sidebar.querySelector('#sb-notes').addEventListener('input', e => {
    dispatch({ type: 'UPDATE_NODE', id: node.id, changes: { notes: e.target.value } });
  });

  // ── Links: input — use event delegation on the container ────────────────
  // This listener survives _refreshLinks() because the container element stays.
  _sidebar.querySelector('.js-links').addEventListener('input', () => {
    _syncLinks(node.id);
  });

  // ── Links: add / delete ─────────────────────────────────────────────────
  _sidebar.querySelector('.js-add-link').addEventListener('click', () => {
    const current  = getState().nodes.find(n => n.id === node.id);
    const newLinks = [...(current?.links || []), { label: '', url: '' }];
    dispatch({ type: 'UPDATE_NODE', id: node.id, changes: { links: newLinks } });
  });

  // Bind delete buttons for the initial render
  _bindDelButtons(node.id);

  // ── Footer actions ────────────────────────────────────────────────────────
  _sidebar.querySelector('.js-add-response').addEventListener('click', () => {
    const parent = getState().nodes.find(n => n.id === node.id);
    dispatch({
      type:     'ADD_NODE',
      parentId: node.id,
      x:        (parent?.x ?? 120) + 20,
      y:        (parent?.y ?? 120) + 120,
      nodeType: NODE_TYPES.SUPPORT,
    });
  });

  _sidebar.querySelector('.js-add-entry').addEventListener('click', () => {
    dispatch({ type: 'ADD_NODE', parentId: null, x: 80, y: 80, nodeType: NODE_TYPES.CLAIM });
  });

  _sidebar.querySelector('.js-delete').addEventListener('click', () => {
    dispatch({ type: 'DELETE_NODE', id: node.id });
  });

  // Render helper panel (reads helper enabled state, no-ops if off)
  _renderHelperPanel(node, allNodes);
}

// ── Helper Panel ──────────────────────────────────────────────────────────────

function _renderHelperPanel(node, allNodes) {
  const panel = _sidebar?.querySelector('.js-helper-panel');
  if (!panel) return;

  if (!isHelperEnabled() || _helperCollapsed) {
    panel.innerHTML = '';
    return;
  }

  const a      = analyseNode(node, allNodes);
  const prompt = getNextPrompt(a);

  const checks = [
    { label: 'Claim',     ok: a.hasClaim },
    { label: 'Grounds',   ok: a.hasGrounds },
    { label: 'Warrant',   ok: a.hasWarrant },
    { label: 'Rebuttal',  ok: a.hasRebuttal },
    { label: 'Backing',   ok: a.hasBacking },
    { label: 'Qualifier', ok: a.hasQualifier },
  ];

  const fallaciesHtml = a.fallacies.map(f => `
    <div class="helper-fallacy">
      <span class="helper-fallacy-icon">⚠</span>
      <span class="helper-fallacy-name">${_esc(f.name)}</span>
      <span class="helper-fallacy-desc" style="display:none">${_esc(f.description)}</span>
      <button class="btn-ghost js-fallacy-toggle" title="Explain">?</button>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="helper-panel">
      <div class="helper-panel-header">
        <span class="helper-panel-title">HELPER</span>
        <button class="btn-ghost js-helper-collapse" title="Collapse">×</button>
      </div>
      <div class="helper-checklist">
        ${checks.map(c => `<div class="helper-check ${c.ok ? 'ok' : 'missing'}">${c.ok ? '✓' : '✗'} ${c.label}</div>`).join('')}
      </div>
      <div class="helper-prompt">${_esc(prompt)}</div>
      ${fallaciesHtml}
    </div>
  `;

  panel.querySelector('.js-helper-collapse')?.addEventListener('click', () => {
    _helperCollapsed = true;
    panel.innerHTML = '';
  });

  panel.querySelectorAll('.js-fallacy-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const desc = btn.previousElementSibling;
      const visible = desc.style.display !== 'none';
      desc.style.display = visible ? 'none' : 'block';
      btn.textContent = visible ? '?' : '×';
    });
  });
}

// ── Partial refresh — links only ──────────────────────────────────────────────
// Called when a link is added or deleted. Does NOT touch label/type/notes inputs.

function _refreshLinks(node) {
  const container = _sidebar.querySelector('.js-links');
  if (!container) return;

  // Replace only the children, not the container itself (preserves the 'input'
  // delegation listener that was attached in _render).
  container.innerHTML = (node.links || []).map((link, i) => _linkRow(link, i)).join('');

  // Re-bind delete buttons (the old button elements were removed).
  _bindDelButtons(node.id);

  // Focus the label input of the newly added link (last row), if it's a blank new one.
  const lastLink = node.links?.[node.links.length - 1];
  if (lastLink && !lastLink.label && !lastLink.url) {
    container.querySelectorAll('.js-link-label').item(node.links.length - 1)?.focus();
  }
}

// ── Bind delete buttons (called after any links DOM update) ───────────────────

function _bindDelButtons(nodeId) {
  _sidebar.querySelectorAll('.js-del-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx      = parseInt(btn.dataset.idx, 10);
      const current  = getState().nodes.find(n => n.id === nodeId);
      const newLinks = [...(current?.links || [])];
      newLinks.splice(idx, 1);
      dispatch({ type: 'UPDATE_NODE', id: nodeId, changes: { links: newLinks } });
    });
  });
}

// ── Sync all link inputs → state (called on input delegation) ────────────────

function _syncLinks(nodeId) {
  const labelInputs = _sidebar.querySelectorAll('.js-link-label');
  const urlInputs   = _sidebar.querySelectorAll('.js-link-url');
  const links = Array.from(labelInputs).map((input, i) => ({
    label: input.value,
    url:   urlInputs[i]?.value ?? '',
  }));
  dispatch({ type: 'UPDATE_NODE', id: nodeId, changes: { links } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _linkRow(link, i) {
  return `
    <div class="link-row">
      <input class="js-link-label" data-idx="${i}" placeholder="Label" value="${_esc(link.label || '')}" />
      <input class="js-link-url"   data-idx="${i}" placeholder="https://…" value="${_esc(link.url || '')}" />
      <button class="btn-ghost js-del-link" data-idx="${i}" title="Remove">✕</button>
    </div>
  `;
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
