// canvas.js — draw nodes, edges, hit-testing

import { NODE_WIDTH, NODE_MIN_HEIGHT, NODE_PADDING, NODE_TYPE_LABELS, LINE_HEIGHT } from '../config.js';
import { getState } from '../store.js';

let _canvas = null;
let _ctx    = null;
let _hoveredId = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function initCanvas(canvasEl) {
  _canvas = canvasEl;
  _ctx    = _canvas.getContext('2d');
  _resize();
  window.addEventListener('resize', _resize);
}

export function setHovered(id) {
  _hoveredId = id ?? null;
}

/** Rerender with a given state snapshot. */
export function render(state) {
  if (!_canvas || !_ctx) return;
  const W = _canvas.offsetWidth;
  const H = _canvas.offsetHeight;
  _ctx.clearRect(0, 0, W, H);
  _drawEdges(state);
  _drawNodes(state);
}

/** Returns the node id under screen point (sx, sy), or null. */
export function hitTest(sx, sy, state) {
  const { nodes, viewport } = state;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n  = nodes[i];
    const s  = _w2s(n.x, n.y, viewport);
    const sw = NODE_WIDTH * viewport.scale;
    const sh = _nodeHeight(n.label) * viewport.scale;
    if (sx >= s.x && sx <= s.x + sw && sy >= s.y && sy <= s.y + sh) {
      return n.id;
    }
  }
  return null;
}

/** Convert screen coords → world coords. */
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

/** World → screen */
function _w2s(wx, wy, viewport) {
  return {
    x: wx * viewport.scale + viewport.x,
    y: wy * viewport.scale + viewport.y,
  };
}

/** Compute node height from label string. */
export function _nodeHeight(label = '') {
  if (!_ctx) return NODE_MIN_HEIGHT;
  const text     = label || 'Node';
  const maxWidth = NODE_WIDTH - NODE_PADDING * 2;
  _ctx.font = '500 13px "DM Sans", sans-serif';
  const words = text.split(' ');
  let lines = 1;
  let line  = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (_ctx.measureText(test).width > maxWidth && line) { lines++; line = word; }
    else { line = test; }
  }
  return Math.max(NODE_MIN_HEIGHT, NODE_PADDING * 2 + 16 + lines * LINE_HEIGHT);
}

function _drawWrappedText(text, x, y, maxWidth) {
  const words = text.split(' ');
  let line = '';
  let cy   = y;
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

function _drawEdges({ nodes, viewport }) {
  _ctx.save();
  _ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-fg').trim() || '#000000';
  _ctx.fillStyle   = _ctx.strokeStyle;
  _ctx.lineWidth   = 1.5;

  nodes.forEach(node => {
    if (!node.parentId) return;
    const parent = nodes.find(n => n.id === node.parentId);
    if (!parent) return;

    const ph = _nodeHeight(parent.label);

    // Connect from bottom-center of parent to top-center of child
    const ps = _w2s(parent.x + NODE_WIDTH / 2, parent.y + ph, viewport);
    const cs = _w2s(node.x   + NODE_WIDTH / 2, node.y,        viewport);

    // Cubic Bezier — control points extend vertically from each endpoint
    const dy = Math.abs(cs.y - ps.y);
    const cp = Math.max(40, dy * 0.5);  // control arm length scales with distance
    const cp1 = { x: ps.x, y: ps.y + cp };
    const cp2 = { x: cs.x, y: cs.y - cp };

    _ctx.beginPath();
    _ctx.moveTo(ps.x, ps.y);
    _ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, cs.x, cs.y);
    _ctx.stroke();

    // Arrowhead tangent follows the curve at the endpoint
    _arrowhead(cp2.x, cp2.y, cs.x, cs.y);
  });
  _ctx.restore();
}

function _drawNodes({ nodes, selectedId, viewport }) {
  const fgColor  = getComputedStyle(document.documentElement).getPropertyValue('--color-fg').trim()  || '#000000';
  const bgColor  = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()  || '#ffffff';
  const accent   = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#00cfcf';

  nodes.forEach(node => {
    const s  = _w2s(node.x, node.y, viewport);
    const sc = viewport.scale;
    const sw = NODE_WIDTH * sc;
    const sh = _nodeHeight(node.label) * sc;

    const isSelected = node.id === selectedId;
    const isHovered  = node.id === _hoveredId;

    // Background fill
    _ctx.fillStyle = isHovered ? 'rgba(0,0,0,0.05)' : bgColor;
    _ctx.fillRect(s.x, s.y, sw, sh);

    // Border
    _ctx.strokeStyle = isSelected ? accent : fgColor;
    _ctx.lineWidth   = isSelected ? 2.5 : 1.5;
    _ctx.strokeRect(s.x, s.y, sw, sh);

    // Type badge (top-right, small muted)
    const typeLabel = NODE_TYPE_LABELS[node.type] || '';
    _ctx.font        = `400 ${Math.max(8, 11 * sc)}px "DM Sans", sans-serif`;
    _ctx.fillStyle   = 'rgba(128,128,128,0.7)';
    _ctx.textAlign   = 'right';
    _ctx.textBaseline = 'top';
    _ctx.fillText(typeLabel, s.x + sw - 5 * sc, s.y + 5 * sc);

    // Label text (wrapped)
    _ctx.font         = `500 ${Math.max(10, 13 * sc)}px "DM Sans", sans-serif`;
    _ctx.fillStyle    = fgColor;
    _ctx.textAlign    = 'left';
    _ctx.textBaseline = 'top';
    _drawWrappedText(
      node.label || 'Node',
      s.x + NODE_PADDING * sc,
      s.y + (NODE_PADDING + 2) * sc,
      (NODE_WIDTH - NODE_PADDING * 2) * sc,
    );

    // Link indicator ◆
    if (node.links?.length) {
      _ctx.font         = `400 ${Math.max(8, 10 * sc)}px "DM Sans", sans-serif`;
      _ctx.fillStyle    = 'rgba(128,128,128,0.6)';
      _ctx.textAlign    = 'left';
      _ctx.textBaseline = 'bottom';
      _ctx.fillText('◆', s.x + 5 * sc, s.y + sh - 4 * sc);
    }
  });
}
