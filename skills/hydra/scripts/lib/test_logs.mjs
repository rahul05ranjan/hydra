import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from './exec.mjs';
import { Unavailable } from './runtime.mjs';

const PASS_THROUGH = 800;
const MAX_CANDIDATES = 60;
const MAX_CITED = 12;
const FAILURE_HEADER = /(?:^|\s)(?:FAIL(?:ED)?|[●•]|not\s+ok\b|error(?:\[E\d+\]| TS\d+)?|[A-Za-z_]\w*(?:Error|Exception)\s*:|panicked at|assert\s|assertion\s|Expected:|Received:|actual:|- Snapshot|[-+]\s|--- FAIL:|____+\s+\w+)|^\s*(?:left|right)\s*:/i;
const LAUNCH_ERROR = /(?:\bnot found\b|\bis not recognized\b|\bNo module named\b|\bCannot find module\b|\bMissing script:|\bENOENT\b|\bERR_MODULE_NOT_FOUND\b)/i;
const USER_STACK = /\b([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|rb)):(\d+)(?::(\d+))?|\bFile\s+"[^"\n]+\.py",\s+line\s+\d+/;
const IGNORE_STACK = /(?:node_modules|site-packages|\.cargo\/registry|internal\/process|\bat <anonymous>:\d+|\(<anonymous>:\d+|\/usr\/(?:local\/)?lib\/python|\/lib\/python)/;

const SYSTEM = `You select verbatim evidence for test failures or build errors. Each line has its line number in brackets [N].
Reply with JSON:
- lines: array of line numbers in brackets showing the failure headers, assertion diffs, and source locations.`;

const SCHEMA = {
  type: 'object',
  properties: {
    lines: { type: 'array', items: { type: 'integer' }, maxItems: MAX_CITED },
  },
  required: ['lines'],
};

// Heuristic identification of test failures, assertion diffs, and source lines
export function extractFailureCandidates(logText) {
  const lines = logText.split('\n');
  const candidateRanks = new Map();
  const nearFailure = new Set();
  const add = (index, rank) => {
    if (!IGNORE_STACK.test(lines[index])) candidateRanks.set(index, Math.max(rank, candidateRanks.get(index) || 0));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!IGNORE_STACK.test(line) && (FAILURE_HEADER.test(line) || LAUNCH_ERROR.test(line))) {
      add(i, 4);
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 5); j++) {
        add(j, 2);
      }
      for (let j = Math.max(0, i - 10); j <= Math.min(lines.length - 1, i + 20); j++) nearFailure.add(j);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (USER_STACK.test(line) && !IGNORE_STACK.test(line)) {
      add(i, nearFailure.has(i) ? 3 : 1);
    }
  }

  // Include trailing summary lines
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    if (/(?:failed|passed|errors|finished in|Test Files|Tests\s+\d+)/i.test(lines[i])) {
      add(i, 1);
    }
  }

  // The budget belongs to failure evidence first, rather than the first incidental trace lines.
  // Restore source order after selection so line numbers and verbatim context remain unchanged.
  return Array.from(candidateRanks.keys())
    .sort((a, b) => candidateRanks.get(b) - candidateRanks.get(a) || a - b)
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => a - b)
    .map(idx => ({ id: idx + 1, text: lines[idx] }));
}

export async function digest({ cmd, out = '', err = '', exitCode = 0 }, chat) {
  const rawText = (out + (err ? (out ? '\n' : '') + err : '')).trimEnd();
  const rawChars = rawText.length;

  // Short output passes through verbatim with no model call
  if (rawChars <= PASS_THROUGH) {
    return {
      text: `$ ${cmd}${exitCode !== 0 ? ` (exit ${exitCode})` : ''}\n${rawText}`,
      rawChars,
      exitCode,
    };
  }

  // Passing tests with large output (e.g. verbose logs): summarize pass status
  if (exitCode === 0) {
    const lines = rawText.split('\n');
    const summaryLines = lines
      .filter(l => /(?:passed|tests? passed|ok|success|finished in|^\s*Ran\s+\d+\s+tests?\b|\b(?:pass|fail(?:ures|ed)?|tests?|suites|cancelled|skipped|todo)\s*[: ]\s*\d+)/i.test(l))
      .slice(-8)
      .join('\n');
    return {
      text: `$ ${cmd} (exit 0)\nAll tests passed.\n${summaryLines ? `${summaryLines}\n` : ''}(Verbose output withheld)`,
      rawChars,
      exitCode,
    };
  }

  // Failing tests or compiler errors: extract high-signal failure regions
  const candidates = extractFailureCandidates(rawText);
  if (!candidates.length) {
    // Unknown runners commonly print setup first and the actual termination reason last.
    const lines = rawText.split('\n');
    const indices = new Set([...lines.slice(0, 3).map((_, i) => i), ...lines.slice(-12).map((_, i) => Math.max(0, lines.length - 12) + i)]);
    const excerpt = [...indices].sort((a, b) => a - b).map(i => lines[i]).join('\n');
    return {
      text: `$ ${cmd} (exit ${exitCode})\n${excerpt}\n(... ${lines.length - indices.size} lines withheld)`,
      rawChars,
      exitCode,
    };
  }

  const numbered = candidates.map(c => `[${c.id}] ${c.text}`).join('\n');
  let reply;
  try {
    reply = await chat({
      system: SYSTEM,
      user: `${numbered}\n\nSelect failure evidence:`,
      schema: SCHEMA,
    });
  } catch (e) {
    if (e instanceof Unavailable) throw e;
  }

  const citedIds = new Set(
    (Array.isArray(reply?.lines) ? reply.lines : []).filter(id => Number.isInteger(id)),
  );

  let evidenceLines;
  if (citedIds.size > 0) {
    const essentialIds = new Set(
      candidates
        .filter(c => (FAILURE_HEADER.test(c.text) || LAUNCH_ERROR.test(c.text) || USER_STACK.test(c.text)) && !IGNORE_STACK.test(c.text))
        .map(c => c.id),
    );
    evidenceLines = candidates
      .filter(c => citedIds.has(c.id) || essentialIds.has(c.id))
      .map(c => c.text);
  }
  if (!evidenceLines || evidenceLines.length === 0) {
    // If model cited nothing or invalid lines, show the top candidate lines
    evidenceLines = candidates.filter(c => !IGNORE_STACK.test(c.text)).slice(0, 12).map(c => c.text);
  }

  const text = `$ ${cmd} (exit ${exitCode})\n${evidenceLines.join('\n')}`;
  return { text, rawChars, exitCode };
}

export async function gather(question, cwd, chat) {
  let cmd = 'npm';
  let argv = ['test'];
  if (existsSync(path.join(cwd, 'Cargo.toml'))) {
    cmd = 'cargo';
    argv = ['test'];
  } else if (existsSync(path.join(cwd, 'go.mod'))) {
    cmd = 'go';
    argv = ['test', './...'];
  } else if (existsSync(path.join(cwd, 'pytest.ini')) || existsSync(path.join(cwd, 'tests'))) {
    cmd = 'pytest';
    argv = [];
  }
  const res = await run(cmd, argv, cwd);
  const fullCmd = [cmd, ...argv].join(' ');
  const combined = (res.out + (res.err ? '\n' + res.err : '')).trimEnd();
  return [{ cmd: fullCmd, out: combined }];
}
