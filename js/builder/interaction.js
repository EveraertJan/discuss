// interaction.js — pointer input: pan, pinch-to-zoom, drag nodes, select, create

import { dispatch, getState } from '../store.js';
import {
  hitTest, screenToWorld, setHovered, setHoveredEdge,
  hitTestConnectionDot, hitTestEdgeBadge, nearestCrossEdge,
  setEdgeDrag, clearEdgeDrag, render,
} from './canvas.js';
import { NODE_TYPES } from '../config.js';

const DRAG_THRESHOLD  = 4;
const GRID            = 50;
const MIN_SCALE       = 0.15;
const MAX_SCALE       = 3;
const DOUBLE_TAP_MS   = 350;   // max ms between taps
const DOUBLE_TAP_PX   = 40;    // max px drift between taps

let _canvas          = null;

// Single-pointer drag state
let _isDraggingBg    = false;
let _isDraggingNode  = false;
let _isDraggingEdge  = false;   // dragging a new cross-edge connection
let _edgeDragFromId  = null;
let _dragNodeId      = null;
let _lastPointer     = { x: 0, y: 0 };
let _dragOffset      = { x: 0, y: 0 };
let _pointerDownPos  = null;
let _didDrag         = false;

// Multi-touch / pinch state
const _pointers      = new Map();   // pointerId → {x, y} canvas-space
let _lastPinchDist   = 0;

// Double-tap state (touch only)
let _lastTap         = { time: 0, x: 0, y: 0 };


// ── Init ──────────────────────────────────────────────────────────────────────

export function initInteraction(canvasEl) {
  _canvas = canvasEl;

  _canvas.addEventListener('pointerdown',   _onPointerDown,  { passive: false });
  _canvas.addEventListener('pointermove',   _onPointerMove,  { passive: false });
  _canvas.addEventListener('pointerup',     _onPointerUp);
  _canvas.addEventListener('pointercancel', _onPointerCancel);

  // dblclick handles mouse double-click to create nodes; touch uses double-tap in _onPointerUp
  _canvas.addEventListener('dblclick', _onDblClick);

  window.addEventListener('keydown', _onKey);
}


// ── Double-click (mouse) → create node ───────────────────────────────────────

function _onDblClick(e) {
  // Ignore if this came from a touch (we handle that via double-tap in pointerup)
  if (e.pointerType === 'touch') return;

  const pos   = _canvasPos(e);
  const state = getState();
  if (hitTest(pos.x, pos.y, state)) return;

  const world   = screenToWorld(pos.x, pos.y, state.viewport);
  const snapped = _snap(world.x - 160, world.y - 20); // center box on cursor
  dispatch({ type: 'ADD_NODE', parentId: null, x: snapped.x, y: snapped.y, nodeType: NODE_TYPES.CLAIM });
}


// ── Pointer down ──────────────────────────────────────────────────────────────

function _onPointerDown(e) {
  e.preventDefault();
  const pos = _canvasPos(e);
  _pointers.set(e.pointerId, pos);
  _canvas.setPointerCapture(e.pointerId);

  // Two fingers — start pinch
  if (_pointers.size === 2) {
    // Cancel any in-progress single-finger drag
    _isDraggingBg   = false;
    _isDraggingNode = false;
    _canvas.classList.remove('dragging-bg', 'dragging-node');
    _lastPinchDist = _getPinchDist();
    return;
  }

  // Three or more — ignore
  if (_pointers.size > 2) return;

  const state = getState();

  // Check connection dot first — takes priority over regular node hit
  const dotNodeId = hitTestConnectionDot(pos.x, pos.y, state);
  if (dotNodeId) {
    _isDraggingEdge = true;
    _edgeDragFromId = dotNodeId;
    _canvas.setPointerCapture(e.pointerId);
    setEdgeDrag({ fromId: dotNodeId, toPos: pos });
    render(state);
    return;
  }

  // Single finger / mouse — existing select + drag logic
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
}


// ── Pointer move ──────────────────────────────────────────────────────────────

function _onPointerMove(e) {
  e.preventDefault();
  const pos = _canvasPos(e);
  _pointers.set(e.pointerId, pos);

  // ── Two-finger pinch ───────────────────────────────────────────────────────
  if (_pointers.size === 2) {
    const dist  = _getPinchDist();
    const ratio = _lastPinchDist > 0 ? dist / _lastPinchDist : 1;
    _lastPinchDist = dist;

    if (isFinite(ratio) && ratio > 0 && ratio !== 1) {
      const center   = _getPinchCenter();
      const state    = getState();
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.viewport.scale * ratio));
      const sc       = newScale / state.viewport.scale;
      dispatch({
        type:     'SET_VIEWPORT',
        viewport: {
          scale: newScale,
          x:     center.x + (state.viewport.x - center.x) * sc,
          y:     center.y + (state.viewport.y - center.y) * sc,
        },
      });
    }
    return;
  }

  // ── Edge drag in progress ────────────────────────────────────────────────
  if (_isDraggingEdge) {
    setEdgeDrag({ fromId: _edgeDragFromId, toPos: pos });
    render(getState());
    return;
  }

  // ── Hover (mouse only — skip on touch for performance) ────────────────────
  if (!_isDraggingBg && !_isDraggingNode) {
    if (e.pointerType === 'mouse') {
      const state  = getState();
      const hitId  = hitTest(pos.x, pos.y, state);
      const edgeId = nearestCrossEdge(pos.x, pos.y, state);
      setHovered(hitId);
      setHoveredEdge(edgeId);
      _canvas.classList.toggle('hovering-node', !!hitId);
      render(state);
    }
    return;
  }

  // ── Single-pointer drag ───────────────────────────────────────────────────
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
    const world = screenToWorld(pos.x - _dragOffset.x, pos.y - _dragOffset.y, state.viewport);
    dispatch({ type: 'MOVE_NODE', id: _dragNodeId, x: world.x, y: world.y });
  }

  _lastPointer = pos;
}


// ── Pointer up ────────────────────────────────────────────────────────────────

function _onPointerUp(e) {
  const pos = _canvasPos(e);

  // ── Edge drag release ─────────────────────────────────────────────────────
  if (_isDraggingEdge) {
    clearEdgeDrag();
    const state    = getState();
    const targetId = hitTest(pos.x, pos.y, state);
    if (targetId && targetId !== _edgeDragFromId) {
      dispatch({ type: 'ADD_EDGE', from: _edgeDragFromId, to: targetId });
    }
    _isDraggingEdge = false;
    _edgeDragFromId = null;
    _pointers.delete(e.pointerId);
    render(getState());
    return;
  }

  // ── Cross-edge badge click (delete) ────────────────────────────────────────
  if (!_didDrag) {
    const state  = getState();
    const edgeId = hitTestEdgeBadge(pos.x, pos.y, state);
    if (edgeId) {
      dispatch({ type: 'DELETE_EDGE', id: edgeId });
      setHoveredEdge(null);
    }
  }

  // ── Double-tap (touch only) ────────────────────────────────────────────────
  if (e.pointerType === 'touch' && !_didDrag && _pointers.size === 1) {
    const now = Date.now();
    const dt  = now - _lastTap.time;
    const dx  = pos.x - _lastTap.x;
    const dy  = pos.y - _lastTap.y;

    if (dt < DOUBLE_TAP_MS && Math.sqrt(dx * dx + dy * dy) < DOUBLE_TAP_PX) {
      // Double-tap: create node on empty space
      const state = getState();
      if (!hitTest(pos.x, pos.y, state)) {
        const world   = screenToWorld(pos.x, pos.y, state.viewport);
        const snapped = _snap(world.x - 160, world.y - 20); // center box on cursor
        dispatch({ type: 'ADD_NODE', parentId: null, x: snapped.x, y: snapped.y, nodeType: NODE_TYPES.CLAIM });
      }
      _lastTap = { time: 0, x: 0, y: 0 }; // reset so triple-tap doesn't re-fire
    } else {
      _lastTap = { time: now, x: pos.x, y: pos.y };
    }
  }

  // ── Snap to grid on node drag release ─────────────────────────────────────
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

  _pointers.delete(e.pointerId);

  // ── Transition: pinch → single-finger pan ─────────────────────────────────
  if (_pointers.size === 1) {
    const [remaining] = _pointers.values();
    _lastPinchDist  = 0;
    _lastPointer    = remaining;
    _pointerDownPos = remaining;
    _didDrag        = false;
    _isDraggingBg   = true;
    _isDraggingNode = false;
    _dragNodeId     = null;
    _canvas.classList.add('dragging-bg');
    _canvas.classList.remove('dragging-node');
    return;
  }

  // ── Full reset ─────────────────────────────────────────────────────────────
  _canvas.classList.remove('dragging-bg', 'dragging-node', 'hovering-node');
  _isDraggingBg   = false;
  _isDraggingNode = false;
  _dragNodeId     = null;
  _pointerDownPos = null;
  _lastPinchDist  = 0;
}

function _onPointerCancel(e) {
  _pointers.delete(e.pointerId);
  _canvas.classList.remove('dragging-bg', 'dragging-node', 'hovering-node');
  _isDraggingBg   = false;
  _isDraggingNode = false;
  _dragNodeId     = null;
  _pointerDownPos = null;
  _lastPinchDist  = 0;
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

  const LEVEL_STEP = 150;
  const NODE_STEP  = 350;  // NODE_WIDTH (320) + 30px gap, rounded to grid

  const childrenOf = {};
  const idSet = new Set(nodes.map(n => n.id));
  nodes.forEach(n => {
    const pid = (n.parentId && idSet.has(n.parentId)) ? n.parentId : null;
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(n.id);
  });

  const level = {};
  const queue = (childrenOf[null] || []).map(id => ({ id, lvl: 0 }));
  while (queue.length) {
    const { id, lvl } = queue.shift();
    level[id] = lvl;
    (childrenOf[id] || []).forEach(cid => queue.push({ id: cid, lvl: lvl + 1 }));
  }

  const byLevel = {};
  nodes.forEach(n => {
    const lvl = level[n.id] ?? 0;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(n.id);
  });

  const positions = {};
  Object.entries(byLevel).forEach(([lvlStr, ids]) => {
    const lvl    = parseInt(lvlStr, 10);
    const count  = ids.length;
    const totalW = count * NODE_STEP;
    const startX = Math.round(-totalW / 2 / GRID) * GRID;
    const y      = lvl * LEVEL_STEP;
    ids.forEach((id, i) => {
      positions[id] = { x: startX + i * NODE_STEP, y };
    });
  });

  nodes.forEach(n => {
    const pos = positions[n.id];
    if (pos) dispatch({ type: 'MOVE_NODE', id: n.id, x: pos.x, y: pos.y });
  });

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
    maxX = Math.max(maxX, n.x + 320);
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

function _snap(x, y) {
  return {
    x: Math.round(x / GRID) * GRID,
    y: Math.round(y / GRID) * GRID,
  };
}

function _getPinchDist() {
  const pts = [..._pointers.values()];
  if (pts.length < 2) return 0;
  const dx = pts[1].x - pts[0].x;
  const dy = pts[1].y - pts[0].y;
  return Math.sqrt(dx * dx + dy * dy);
}

function _getPinchCenter() {
  const pts = [..._pointers.values()];
  return {
    x: (pts[0].x + pts[1].x) / 2,
    y: (pts[0].y + pts[1].y) / 2,
  };
}
