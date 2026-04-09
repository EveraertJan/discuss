// reader/main.js — entry point for the reader

import { loadTree, goTo, goBack, getRoots, getCurrent } from './navigator.js';
import { initRenderer, renderLoadScreen, renderRoots, renderCurrent } from './renderer.js';
import { initOnboarding } from '../onboarding.js';
import { importJSON, pickFile } from '../io.js';

let _treeTitle = 'Discuss';

document.addEventListener('DOMContentLoaded', () => {
  const topBar     = document.getElementById('top-bar');
  const breadcrumb = document.getElementById('breadcrumb');
  const main       = document.getElementById('main');

  // ── Init renderer ─────────────────────────────────────────────────────────

  initRenderer({
    container:  main,
    topBar,
    breadcrumb,
    onLoad:     _doImport,
  });

  // ── Back button ───────────────────────────────────────────────────────────

  topBar.querySelector('.js-back')?.addEventListener('click', () => {
    const didGoBack = goBack();
    if (!didGoBack) return;
    const current = getCurrent();
    if (current) {
      renderCurrent(_treeTitle);
    } else {
      // Back to root screen
      const roots = getRoots();
      if (roots.length === 1) renderCurrent(_treeTitle); // single root, re-render it
      else renderRoots(_treeTitle);
    }
  });

  // ── Initial screen ────────────────────────────────────────────────────────

  renderLoadScreen();

  // ── Onboarding ────────────────────────────────────────────────────────────

  initOnboarding({
    steps: [
      'Load a .json argument map to begin.',
      'Read the argument at the top. Sources are listed below it.',
      'Tap a possible response to follow that branch.',
      'Use the back button to retrace your steps.',
    ],
    storageKey: 'reader',
    helpBtn:    document.getElementById('btn-help'),
  });
});

// ── Import ────────────────────────────────────────────────────────────────────

async function _doImport() {
  try {
    const file = await pickFile('.json');
    const tree = await importJSON(file);

    _treeTitle = tree.title || 'Untitled Argument';
    loadTree(tree.nodes || []);

    document.title = `${_treeTitle} — Discuss`;

    const roots = getRoots();
    if (roots.length === 0) {
      alert('This file has no nodes.');
      return;
    }

    if (roots.length === 1) {
      // Auto-navigate to single root
      goTo(roots[0].id);
      renderCurrent(_treeTitle);
    } else {
      renderRoots(_treeTitle);
    }
  } catch (err) {
    alert('Could not load file: ' + err.message);
  }
}
