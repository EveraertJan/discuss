// io.js — JSON export and import (shared)

export function exportJSON(state) {
  const data = { title: state.title, nodes: state.nodes, edges: state.edges ?? [] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: (state.title || 'argument-map').replace(/[^a-z0-9_-]/gi, '-') + '.json',
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch { reject(new Error('Invalid JSON file')); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/** Opens a native file picker then resolves with the chosen File. */
export function pickFile(accept = '.json') {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), {
      type:   'file',
      accept,
    });
    input.onchange = e => { if (e.target.files[0]) resolve(e.target.files[0]); };
    input.click();
  });
}
