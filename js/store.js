// store.js — shared state model + dispatch/subscribe

import { NODE_TYPES } from './config.js';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const _state = {
  title:      'Untitled Argument',
  nodes:      [],
  selectedId: null,
  viewport:   { x: 0, y: 0, scale: 1 },
};

const _listeners = [];

export function getState() {
  return JSON.parse(JSON.stringify(_state));
}

export function subscribe(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i !== -1) _listeners.splice(i, 1);
  };
}

function notify() {
  const snap = getState();
  _listeners.forEach(fn => fn(snap));
}

export function dispatch(action) {
  switch (action.type) {

    case 'SET_TITLE':
      _state.title = action.title;
      break;

    case 'ADD_NODE': {
      const node = {
        id:       uid(),
        parentId: action.parentId ?? null,
        x:        action.x ?? 120,
        y:        action.y ?? 120,
        label:    action.label ?? 'New node',
        notes:    action.notes ?? '',
        links:    action.links ?? [],
        type:     action.nodeType ?? NODE_TYPES.CLAIM,
      };
      _state.nodes.push(node);
      _state.selectedId = node.id;
      break;
    }

    case 'UPDATE_NODE': {
      const idx = _state.nodes.findIndex(n => n.id === action.id);
      if (idx !== -1) {
        Object.assign(_state.nodes[idx], action.changes);
      }
      break;
    }

    case 'MOVE_NODE': {
      const n = _state.nodes.find(n => n.id === action.id);
      if (n) { n.x = action.x; n.y = action.y; }
      break;
    }

    case 'DELETE_NODE': {
      const toDelete = new Set();
      const collect = id => {
        toDelete.add(id);
        _state.nodes.filter(n => n.parentId === id).forEach(n => collect(n.id));
      };
      collect(action.id);
      _state.nodes = _state.nodes.filter(n => !toDelete.has(n.id));
      if (toDelete.has(_state.selectedId)) _state.selectedId = null;
      break;
    }

    case 'SELECT_NODE':
      _state.selectedId = action.id ?? null;
      break;

    case 'SET_VIEWPORT':
      Object.assign(_state.viewport, action.viewport);
      break;

    case 'LOAD_TREE':
      _state.title      = action.tree.title ?? 'Untitled Argument';
      _state.nodes      = action.tree.nodes  ?? [];
      _state.selectedId = null;
      _state.viewport   = { x: 0, y: 0, scale: 1 };
      break;

    case 'NEW_TREE':
      _state.title      = 'Untitled Argument';
      _state.nodes      = [];
      _state.selectedId = null;
      _state.viewport   = { x: 0, y: 0, scale: 1 };
      break;

    default:
      console.warn('[store] unknown action:', action.type);
      return;
  }
  notify();
}
