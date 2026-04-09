// interaction.js — touch/mouse: pan, zoom, drag, select, double-click create

import { dispatch, getState } from '../store.js';
import { hitTest, screenToWorld, setHovered, render } from './canvas.js';
import { NODE_TYPES } from '../config.js';

const DRAG_THRESHOLD = 4;
const GRID           = 50;   // snap-to-grid resolution in world units

// Discrete zoom levels: 80 %, 100 %, 120 %
const ZOOM_LEVELS  = [0.8, 1.0, 1.2];
const ZOOM_COOLDOWN = 180;  // ms — ignore wheel events fired within this window
let _lastZoomTime  = 0;
let _pinchLiveScale = 1;    // free-scale during an active pinch, snapped on release

let _canvas          = null;
let _isDraggingBg    = false;
let _isDraggingNode  = false;
let _dragNodeId      = null;
let _lastPointer     = { x: 0, y: 0 };
let _dragOffset      = { x: 0, y: 0 };
let _pointerDownPos  = null;
let _didDrag         = false;

// Pinch state
let _pinchStartDist  = 0;
let _pinchStartScale = 1;
let _pinchMid        = { x: 0, y: 0 };

// ── Init ──────────────────────────────────────────────────────────────────────

export function initInteraction(canvasEl) {
  _canvas = canvasEl;

  _canvas.addEventListener('pointerdown',   _onPointerDown,  { passive: false });
  _canvas.addEventListener('pointermove',   _onPointerMove,  { passive: false });
  _canvas.addEventListener('pointerup',     _onPointerUp);
  _canvas.addEventListener('pointercancel', _onPointerUp);
  _canvas.addEventListener('dblclick',      _onDblClick);

  _canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
  _canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
  _canvas.addEventListener('touchend',   _onTouchEnd);

  _canvas.addEventListener('wheel', _onWheel, { passive: false });

  window.addEventListener('keydown', _onKey);
}

// ── Double-click → create node ────────────────────────────────────────────────

function _onDblClick(e) {
  const pos   = _canvasPos(e);
  const state = getState();

  // Don't create if clicking an existing node
  if (hitTest(pos.x, pos.y, state)) return;

  const world = screenToWorld(pos.x, pos.y, state.viewport);
  const snapped = _snap(world.x - 80, world.y - 24); // center node on cursor

  dispatch({
    type:     'ADD_NODE',
    parentId: null,
    x:        snapped.x,
    y:        snapped.y,
    nodeType: NODE_TYPES.CLAIM,
  });
}

// ── Pointer ───────────────────────────────────────────────────────────────────

function _onPointerDown(e) {
  if (e.pointerType === 'touch' && e.touches?.length > 1) return;
  e.preventDefault();

  const pos   = _canvasPos(e);
  const state = getState();
  const hitId = hitTest(pos.x, pos.y, state);

  _pointerDownPos = pos;
  _didDrag        = false;
  _lastPointer    = pos;

  if (hitId) {
    const node = state.nodes.find(n => n.id === hitId);
    const s    = _w2s(node.x, node.y, state.viewport);
    _isDraggingNode = true;
    _dragNodeId     = hitId;
    _dragOffset     = { x: pos.x - s.x, y: pos.y - s.y };
    _canvas.classList.add('dragging-node');
    dispatch({ type: 'SELECT_NODE', id: hitId });
  } else {
    _isDraggingBg = true;
    _canvas.classList.add('dragging-bg');
    dispatch({ type: 'SELECT_NODE', id: null });
  }

  _canvas.setPointerCapture(e.pointerId);
}

function _onPointerMove(e) {
  e.preventDefault();
  const pos = _canvasPos(e);

  if (!_isDraggingBg && !_isDraggingNode) {
    // Hover detection
    const state = getState();
    const hitId = hitTest(pos.x, pos.y, state);
    setHovered(hitId);
    _canvas.classList.toggle('hovering-node', !!hitId);
    render(state);
    return;
  }

  if (_pointerDownPos) {
    const dx = pos.x - _pointerDownPos.x;
    const dy = pos.y - _pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) _didDrag = true;
  }

  const state  = getState();
  const deltaX = pos.x - _lastPointer.x;
  const deltaY = pos.y - _lastPointer.y;

  if (_isDraggingBg) {
    dispatch({
      type:     'SET_VIEWPORT',
      viewport: { x: state.viewport.x + deltaX, y: state.viewport.y + deltaY },
    });
  } else if (_isDraggingNode && _dragNodeId) {
    // Move live (no snap while dragging — feels better)
    const world = screenToWorld(pos.x - _dragOffset.x, pos.y - _dragOffset.y, state.viewport);
    dispatch({ type: 'MOVE_NODE', id: _dragNodeId, x: world.x, y: world.y });
  }

  _lastPointer = pos;
}

function _onPointerUp(e) {
  // Snap to grid on release
  if (_isDraggingNode && _dragNodeId && _didDrag) {
    const state = getState();
    const node  = state.nodes.find(n => n.id === _dragNodeId);
    if (node) {
      const snapped = _snap(node.x, node.y);
      if (snapped.x !== node.x || snapped.y !== node.y) {
        dispatch({ type: 'MOVE_NODE', id: _dragNodeId, x: snapped.x, y: snapped.y });
      }
    }
  }

  _canvas.classList.remove('dragging-bg', 'dragging-node', 'hovering-node');
  _isDraggingBg   = false;
  _isDraggingNode = false;
  _dragNodeId     = null;
  _pointerDownPos = null;
}

// ── Touch / Pinch ─────────────────────────────────────────────────────────────

function _touchDist(t) {
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function _touchMid(t) {
  const rect = _canvas.getBoundingClientRect();
  return {
    x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
    y: (t[0].clientY + t[1].clientY) / 2 - rect.top,
  };
}

function _onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    _isDraggingBg    = false;
    _isDraggingNode  = false;
    _pinchStartDist  = _touchDist(e.touches);
    _pinchStartScale = getState().viewport.scale;
    _pinchLiveScale  = _pinchStartScale;
    _pinchMid        = _touchMid(e.touches);
  }
}

function _onTouchMove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dist  = _touchDist(e.touches);
    // Allow free scaling during the gesture for live feedback
    const MIN = ZOOM_LEVELS[0] * 0.9;
    const MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] * 1.1;
    _pinchLiveScale = Math.min(MAX, Math.max(MIN, _pinchStartScale * (dist / _pinchStartDist)));
    const state = getState();
    const mid   = screenToWorld(_pinchMid.x, _pinchMid.y, state.viewport);
    dispatch({
      type: 'SET_VIEWPORT',
      viewport: { scale: _pinchLiveScale, x: _pinchMid.x - mid.x * _pinchLiveScale, y: _pinchMid.y - mid.y * _pinchLiveScale },
    });
  }
}

function _onTouchEnd() {
  if (_pinchStartDist > 0) {
    // Snap to nearest discrete level
    const direction = _pinchLiveScale > _pinchStartScale ? 1 : -1;
    _stepZoom(direction, _pinchMid);
  }
  _pinchStartDist = 0;
}

// ── Wheel zoom — steps through ZOOM_LEVELS ────────────────────────────────────

function _onWheel(e) {
  e.preventDefault();
  const now = Date.now();
  if (now - _lastZoomTime < ZOOM_COOLDOWN) return;
  _lastZoomTime = now;

  const direction = e.deltaY > 0 ? -1 : 1;  // scroll down = zoom out
  _stepZoom(direction, _canvasPos(e));
}

/** Advance to the next discrete zoom level in the given direction (+1 / -1).
 *  Keeps the world point under `focalPt` stationary. */
function _stepZoom(direction, focalPt) {
  const state   = getState();
  const current = state.viewport.scale;

  // Find the index of the closest current level
  let idx = 0;
  let minDiff = Infinity;
  ZOOM_LEVELS.forEach((lvl, i) => {
    const d = Math.abs(lvl - current);
    if (d < minDiff) { minDiff = d; idx = i; }
  });

  const nextIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + direction));
  const scale   = ZOOM_LEVELS[nextIdx];
  if (scale === current) return;

  const world = screenToWorld(focalPt.x, focalPt.y, state.viewport);
  dispatch({
    type: 'SET_VIEWPORT',
    viewport: {
      scale,
      x: focalPt.x - world.x * scale,
      y: focalPt.y - world.y * scale,
    },
  });
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

function _onKey(e) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const state = getState();
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (state.selectedId) dispatch({ type: 'DELETE_NODE', id: state.selectedId });
      break;
    case 'Escape':
      dispatch({ type: 'SELECT_NODE', id: null });
      break;
    case 'f': case 'F':
      fitToScreen(getState());
      break;
    case '?':
      document.getElementById('btn-help')?.click();
      break;
  }
}

// ── Auto-layout ───────────────────────────────────────────────────────────────

export function autoLayout(state) {
  const { nodes } = state;
  if (!nodes.length) return;

  // Both step values are exact multiples of GRID (50px), so every resulting
  // position is guaranteed on-grid with no rounding drift between siblings.
  const LEVEL_STEP = 150;  // 3 × 50 — vertical distance between levels
  const NODE_STEP  = 200;  // 4 × 50 — horizontal slot per node (160px wide + 40 gap)

  // Build parent→children map (ignore parentIds that point to missing nodes)
  const childrenOf = {};
  const idSet = new Set(nodes.map(n => n.id));
  nodes.forEach(n => {
    const pid = (n.parentId && idSet.has(n.parentId)) ? n.parentId : null;
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(n.id);
  });

  // BFS to assign depth levels
  const level = {};
  const queue = (childrenOf[null] || []).map(id => ({ id, lvl: 0 }));
  while (queue.length) {
    const { id, lvl } = queue.shift();
    level[id] = lvl;
    (childrenOf[id] || []).forEach(cid => queue.push({ id: cid, lvl: lvl + 1 }));
  }

  // Group node ids by level
  const byLevel = {};
  nodes.forEach(n => {
    const lvl = level[n.id] ?? 0;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(n.id);
  });

  // Place nodes: each level centred on x=0, using exact grid multiples
  const positions = {};
  Object.entries(byLevel).forEach(([lvlStr, ids]) => {
    const lvl    = parseInt(lvlStr, 10);
    const count  = ids.length;
    const totalW = count * NODE_STEP;
    // Snap the row's left edge to grid so all offsets stay on-grid
    const startX = Math.round(-totalW / 2 / GRID) * GRID;
    const y      = lvl * LEVEL_STEP;   // already a multiple of GRID

    ids.forEach((id, i) => {
      positions[id] = { x: startX + i * NODE_STEP, y };
    });
  });

  // Dispatch a single move per node
  nodes.forEach(n => {
    const pos = positions[n.id];
    if (pos) dispatch({ type: 'MOVE_NODE', id: n.id, x: pos.x, y: pos.y });
  });

  // Fit the result into view
  setTimeout(() => fitToScreen(getState()), 16);
}

// ── Fit to screen ─────────────────────────────────────────────────────────────

export function fitToScreen(state) {
  const { nodes } = state;
  if (!nodes.length || !_canvas) return;

  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + 160);
    maxY = Math.max(maxY, n.y + 80);
  });

  const padding = 64;
  const cw      = _canvas.offsetWidth;
  const ch      = _canvas.offsetHeight;
  const tw      = maxX - minX;
  const th      = maxY - minY;
  const scale   = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
    Math.min((cw - padding * 2) / tw, (ch - padding * 2) / th)
  ));

  dispatch({
    type: 'SET_VIEWPORT',
    viewport: {
      scale,
      x: (cw - tw * scale) / 2 - minX * scale,
      y: (ch - th * scale) / 2 - minY * scale,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _canvasPos(e) {
  const rect = _canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function _w2s(wx, wy, viewport) {
  return { x: wx * viewport.scale + viewport.x, y: wy * viewport.scale + viewport.y };
}

/** Snap world coordinate to nearest GRID multiple. */
function _snap(x, y) {
  return {
    x: Math.round(x / GRID) * GRID,
    y: Math.round(y / GRID) * GRID,
  };
}
