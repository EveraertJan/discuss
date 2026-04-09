// canvas.js — draw nodes, edges, hit-testing

import { NODE_WIDTH, NODE_MIN_HEIGHT, NODE_PADDING, NODE_TYPE_LABELS, NODE_TYPE_COLORS, LINE_HEIGHT } from '../config.js';
import { getState } from '../store.js';
import { isEnabled as isHelperEnabled, isComplete, hasFallacyWarning } from './helper.js';

let _canvas       = null;
let _ctx          = null;
let _hoveredId    = null;
let _hoveredEdgeId = null;   // id of cross-edge under cursor
let _edgeDrag     = null;    // { fromId, toPos: {x,y} } screen coords — live drag preview

// ── Public API ────────────────────────────────────────────────────────────────

export function initCanvas(canvasEl) {
  _canvas = canvasEl;
  _ctx    = _canvas.getContext('2d');
  _resize();
  window.addEventListener('resize', _resize);
}

export function setHovered(id)      { _hoveredId = id ?? null; }
export function setHoveredEdge(id)  { _hoveredEdgeId = id ?? null; }
export function setEdgeDrag(state)  { _edgeDrag = state; }
export function clearEdgeDrag()     { _edgeDrag = null; }

export function render(state) {
  if (!_canvas || !_ctx) return;
  const W = _canvas.offsetWidth;
  const H = _canvas.offsetHeight;
  _ctx.clearRect(0, 0, W, H);
  _drawCrossEdges(state);
  _drawPrimaryEdges(state);
  _drawNodes(state);
  _drawEdgeDragPreview(state);
}

/** Box hit-test only (not label area above). */
export function hitTest(sx, sy, state) {
  const { nodes, viewport } = state;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n  = nodes[i];
    const s  = _w2s(n.x, n.y, viewport);
    const sw = NODE_WIDTH * viewport.scale;
    const sh = _nodeHeight(n.label) * viewport.scale;
    if (sx >= s.x && sx <= s.x + sw && sy >= s.y && sy <= s.y + sh) return n.id;
  }
  return null;
}

/**
 * Hit-test the connection dot on the right-centre of each node.
 * Returns node id or null.
 */
export function hitTestConnectionDot(sx, sy, state) {
  const { nodes, viewport } = state;
  const R = 14; // generous hit radius for touch
  for (const n of nodes) {
    const dot = _dotPos(n, viewport);
    const dx  = sx - dot.x;
    const dy  = sy - dot.y;
    if (dx * dx + dy * dy <= R * R) return n.id;
  }
  return null;
}

/**
 * Hit-test cross-edge delete badges (small × at edge midpoint).
 * Returns edge id or null.
 */
export function hitTestEdgeBadge(sx, sy, state) {
  const { nodes, edges = [], viewport } = state;
  const R = 12;
  for (const edge of edges) {
    const fn = nodes.find(n => n.id === edge.from);
    const tn = nodes.find(n => n.id === edge.to);
    if (!fn || !tn) continue;
    const mid = _crossEdgeMid(fn, tn, viewport);
    const dx  = sx - mid.x;
    const dy  = sy - mid.y;
    if (dx * dx + dy * dy <= R * R) return edge.id;
  }
  return null;
}

/**
 * Find the closest cross-edge to a point (for hover highlight).
 * Returns edge id or null.
 */
export function nearestCrossEdge(sx, sy, state) {
  const { nodes, edges = [], viewport } = state;
  const THRESHOLD = 16;
  let bestId   = null;
  let bestDist = Infinity;
  for (const edge of edges) {
    const fn = nodes.find(n => n.id === edge.from);
    const tn = nodes.find(n => n.id === edge.to);
    if (!fn || !tn) continue;
    const mid  = _crossEdgeMid(fn, tn, viewport);
    const dist = Math.hypot(sx - mid.x, sy - mid.y);
    if (dist < THRESHOLD && dist < bestDist) { bestDist = dist; bestId = edge.id; }
  }
  return bestId;
}

export function screenToWorld(sx, sy, viewport) {
  return {
    x: (sx - viewport.x) / viewport.scale,
    y: (sy - viewport.y) / viewport.scale,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _resize() {
  if (!_canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const W    = _canvas.offsetWidth;
  const H    = _canvas.offsetHeight;
  _canvas.width  = W * dpr;
  _canvas.height = H * dpr;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(getState());
}

function _w2s(wx, wy, viewport) {
  return { x: wx * viewport.scale + viewport.x, y: wy * viewport.scale + viewport.y };
}

/** Right-centre dot position in screen space. */
function _dotPos(node, viewport) {
  const sh = _nodeHeight(node.label);
  return _w2s(node.x + NODE_WIDTH, node.y + sh / 2, viewport);
}

/** Left-centre entry point in screen space. */
function _leftCenterPos(node, viewport) {
  const sh = _nodeHeight(node.label);
  return _w2s(node.x, node.y + sh / 2, viewport);
}

/** Geometric midpoint of a cross-edge (bezier mid ≈ geometric mid for symmetric curve). */
function _crossEdgeMid(fromNode, toNode, viewport) {
  const fs = _dotPos(fromNode, viewport);
  const ts = _leftCenterPos(toNode, viewport);
  return { x: (fs.x + ts.x) / 2, y: (fs.y + ts.y) / 2 };
}

export function _nodeHeight(label = '') {
  if (!_ctx) return NODE_MIN_HEIGHT;
  const text     = label || 'Node';
  const maxWidth = NODE_WIDTH - NODE_PADDING * 2;
  _ctx.font      = `500 13px "DM Sans", sans-serif`;
  const words    = text.split(' ');
  let lines      = 1;
  let line       = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (_ctx.measureText(test).width > maxWidth && line) { lines++; line = word; }
    else { line = test; }
  }
  return Math.max(NODE_MIN_HEIGHT, NODE_PADDING * 2 + lines * LINE_HEIGHT);
}

function _arrowhead(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size  = 7;
  _ctx.beginPath();
  _ctx.moveTo(x2, y2);
  _ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  _ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  _ctx.closePath();
  _ctx.fill();
}

function _drawWrappedText(text, x, y, maxWidth) {
  const words = text.split(' ');
  let line    = '';
  let cy      = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (_ctx.measureText(test).width > maxWidth && line) {
      _ctx.fillText(line, x, cy);
      cy += LINE_HEIGHT;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) _ctx.fillText(line, x, cy);
}

// ── Primary edges (parentId tree) ─────────────────────────────────────────────

function _drawPrimaryEdges({ nodes, viewport }) {
  _ctx.save();
  const fg       = _fg();
  _ctx.strokeStyle = fg;
  _ctx.fillStyle   = fg;
  _ctx.lineWidth   = 1.5;

  nodes.forEach(node => {
    if (!node.parentId) return;
    const parent = nodes.find(n => n.id === node.parentId);
    if (!parent) return;

    const ph  = _nodeHeight(parent.label);
    const ps  = _w2s(parent.x + NODE_WIDTH / 2, parent.y + ph, viewport);
    const cs  = _w2s(node.x   + NODE_WIDTH / 2, node.y,        viewport);
    const dy  = Math.abs(cs.y - ps.y);
    const cp  = Math.max(40, dy * 0.5);
    const cp1 = { x: ps.x, y: ps.y + cp };
    const cp2 = { x: cs.x, y: cs.y - cp };

    _ctx.beginPath();
    _ctx.moveTo(ps.x, ps.y);
    _ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, cs.x, cs.y);
    _ctx.stroke();
    _arrowhead(cp2.x, cp2.y, cs.x, cs.y);
  });
  _ctx.restore();
}

// ── Cross-edges (additional connections) ─────────────────────────────────────

function _drawCrossEdges({ nodes, edges = [], viewport }) {
  if (!edges.length) return;
  _ctx.save();

  edges.forEach(edge => {
    const fn = nodes.find(n => n.id === edge.from);
    const tn = nodes.find(n => n.id === edge.to);
    if (!fn || !tn) return;

    const isHovered = edge.id === _hoveredEdgeId;
    const fs  = _dotPos(fn, viewport);
    const ts  = _leftCenterPos(tn, viewport);
    const dx  = Math.abs(ts.x - fs.x);
    const cp  = Math.max(50, dx * 0.5);
    const cp1 = { x: fs.x + cp, y: fs.y };
    const cp2 = { x: ts.x - cp, y: ts.y };

    // Curve
    _ctx.setLineDash([5, 4]);
    _ctx.strokeStyle = isHovered ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.3)';
    _ctx.lineWidth   = isHovered ? 1.5 : 1;
    _ctx.beginPath();
    _ctx.moveTo(fs.x, fs.y);
    _ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ts.x, ts.y);
    _ctx.stroke();
    _ctx.setLineDash([]);

    // Dot at source
    const dotR = 3.5;
    _ctx.fillStyle = 'rgba(0,0,0,0.35)';
    _ctx.beginPath();
    _ctx.arc(fs.x, fs.y, dotR, 0, Math.PI * 2);
    _ctx.fill();

    // Dot at target
    _ctx.beginPath();
    _ctx.arc(ts.x, ts.y, dotR, 0, Math.PI * 2);
    _ctx.fill();

    // Delete badge (×) when hovered
    if (isHovered) {
      const mid = { x: (fs.x + ts.x) / 2, y: (fs.y + ts.y) / 2 };
      const r   = 8;
      _ctx.fillStyle = _fg();
      _ctx.beginPath();
      _ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.fillStyle = _bg();
      _ctx.font         = 'bold 10px "DM Sans", sans-serif';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText('×', mid.x, mid.y + 0.5);
    }
  });

  _ctx.restore();
}

// ── Edge drag preview ─────────────────────────────────────────────────────────

function _drawEdgeDragPreview({ nodes, viewport }) {
  if (!_edgeDrag) return;
  const fn = nodes.find(n => n.id === _edgeDrag.fromId);
  if (!fn) return;

  const fs = _dotPos(fn, viewport);
  const ts = _edgeDrag.toPos;

  _ctx.save();
  _ctx.setLineDash([5, 4]);
  _ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  _ctx.lineWidth   = 1.5;
  _ctx.beginPath();
  _ctx.moveTo(fs.x, fs.y);
  _ctx.lineTo(ts.x, ts.y);
  _ctx.stroke();
  _ctx.setLineDash([]);

  // Dot at source
  _ctx.fillStyle = 'rgba(0,0,0,0.4)';
  _ctx.beginPath();
  _ctx.arc(fs.x, fs.y, 4, 0, Math.PI * 2);
  _ctx.fill();

  _ctx.restore();
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

function _drawNodes({ nodes, selectedId, viewport }) {
  const fg     = _fg();
  const bg     = _bg();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#00cfcf';

  nodes.forEach(node => {
    const s  = _w2s(node.x, node.y, viewport);
    const sc = viewport.scale;
    const sw = NODE_WIDTH * sc;
    const sh = _nodeHeight(node.label) * sc;

    const isSelected = node.id === selectedId;
    const isHovered  = node.id === _hoveredId;

    // ── Type label above the box ────────────────────────────────────────────
    const typeLabel = NODE_TYPE_LABELS[node.type] || '';
    if (typeLabel) {
      _ctx.font         = `500 ${Math.max(8, 10 * sc)}px "DM Sans", sans-serif`;
      _ctx.fillStyle    = NODE_TYPE_COLORS[node.type] || 'rgba(0,0,0,0.45)';
      _ctx.globalAlpha  = 0.75;
      _ctx.textAlign    = 'left';
      _ctx.textBaseline = 'bottom';
      _ctx.fillText(typeLabel.toUpperCase(), s.x, s.y - 4 * sc);
      _ctx.globalAlpha  = 1;
    }

    // ── Box shadow ──────────────────────────────────────────────────────────
    _ctx.save();
    _ctx.shadowOffsetX = 2;
    _ctx.shadowOffsetY = 2;
    _ctx.shadowBlur    = 0;
    _ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    _ctx.fillStyle     = isHovered ? 'rgba(0,0,0,0.04)' : bg;
    _ctx.fillRect(s.x, s.y, sw, sh);
    _ctx.restore();

    // ── Colour strip (left edge) ────────────────────────────────────────────
    const typeColor = NODE_TYPE_COLORS[node.type];
    if (typeColor) {
      _ctx.fillStyle = typeColor;
      _ctx.fillRect(s.x, s.y, 6 * sc, sh);
    }

    // ── Border ─────────────────────────────────────────────────────────────
    _ctx.strokeStyle = isSelected ? accent : fg;
    _ctx.lineWidth   = isSelected ? 2.5 : 1;
    _ctx.strokeRect(s.x, s.y, sw, sh);

    // ── Label text (inside) ─────────────────────────────────────────────────
    _ctx.font         = `500 ${Math.max(10, 13 * sc)}px "DM Sans", sans-serif`;
    _ctx.fillStyle    = fg;
    _ctx.textAlign    = 'left';
    _ctx.textBaseline = 'top';
    _drawWrappedText(
      node.label || 'Node',
      s.x + (NODE_PADDING + 4) * sc,
      s.y + NODE_PADDING * sc,
      (NODE_WIDTH - NODE_PADDING * 2 - 4) * sc,
    );

    // ── Link indicator ◆ (bottom-right) ────────────────────────────────────
    if (node.links?.length) {
      _ctx.font         = `400 ${Math.max(8, 9 * sc)}px "DM Sans", sans-serif`;
      _ctx.fillStyle    = 'rgba(128,128,128,0.55)';
      _ctx.textAlign    = 'right';
      _ctx.textBaseline = 'bottom';
      _ctx.fillText('◆', s.x + sw - 6 * sc, s.y + sh - 5 * sc);
    }

    // ── Helper completeness dot ─────────────────────────────────────────────
    if (isHelperEnabled()) {
      const dotSize    = 4 * sc;
      const dotX       = s.x + sw - dotSize - (node.links?.length ? 18 : 6) * sc;
      const dotY       = s.y + sh - dotSize - 6 * sc;
      const hasFallacy = hasFallacyWarning(node, nodes);
      const complete   = isComplete(node, nodes);

      if (hasFallacy) {
        _ctx.font         = `400 ${Math.max(7, 9 * sc)}px "DM Sans", sans-serif`;
        _ctx.fillStyle    = 'rgba(0,0,0,0.65)';
        _ctx.textAlign    = 'right';
        _ctx.textBaseline = 'bottom';
        _ctx.fillText('▲', dotX + dotSize, s.y + sh - 4 * sc);
      } else if (complete) {
        _ctx.fillStyle = fg;
        _ctx.fillRect(dotX, dotY, dotSize, dotSize);
      } else {
        _ctx.strokeStyle = fg;
        _ctx.lineWidth   = 1;
        _ctx.strokeRect(dotX, dotY, dotSize, dotSize);
      }
    }

    // ── Connection dot (right-centre) — drag handle for new cross-edges ────
    const dot    = _dotPos(node, viewport);
    const dotR   = Math.max(4, 5 * sc);
    const isDotHovered = (isHovered || isSelected);

    _ctx.beginPath();
    _ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
    _ctx.fillStyle   = typeColor || fg;
    _ctx.globalAlpha = isDotHovered ? 0.85 : 0.25;
    _ctx.fill();
    _ctx.globalAlpha = 1;

    // Ring around the dot
    _ctx.beginPath();
    _ctx.arc(dot.x, dot.y, dotR + 1.5, 0, Math.PI * 2);
    _ctx.strokeStyle = typeColor || fg;
    _ctx.lineWidth   = 1;
    _ctx.globalAlpha = isDotHovered ? 0.5 : 0.12;
    _ctx.stroke();
    _ctx.globalAlpha = 1;
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _fg() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-fg').trim() || '#000000';
}
function _bg() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#ffffff';
}
