import assert from 'node:assert/strict';
import test from 'node:test';
import { block } from '../evals/usage/readme_stats.mjs';

test('the README usage block shows totals only, from the clean start date on', () => {
  const rows = [
    { ts: '2026-10-16T00:00:00.000Z', kind: 'call', head: 'git', question: 'before the fixture fix', raw: 999, returned: 1, session: 'old' },
    { ts: '2026-10-18T00:00:00.000Z', kind: 'call', head: 'test', question: 'pnpm vitest run test/private-name.test.ts', raw: 1000, returned: 100, session: 'secret-session-id' },
    { ts: '2026-10-18T00:01:00.000Z', kind: 'call', head: 'git', question: 'who wrote private.js?', raw: 40, returned: 50, session: 'secret-session-id' },
    { ts: '2026-10-18T00:02:00.000Z', kind: 'hook', decision: 'pass', hookMs: 10 },
  ];
  const text = block(rows, new Date('2026-10-19T00:00:00Z'));
  assert.match(text, /\*\*2 calls\*\* in \*\*1 coding session\*\*/);
  assert.match(text, /~1,040 tokens\*\* of command output, \*\*~150\*\* reached the agent: \*\*86% kept out of context/);
  assert.match(text, /\| Test and build runs \| 1 \| ~1,000 \| ~100 \| \*\*90%\*\* \|/);
  assert.match(text, /\| Git questions \| 1 \| ~40 \| ~50 \| \*\*-25%\*\* \|/);
  assert.match(text, /Updated 2026-10-19/);
  for (const secret of ['private-name', 'private.js', 'secret-session-id', 'before the fixture fix']) assert.ok(!text.includes(secret), secret);
});
