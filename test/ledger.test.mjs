import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { caller, findings, metered, record, rows, stats } from '../skills/hydra/scripts/lib/ledger.mjs';

test('the ledger records calls with their caller, and HYDRA_TELEMETRY=0 records nothing', () => {
  process.env.HYDRA_HOME = mkdtempSync(path.join(os.tmpdir(), 'hydra-ledger-'));
  process.env.HYDRA_TELEMETRY = '0';
  record({ ts: '2026-10-17T00:00:00.000Z', head: 'git', question: 'q', raw: 10, returned: 2, seconds: 1 });
  assert.equal(existsSync(path.join(process.env.HYDRA_HOME, 'ledger.jsonl')), false);
  delete process.env.HYDRA_TELEMETRY;
  record({ ts: '2026-10-17T00:00:00.000Z', head: 'git', question: 'q', raw: 10, returned: 2, seconds: 1 });
  const [row] = rows();
  assert.equal(row.kind, 'call');
  assert.equal(row.v, 2);
  assert.ok(row.agent);
  const prior = process.env.AI_AGENT;
  for (const detail of ['claude-code_2-1-301_harness', 'claude-code_2-1-301_agent']) {
    process.env.AI_AGENT = detail;
    assert.deepEqual([caller('s').agent, caller('s').agentDetail, caller('s').session], ['claude-code', detail, 's']);
  }
  if (prior === undefined) delete process.env.AI_AGENT; else process.env.AI_AGENT = prior;
});

test('findings show where Hydra cost more than raw, how hooks were followed, and what failed', () => {
  const at = minutes => new Date(Date.UTC(2026, 9, 17, 0, minutes)).toISOString();
  const ledger = [
    { ts: at(0), head: 'test', question: 'old row without kind', raw: 100, returned: 10, seconds: 2 },
    { ts: at(1), kind: 'session', session: 's1' },
    { ts: at(2), kind: 'hook', decision: 'deny', session: 's1', command: 'npm test', hookMs: 40 },
    { ts: at(3), kind: 'call', session: 's1', head: 'test', question: 'npm test', raw: 29, returned: 53, seconds: 0.1, exit: 0 },
    { ts: at(4), kind: 'hook', decision: 'raw', session: 's1', command: 'HYDRA_RAW=1 npm test', hookMs: 60 },
    { ts: at(5), kind: 'session', session: 's2' },
    { ts: at(6), kind: 'error', command: 'ask', error: 'model unavailable' },
  ];
  assert.deepEqual(stats(ledger), { calls: 2, raw: 129, returned: 63, heads: { test: 2 } });
  const report = findings(ledger);
  assert.equal(report.perHead.test.costMore, 1);
  assert.equal(report.perHead.test.costMoreExamples[0].question, 'npm test');
  assert.deepEqual(report.hooks, { decisions: 2, p50Ms: 60, p90Ms: 60, denials: 1, followedByHydra: 1,
    rawBypasses: ['HYDRA_RAW=1 npm test'] });
  assert.deepEqual(report.sessions, { seen: 2, usingHydra: 1 });
  assert.deepEqual(findings([{ ts: at(0), kind: 'call', agent: 'codex', via: 'mcp', head: 'git', raw: 9, returned: 3 },
    { ts: at(1), kind: 'hook', agent: 'gemini', decision: 'deny' }]).agents,
    { codex: { calls: 1, viaMcp: 1, denials: 0, sessions: 0 }, gemini: { calls: 0, viaMcp: 0, denials: 1, sessions: 0 } });
  assert.equal(report.errors[0].error, 'model unavailable');
  assert.equal(findings(ledger, { since: at(5) }).calls, 0);
});

test('metered chat counts model calls, including ones that throw', async () => {
  const meter = metered(async ({ fail }) => { if (fail) throw new Error('down'); return 'ok'; });
  assert.equal(await meter.chat({}), 'ok');
  await assert.rejects(meter.chat({ fail: true }));
  assert.equal(meter.modelCalls, 2);
});
