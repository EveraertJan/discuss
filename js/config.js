// config.js — NODE_TYPES, app constants

export const NODE_TYPES = {
  CLAIM:      'claim',
  SUPPORT:    'support',
  OBJECTION:  'objection',
  REBUTTAL:   'rebuttal',
  EVIDENCE:   'evidence',
  QUESTION:   'question',
  FALLACY:    'fallacy',
};

export const NODE_TYPE_LABELS = {
  claim:      'Claim',
  support:    'Support',
  objection:  'Objection',
  rebuttal:   'Rebuttal',
  evidence:   'Evidence',
  question:   'Question',
  fallacy:    'False / Fallacy',
};

/**
 * Left-border accent colours per node type.
 * Deliberately minimal palette — uses only the design system colours.
 * 'null' = no border (default).
 */
export const NODE_TYPE_COLORS = {
  claim:     '#000000',   // black   — the central assertion
  support:   '#00cfcf',   // cyan    — supporting the claim
  objection: '#d4380d',   // rust    — challenging
  rebuttal:  '#d48806',   // amber   — countering the challenge
  evidence:  '#389e0d',   // green   — factual backing
  question:  '#096dd9',   // blue    — open inquiry
  fallacy:   '#9b59b6',   // purple  — false / fallacious argument
};

export const NODE_WIDTH      = 320;
export const NODE_MIN_HEIGHT = 48;
export const NODE_PADDING    = 12;
export const LINE_HEIGHT     = 18;

export const APP_TITLE = 'Discuss';
