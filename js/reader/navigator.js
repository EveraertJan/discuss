// navigator.js — walk the tree: current node, history stack

let _nodes   = [];
let _current = null;   // node id or null (null = root selection screen)
let _history = [];     // stack of node ids

// ── Public API ────────────────────────────────────────────────────────────────

/** Load a new tree (array of nodes). Resets all state. */
export function loadTree(nodes) {
  _nodes   = nodes;
  _history = [];
  _current = null;  // will show root selection / single root auto-advance
}

/** Navigate to a node by id. Pushes the current id to history. */
export function goTo(nodeId) {
  if (_current !== null) _history.push(_current);
  _current = nodeId;
}

/** Go back to the previous node. Returns false if already at root. */
export function goBack() {
  if (_history.length === 0) return false;
  _current = _history.pop();
  return true;
}

/** Returns the current node object, or null if at root screen. */
export function getCurrent() {
  if (_current === null) return null;
  return _nodes.find(n => n.id === _current) ?? null;
}

/** Returns direct children of a node plus any cross-connected nodes. */
export function getChildren(nodeId) {
  const treeChildren  = _nodes.filter(n => n.parentId === nodeId);
  const currentNode   = _nodes.find(n => n.id === nodeId);
  const crossTargets  = (currentNode?.connections ?? [])
    .map(id => _nodes.find(n => n.id === id))
    .filter(Boolean)
    .filter(n => !treeChildren.some(c => c.id === n.id)); // deduplicate
  return [...treeChildren, ...crossTargets];
}

/** Returns all root nodes (parentId === null or parentId not in nodes). */
export function getRoots() {
  const ids = new Set(_nodes.map(n => n.id));
  return _nodes.filter(n => !n.parentId || !ids.has(n.parentId));
}

/** Returns true if there is history to go back to. */
export function canGoBack() {
  return _history.length > 0;
}

/** Returns the history stack as node objects (oldest first). */
export function getHistoryNodes() {
  return _history.map(id => _nodes.find(n => n.id === id)).filter(Boolean);
}
