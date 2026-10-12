import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from './exec.mjs';
import { Unavailable } from './runtime.mjs';

const PASS_THROUGH = 800;
const MAX_CANDIDATES = 60;
const MAX_CITED = 12;

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
  const candidateIndices = new Set();

  const ERROR_START = /(?:^|\s)(?:FAIL(?:ED)?|[●•]|error(?:\[E\d+\]| TS\d+)?|panicked at|AssertionError|assert\s|assertion\s|Expected:|Received:|- Snapshot|--- FAIL:|____+\s+\w+)/i;
  const USER_STACK = /\b([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|rb)):(\d+)(?::(\d+))?/;
  const IGNORE_STACK = /(?:node_modules|site-packages|\.cargo\/registry|internal\/process|\bat <anonymous>:\d+|\(<anonymous>:\d+|\/usr\/(?:local\/)?lib\/python|\/lib\/python)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (ERROR_START.test(line)) {
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 5); j++) {
        if (!IGNORE_STACK.test(lines[j])) {
          candidateIndices.add(j);
        }
      }
    }

    if (USER_STACK.test(line) && !IGNORE_STACK.test(line)) {
      candidateIndices.add(i);
    }
  }

  // Include trailing summary lines
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    if (/(?:failed|passed|errors|finished in|Test Files|Tests\s+\d+)/i.test(lines[i])) {
      candidateIndices.add(i);
    }
  }

  return Array.from(candidateIndices)
    .sort((a, b) => a - b)
    .slice(0, MAX_CANDIDATES)
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
      .filter(l => /(?:passed|tests? passed|ok|success|finished in|\b(?:pass|fail(?:ures|ed)?|tests?|suites|cancelled|skipped|todo)\s*[: ]\s*\d+)/i.test(l))
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
    // Fallback if no specific failure patterns matched
    const head = rawText.split('\n').slice(0, 15).join('\n');
    return {
      text: `$ ${cmd} (exit ${exitCode})\n${head}\n(... remaining ${rawText.split('\n').length - 15} lines withheld)`,
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

  const FAILURE_HEADER = /(?:^|\s)(?:FAIL(?:ED)?|[●•]|panicked at|AssertionError|assert\s|assertion\s|Expected:|Received:|[-+]\s|--- FAIL:|____+\s+\w+)/i;
  const USER_STACK = /\b([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|rb)):(\d+)(?::(\d+))?/;
  const IGNORE_STACK = /(?:node_modules|site-packages|\.cargo\/registry|internal\/process|\bat <anonymous>:\d+|\(<anonymous>:\d+|\/usr\/(?:local\/)?lib\/python|\/lib\/python)/;

  let evidenceLines;
  if (citedIds.size > 0) {
    const essentialIds = new Set(
      candidates
        .filter(c => (FAILURE_HEADER.test(c.text) || USER_STACK.test(c.text)) && !IGNORE_STACK.test(c.text))
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
