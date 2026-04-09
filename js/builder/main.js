// builder/main.js — entry point for the builder

import { dispatch, subscribe, getState } from '../store.js';
import { initCanvas, render }             from './canvas.js';
import { initInteraction, fitToScreen, autoLayout } from './interaction.js';
import { initSidebar }                    from './sidebar.js';
import { initOnboarding }                 from '../onboarding.js';
import { exportJSON, importJSON, pickFile } from '../io.js';
import { NODE_TYPES }                     from '../config.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const canvas  = document.getElementById('canvas');
  const sidebar = document.getElementById('sidebar');
  const emptyHint = document.getElementById('empty-hint');

  initCanvas(canvas);
  initInteraction(canvas);
  initSidebar(sidebar);

  // Re-render canvas on every state change
  subscribe(state => {
    render(state);
    // Toggle empty hint
    if (emptyHint) emptyHint.style.display = state.nodes.length ? 'none' : 'block';
    // Update document title
    document.title = `${state.title} — Discuss Builder`;
  });

  // Initial render
  render(getState());

  // ── Toolbar buttons ───────────────────────────────────────────────────────

  document.getElementById('btn-new')?.addEventListener('click', () => {
    if (!getState().nodes.length || confirm('Start a new map? Unsaved changes will be lost.')) {
      dispatch({ type: 'NEW_TREE' });
    }
  });

  document.getElementById('btn-import')?.addEventListener('click', async () => {
    const file = await pickFile('.json');
    const tree = await importJSON(file);
    dispatch({ type: 'LOAD_TREE', tree });
    fitToScreen(getState());
  });

  document.getElementById('btn-export')?.addEventListener('click', () => {
    exportJSON(getState());
  });

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    fitToScreen(getState());
  });

  document.getElementById('btn-layout')?.addEventListener('click', () => {
    autoLayout(getState());
  });

  document.getElementById('btn-add')?.addEventListener('click', () => {
    const state = getState();
    // Place new node roughly in center of viewport
    const cx = (document.getElementById('canvas').offsetWidth  / 2 - state.viewport.x) / state.viewport.scale;
    const cy = (document.getElementById('canvas').offsetHeight / 2 - state.viewport.y) / state.viewport.scale;
    dispatch({ type: 'ADD_NODE', parentId: null, x: cx - 80, y: cy - 24, nodeType: NODE_TYPES.CLAIM });
  });

  // ── Editable title ────────────────────────────────────────────────────────

  const titleEl = document.getElementById('map-title');
  if (titleEl) {
    titleEl.addEventListener('blur', () => {
      dispatch({ type: 'SET_TITLE', title: titleEl.textContent.trim() || 'Untitled Argument' });
    });
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    });
    subscribe(state => {
      if (document.activeElement !== titleEl) {
        titleEl.textContent = state.title;
      }
    });
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  initOnboarding({
    steps: [
      'Build your argument map. Each box is a claim or response.',
      'Drag the canvas to pan. Scroll or pinch to zoom.',
      'Tap a node to edit it. Use "Add Response" to branch the argument.',
      'Export your map as a .json file to share or load in the Reader.',
    ],
    storageKey: 'builder',
    helpBtn:    document.getElementById('btn-help'),
  });
});
