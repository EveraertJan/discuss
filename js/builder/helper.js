// helper.js — Socratic argument analysis engine
//
// Read-only: imports from store and config only, never dispatches anything.
// All exported functions are pure (given the same inputs, same outputs).

import { NODE_TYPES } from '../config.js';

const LS_KEY = 'discuss_helper_mode';

// ── Toggle ────────────────────────────────────────────────────────────────────

export function isEnabled() {
  return localStorage.getItem(LS_KEY) === 'true';
}

export function toggle() {
  localStorage.setItem(LS_KEY, isEnabled() ? 'false' : 'true');
  return isEnabled();
}

// ── Node analysis ─────────────────────────────────────────────────────────────

/**
 * Returns the full Toulmin analysis for a single node.
 * hasClaim / hasGrounds / hasWarrant are the three required elements.
 * The rest are strengthening elements.
 */
export function analyseNode(node, allNodes) {
  const children = _children(node, allNodes);
  return {
    hasClaim:    !!node.label?.trim(),
    hasGrounds:  children.some(n => n.type === NODE_TYPES.EVIDENCE) || !!node.notes?.trim(),
    hasWarrant:  !!node.notes?.trim(),
    hasRebuttal: children.some(n => n.type === NODE_TYPES.REBUTTAL),
    hasBacking:  !!(node.links?.length),
    hasQualifier: containsQualifierLanguage(node.label),
    fallacies:   detectFallacies(node, allNodes),
  };
}

/**
 * Returns the single most important next prompt.
 * Priority: Claim → Grounds → Warrant → Rebuttal → Backing → Qualifier → done.
 */
export function getNextPrompt(analysis) {
  if (!analysis.hasClaim)
    return 'What is the core assertion here? Make sure it\'s something someone could actually disagree with — not just a statement of fact.';
  if (!analysis.hasGrounds)
    return 'What evidence supports this? Try adding a child node of type Evidence, or explain it in the Notes field.';
  if (!analysis.hasWarrant)
    return 'Why does that evidence prove your claim? The logical bridge between them often goes unstated — but stating it makes your argument much harder to attack.';
  if (!analysis.hasRebuttal)
    return 'What would the other side say about this? Adding a Rebuttal node — and responding to it — makes this branch stronger, not weaker.';
  if (!analysis.hasBacking)
    return 'What supports the assumption behind your argument? Add a source link if you have one.';
  if (!analysis.hasQualifier)
    return 'Does this claim apply in all situations? If not, adding a qualifier ("often", "in most cases") makes the argument more credible and harder to dismiss.';
  return 'This branch looks solid: claim, evidence, and reasoning are all present. Consider adding a rebuttal branch to anticipate pushback.';
}

// ── Fallacy detection ─────────────────────────────────────────────────────────

/**
 * Returns an array of { name, description, severity: 'high'|'medium'|'low' }.
 * Each entry is a plausible (not definitive) fallacy warning.
 */
export function detectFallacies(node, allNodes) {
  const warnings  = [];
  const label     = (node.label || '').toLowerCase();
  const notes     = (node.notes || '').toLowerCase();
  const combined  = `${label} ${notes}`;
  const children  = _children(node, allNodes);
  const evidence  = children.filter(n => n.type === NODE_TYPES.EVIDENCE);
  const hasNotes  = !!node.notes?.trim();

  // ── Ad Hominem ────────────────────────────────────────────────────────────
  if (/\b(idiot|stupid|moron|liar|fool|incompetent|dishonest|corrupt|hypocrite|naive|ignorant)\b/.test(combined)) {
    warnings.push({
      name: 'Ad Hominem',
      description: 'This may be attacking the person rather than their argument. Focus on the claim, not the character of whoever makes it.',
      severity: 'high',
    });
  }

  // ── Slippery Slope ────────────────────────────────────────────────────────
  if (/\b(inevitably|will lead to|will result in|next thing|before long|eventually|domino effect|slippery)\b/.test(combined) && !hasNotes) {
    warnings.push({
      name: 'Slippery Slope',
      description: 'This claims a chain of consequences without showing the steps. Use the Notes field to explain why each step necessarily follows.',
      severity: 'medium',
    });
  }

  // ── Hasty Generalization ──────────────────────────────────────────────────
  if (evidence.length === 1 && /\b(all|every|always|never|none|everyone|nobody|no one|without exception)\b/.test(label)) {
    warnings.push({
      name: 'Hasty Generalization',
      description: 'A broad claim is supported by only one piece of evidence. Consider adding more grounds before drawing a universal conclusion.',
      severity: 'medium',
    });
  }

  // ── Appeal to Emotion ─────────────────────────────────────────────────────
  if (/\b(terrible|outrageous|disgusting|heartbreaking|shameful|horrific|catastrophic|devastating|appalling|tragic)\b/.test(combined)
      && evidence.length === 0 && !hasNotes) {
    warnings.push({
      name: 'Appeal to Emotion',
      description: 'Strong emotional language without factual grounds. What evidence supports this claim beyond how it makes people feel?',
      severity: 'medium',
    });
  }

  // ── Bandwagon ─────────────────────────────────────────────────────────────
  if (/\b(everyone knows|most people|majority believe|widely accepted|popular opinion|common knowledge|consensus)\b/.test(combined)
      && evidence.length === 0) {
    warnings.push({
      name: 'Bandwagon',
      description: 'Appealing to what many people believe is not evidence on its own. What independent grounds support this?',
      severity: 'low',
    });
  }

  // ── False Dichotomy ───────────────────────────────────────────────────────
  if (children.length === 2 && /\b(either|only two|must choose|no other option|no alternative|binary)\b/.test(combined)) {
    warnings.push({
      name: 'False Dichotomy',
      description: 'This presents only two options. Are there other possibilities? A Qualifier node could acknowledge the middle ground.',
      severity: 'medium',
    });
  }

  // ── Circular Argument ─────────────────────────────────────────────────────
  if (hasNotes && node.label?.trim()) {
    const labelWords = new Set(label.split(/\W+/).filter(w => w.length > 4));
    const notesWords = new Set(notes.split(/\W+/).filter(w => w.length > 4));
    const overlap    = [...labelWords].filter(w => notesWords.has(w));
    if (labelWords.size >= 3 && overlap.length / labelWords.size > 0.55) {
      warnings.push({
        name: 'Circular Argument',
        description: 'The Notes field seems to restate the label rather than explain the reasoning. A warrant should say *why* the evidence proves the claim, not repeat it.',
        severity: 'low',
      });
    }
  }

  // ── Burden of Proof ───────────────────────────────────────────────────────
  if (evidence.length === 0 && !hasNotes
      && /\b(undeniable|obvious|self-evident|proved|disproved|no one can deny|can't be denied|clearly)\b/.test(combined)) {
    warnings.push({
      name: 'Burden of Proof',
      description: 'This asserts truth without providing evidence. What grounds does this claim rest on?',
      severity: 'high',
    });
  }

  // ── Appeal to Authority ───────────────────────────────────────────────────
  if (node.links?.length === 1 && evidence.length === 0
      && /\b(expert|authority|professor|scientist|doctor|study|research|report)\b/.test(combined)) {
    warnings.push({
      name: 'Appeal to Authority',
      description: 'A single authority source is the only support. Is this source an expert in this specific domain? Are there other corroborating grounds?',
      severity: 'low',
    });
  }

  return warnings;
}

// ── Completeness helpers (used by canvas dots) ────────────────────────────────

/** Core 3 of Toulmin: Claim + Grounds + Warrant. */
export function isComplete(node, allNodes) {
  const a = analyseNode(node, allNodes);
  return a.hasClaim && a.hasGrounds && a.hasWarrant;
}

/** Complete + has Rebuttal + has Backing. */
export function isStrong(node, allNodes) {
  const a = analyseNode(node, allNodes);
  return isComplete(node, allNodes) && a.hasRebuttal && a.hasBacking;
}

export function hasFallacyWarning(node, allNodes) {
  return detectFallacies(node, allNodes).length > 0;
}

// ── Language helpers ──────────────────────────────────────────────────────────

export function containsQualifierLanguage(label = '') {
  return /\b(often|usually|many|most|sometimes|generally|in some cases|may|might|can)\b/i.test(label);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _children(node, allNodes) {
  return allNodes.filter(n => n.parentId === node.id);
}
