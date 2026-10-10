import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, 'results');
const PROGRESS_FILE = path.join(RESULTS_DIR, 'live_progress.json');

let state = {
  active: false,
  suite: '',
  model: '',
  total: 0,
  completed: 0,
  planCount: 0,
  evidenceCount: 0,
  solvedCount: 0,
  rawTokens: 0,
  returnedTokens: 0,
  startedAt: 0,
  updatedAt: 0,
  history: [], // [{ completed, planPct, solvedPct, rawTokens, returnedTokens }]
  recent: [],  // last 15 task objects
};

let lastWrite = 0;

function flush(force = false) {
  const now = Date.now();
  if (!force && now - lastWrite < 150) return;
  lastWrite = now;
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    // ignore temporary write conflicts
  }
}

export function startLive(suite, model, total) {
  state = {
    active: true,
    suite,
    model,
    total,
    completed: 0,
    planCount: 0,
    evidenceCount: 0,
    solvedCount: 0,
    rawTokens: 0,
    returnedTokens: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
    recent: [],
  };
  flush(true);
}

export function recordLive(row) {
  if (!state.active) return;
  state.completed++;
  if (row.plan) state.planCount++;
  if (row.evidence) state.evidenceCount++;
  if (row.plan && row.evidence) state.solvedCount++;
  state.rawTokens += row.raw ?? 0;
  state.returnedTokens += row.returned ?? 0;
  state.updatedAt = Date.now();

  // Keep last 12 recent items
  state.recent.unshift({
    id: row.id,
    intent: row.intent,
    plan: !!row.plan,
    evidence: !!row.evidence,
    solved: !!(row.plan && row.evidence),
    raw: row.raw ?? 0,
    returned: row.returned ?? 0,
    seconds: row.seconds ? Number(row.seconds.toFixed(2)) : 0,
    probes: row.probes ?? [],
    error: row.error ?? null,
  });
  if (state.recent.length > 12) state.recent.pop();

  // Sample history every 2 tasks for graphing
  if (state.completed % 2 === 0 || state.completed === state.total) {
    state.history.push({
      step: state.completed,
      planPct: Number(((state.planCount / state.completed) * 100).toFixed(1)),
      solvedPct: Number(((state.solvedCount / state.completed) * 100).toFixed(1)),
      rawTokens: state.rawTokens,
      returnedTokens: state.returnedTokens,
    });
  }

  flush(state.completed === state.total);
}

export function finishLive(summary = {}) {
  state.active = false;
  state.summary = summary;
  state.finishedAt = Date.now();
  flush(true);
}
