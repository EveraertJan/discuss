// reader/main.js — entry point for the reader

import { loadTree, goTo, goBack, getRoots, getCurrent } from './navigator.js';
import { initRenderer, renderLoadScreen, renderRoots, renderCurrent } from './renderer.js';
// import { initOnboarding } from '../onboarding.js';  // helper mode off for reader — people figure it out
import { importJSON, pickFile } from '../io.js';
import { openGitHubModal } from '../github-ui.js';
import { isConfigured, fetchPublicMap } from '../github.js';

let _treeTitle = 'Discuss';

document.addEventListener('DOMContentLoaded', () => {
  const topBar     = document.getElementById('top-bar');
  const breadcrumb = document.getElementById('breadcrumb');
  const main       = document.getElementById('main');
  const ghWrap     = document.getElementById('gh-load-btn-wrap');

  // ── Init renderer ─────────────────────────────────────────────────────────

  initRenderer({
    container:  main,
    topBar,
    breadcrumb,
    onLoad:     _doImport,
    onGitHub:   _doGitHubLoad,
  });

  // ── Back button ───────────────────────────────────────────────────────────

  topBar.querySelector('.js-back')?.addEventListener('click', () => {
    const didGoBack = goBack();
    if (!didGoBack) return;
    const current = getCurrent();
    if (current) {
      renderCurrent(_treeTitle);
    } else {
      const roots = getRoots();
      if (roots.length === 1) renderCurrent(_treeTitle);
      else renderRoots(_treeTitle);
    }
  });

  // ── GitHub floating button (shown after a tree is loaded) ─────────────────

  document.getElementById('btn-github-reader')?.addEventListener('click', _doGitHubLoad);

  // ── Initial screen or shared-link auto-load ───────────────────────────────

  const params      = new URLSearchParams(window.location.search);
  const sharedOwner = params.get('owner');
  const sharedRepo  = params.get('repo');
  const sharedFile  = params.get('file');

  if (sharedOwner && sharedRepo && sharedFile) {
    // Shared link — auto-fetch and load without any user interaction
    renderLoadScreen(); // show load screen briefly while fetching
    _doSharedLoad(sharedOwner, sharedRepo, sharedFile);
  } else {
    renderLoadScreen();
    if (ghWrap) ghWrap.style.display = isConfigured() ? 'block' : 'none';
  }

  // ── Onboarding — commented out, reader is self-explanatory ──────────────
  // initOnboarding({
  //   steps: [
  //     'Load a .json argument map to begin — from a file or GitHub.',
  //     'Read the argument at the top. Sources are listed below it.',
  //     'Tap a possible response to follow that branch.',
  //     'Use the back button to retrace your steps.',
  //   ],
  //   storageKey: 'reader',
  //   helpBtn:    document.getElementById('btn-help'),
  // });
});

// ── Auto-load from shared link ────────────────────────────────────────────────

async function _doSharedLoad(owner, repo, file) {
  try {
    const tree = await fetchPublicMap(owner, repo, file);
    _loadTree(tree);
  } catch (err) {
    renderLoadScreen();
    alert(`Could not load shared map: ${err.message}`);
  }
}

// ── Load from file ────────────────────────────────────────────────────────────

async function _doImport() {
  try {
    const file = await pickFile('.json');
    const tree = await importJSON(file);
    _loadTree(tree);
  } catch (err) {
    alert('Could not load file: ' + err.message);
  }
}

// ── Load from GitHub ──────────────────────────────────────────────────────────

function _doGitHubLoad() {
  openGitHubModal({
    mode:   'load',
    onLoad: tree => _loadTree(tree),
  });
}

// ── Shared tree loader ────────────────────────────────────────────────────────

function _loadTree(tree) {
  _treeTitle = tree.title || 'Untitled Argument';
  loadTree(tree.nodes || []);
  document.title = `${_treeTitle} — Discuss`;

  // Show GitHub floating button now that a tree is loaded
  const ghWrap = document.getElementById('gh-load-btn-wrap');
  if (ghWrap) ghWrap.style.display = 'block';

  const roots = getRoots();
  if (!roots.length) { alert('This file has no nodes.'); return; }

  if (roots.length === 1) {
    goTo(roots[0].id);
    renderCurrent(_treeTitle);
  } else {
    renderRoots(_treeTitle);
  }
}
