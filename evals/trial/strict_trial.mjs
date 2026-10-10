#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createFixture, execute, HYDRA, ROOT } from './fixture.mjs';
import { score } from './scoring.mjs';
import { tokens } from '../../skills/hydra/scripts/lib/ledger.mjs';

const fixture = createFixture();
const started = Date.now();
const model = process.env.HYDRA_MODEL ?? 'hydra-qwen3.5:0.8b-plan';
const env = { ...process.env, HYDRA_MODEL: model };
const rows = [];
try {
  for (const spec of fixture.spec) {
    const raw = execute(spec.raw, fixture.cwd, env);
    const hydra = execute(['node', HYDRA, ...spec.hydra], fixture.cwd, env);
    const rawCheck = score(spec, raw);
    const hydraCheck = score(spec, hydra, true);
    const rawTokens = tokens((raw.stdout + raw.stderr).length);
    const hydraTokens = tokens((hydra.stdout + hydra.stderr).length);
    rows.push({ id: spec.id, head: spec.head, gold: spec.gold, rawCheck, hydraCheck,
      rawTokens, hydraTokens, savedTokens: rawTokens - hydraTokens, raw, hydra });
    console.log(`${spec.id}: direct=${rawCheck.passed ? 'PASS' : 'FAIL'} hydra=${hydraCheck.passed ? 'PASS' : 'FAIL'} (${rawTokens} -> ${hydraTokens} estimated tokens) ${hydraCheck.failures.join('; ')}`);
  }
  const summarize = list => {
    const raw = list.reduce((s, r) => s + r.rawTokens, 0);
    const hydra = list.reduce((s, r) => s + r.hydraTokens, 0);
    return { cases: list.length, rawPassed: list.filter(r => r.rawCheck.passed).length,
      hydraPassed: list.filter(r => r.hydraCheck.passed).length, rawTokens: raw, hydraTokens: hydra,
      savedTokens: raw - hydra, savingsPct: raw ? Number(((raw - hydra) / raw * 100).toFixed(1)) : null };
  };
  const payload = { date: new Date().toISOString(), model, durationSeconds: (Date.now() - started) / 1000,
    tokenMethod: 'ceil(characters / 4), output estimates only', baseline: 'Targeted direct commands, same fixture and required facts',
    summary: summarize(rows), equalCorrectness: summarize(rows.filter(r => r.rawCheck.passed && r.hydraCheck.passed)),
    byHead: Object.fromEntries(['git', 'read', 'files', 'test'].map(h => [h, summarize(rows.filter(r => r.head === h))])), rows };
  const out = path.join(ROOT, 'evals/results/strict_trial.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ summary: payload.summary, equalCorrectness: payload.equalCorrectness, seconds: payload.durationSeconds, out }, null, 2));
  if (payload.summary.rawPassed !== rows.length || payload.summary.hydraPassed !== rows.length) process.exitCode = 1;
} finally { fixture.cleanup(); }
