// Local telemetry: one JSON line per Hydra call or hook decision in ~/.hydra/ledger.jsonl.
// Nothing leaves the machine. HYDRA_TELEMETRY=0 turns recording off.
//   kind 'call' (or no kind, rows written before telemetry v2): a head answered; raw/returned token estimates.
//   kind 'hook': the PreToolUse hook turned a command back ('deny'), let HYDRA_RAW=1 through ('raw') or
//     passed it ('pass', recorded without the command). hookMs is the hook process's whole lifetime.
//   kind 'error': a command failed (model unavailable, crash).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = () => process.env.HYDRA_HOME ?? path.join(os.homedir(), '.hydra');
const file = () => path.join(home(), 'ledger.jsonl');

// A rough count that needs no tokenizer; every figure built on it is an estimate.
export const tokens = chars => Math.ceil(chars / 4);

export const enabled = () => process.env.HYDRA_TELEMETRY !== '0';

/** Who is calling: the agent family and its session when the agent says so, else a plain shell.
 * AI_AGENT differs inside hooks (claude-code_<version>_harness) and the agent's shell (..._agent),
 * so `agent` keeps only the family and `agentDetail` the full value. */
export function caller(session = process.env.CLAUDE_CODE_SESSION_ID) {
  const detail = process.env.AI_AGENT;
  const agent = detail ? detail.split('_')[0] : process.env.CLAUDECODE ? 'claude-code' : 'shell';
  return { agent, ...(detail ? { agentDetail: detail } : {}), ...(session ? { session } : {}) };
}

export function record(entry) {
  if (!enabled()) return;
  try {
    mkdirSync(home(), { recursive: true });
    appendFileSync(file(), `${JSON.stringify({ v: 2, kind: 'call', ...caller(), ...entry })}\n`);
  } catch {
    // Accounting must never fail the answer.
  }
}

/** Wrap a chat function so a call's record can say how often and how long the local model ran. */
export function metered(chat) {
  const meter = { modelCalls: 0, modelSeconds: 0 };
  meter.chat = async opts => {
    const started = Date.now();
    meter.modelCalls += 1;
    try {
      return await chat(opts);
    } finally {
      meter.modelSeconds = Number((meter.modelSeconds + (Date.now() - started) / 1000).toFixed(2));
    }
  };
  return meter;
}

export function rows() {
  try {
    return readFileSync(file(), 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return []; // No ledger yet.
  }
}

const isCall = row => (row.kind ?? 'call') === 'call';

export function stats(all = rows()) {
  const total = { calls: 0, raw: 0, returned: 0, heads: {} };
  for (const row of all.filter(isCall)) {
    total.calls += 1;
    total.raw += row.raw;
    total.returned += row.returned;
    total.heads[row.head] = (total.heads[row.head] ?? 0) + 1;
  }
  return total;
}

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

/**
 * What the ledger says Hydra should improve, newest data first. `since` is an ISO time.
 * Per head: calls, tokens saved, calls that returned more than the raw output, latency, model use.
 * Hooks: denials, how many the agent followed with a Hydra run in the same session, and
 * HYDRA_RAW=1 bypasses, which are often a pattern the hook should not have matched.
 */
export function findings(all = rows(), { since } = {}) {
  const recent = since ? all.filter(row => (row.ts ?? '') >= since) : all;
  const calls = recent.filter(isCall);
  const heads = {};
  for (const row of calls) {
    const head = heads[row.head] ??= { calls: 0, raw: 0, returned: 0, costMore: [], seconds: [], modelCalls: 0, failedRuns: 0 };
    head.calls += 1;
    head.raw += row.raw;
    head.returned += row.returned;
    head.seconds.push(row.seconds ?? 0);
    head.modelCalls += row.modelCalls ?? 0;
    if (row.exit) head.failedRuns += 1;
    if (row.returned > row.raw) head.costMore.push(row);
  }
  const perHead = Object.fromEntries(Object.entries(heads).map(([name, h]) => [name, {
    calls: h.calls, saved: h.raw - h.returned, savedShare: h.raw ? Number(((h.raw - h.returned) / h.raw).toFixed(3)) : 0,
    costMore: h.costMore.length, p50Seconds: percentile(h.seconds, 0.5), p90Seconds: percentile(h.seconds, 0.9),
    modelCalls: h.modelCalls, failedRuns: h.failedRuns,
    costMoreExamples: h.costMore.slice(-3).map(row => ({ question: row.question, raw: row.raw, returned: row.returned })),
  }]));
  const hooks = recent.filter(row => row.kind === 'hook');
  const hookMs = hooks.map(row => row.hookMs).filter(Number.isFinite);
  const denials = hooks.filter(row => row.decision === 'deny');
  const followed = denials.filter(deny => calls.some(call => call.session && call.session === deny.session
    && call.head === 'test' && call.ts >= deny.ts && Date.parse(call.ts) - Date.parse(deny.ts) <= 5 * 60_000));
  const sessions = new Set(recent.map(row => row.session).filter(Boolean));
  const sessionsUsing = new Set(calls.map(row => row.session).filter(Boolean));
  return {
    since: since ?? recent[0]?.ts ?? null, calls: calls.length, perHead,
    hooks: { decisions: hooks.length, p50Ms: percentile(hookMs, 0.5), p90Ms: percentile(hookMs, 0.9),
             denials: denials.length, followedByHydra: followed.length,
             rawBypasses: hooks.filter(row => row.decision === 'raw').map(row => row.command).slice(-5) },
    errors: recent.filter(row => row.kind === 'error').slice(-5).map(row => ({ ts: row.ts, command: row.command, error: row.error })),
    sessions: { seen: sessions.size, usingHydra: sessionsUsing.size },
  };
}
