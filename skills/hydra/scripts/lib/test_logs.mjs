import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from './exec.mjs';
import { Unavailable } from './runtime.mjs';

const PASS_THROUGH = 800;
const MAX_CANDIDATES = 60;
const MAX_CITED = 12;
const WHOLE_REGIONS = 2000;
// Colour codes and the prefixes CI runners put on each line (timestamps, BuildKit step markers,
// GitLab section markers) are removed before matching. Output always keeps the original line.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const CI_PREFIX = /^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s?|#\d+ \d+\.\d+ |section_(?:start|end):\d+:[\w-]+\r)+/;
const bare = line => line.replace(ANSI, '').replace(CI_PREFIX, '').replace(/\r$/, '');
// Numbered headers ("1) test name") are how Mocha, RSpec, PHPUnit and ExUnit open each failure.
// A header token may follow whitespace or a bracket/equals sign: "[ERROR]", "[FAIL]", "==41==ERROR".
const FAILURE_HEADER = /(?:^|[\s[(=])(?:FAIL(?:ED)?|[●•]|✘ \[fail\]:|not\s+ok\b|error(?:\[E\d+\]| TS\d+)?|[A-Za-z_][\w.$]*(?:Error|Exception)(?: \[\w+\])?\s*:|panic(?:ked at|:\s)|WARNING: DATA RACE|timed out\b|assert\s|assertion\s|Expected:|Received:|actual:|- Snapshot|[-+]\s|--- FAIL:|____+\s+\w+)|^\s*(?:left|right)\s*:|^\s*\d+\)\s+\S/i;
// Case-sensitive headers: failure markers at the start of a line, lint rule codes (ruff, pylint,
// shellcheck), a Timeout banner, and a diagnostic title ruled off with heavy box lines (Biome).
const MARKED_HEADER = /^\s*[✖✘✗×⨯]\s|(?:^\s*|\^-*\^?\s|:\s)[A-Z]{1,3}\d{3,5}\b(?: \[\*\]| \((?:error|warning|info|style)\))?[:\s]|(?:^|\s)Timeout(?:\s|$)|\s━{5,}\s*$/;
const isHeader = text => FAILURE_HEADER.test(text) || MARKED_HEADER.test(text);
const LAUNCH_ERROR = /(?:\bnot found\b|\bis not recognized\b|\bNo module named\b|\bCannot find module\b|\bMissing script:|\bENOENT\b|\bERR_MODULE_NOT_FOUND\b)/i;
const SOURCE_EXT = 'ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|scala|groovy|c|cc|cpp|cxx|h|hpp|cs|fs|swift|rb|php|ex|exs|erl|dart|hs|ml|mli|jl|zig|lua|R|pl|pm|t|sh|bash|bats|tf|svelte|vue';
// A source location: file:N, file(N) or file(N,M) (MSVC, tsc), file", line N (Python, OCaml),
// file:line N (.NET), file line N (shellcheck, Perl, Terraform, Bats), file N:M (Dart).
const LOCATION = `[\\w\\-./\\\\]+\\.(?:${SOURCE_EXT})(?::\\d+|\\(\\d+(?:,\\d+)?\\)|",? line \\d+|:line \\d+|,? line \\d+)|[\\w\\-./\\\\]+\\.dart \\d+:\\d+|"[^"\\n]+\\.(?:${SOURCE_EXT})",? line \\d+`;
const USER_STACK = new RegExp(LOCATION);
// A frame or diagnostic printed as a location on its own line (Go, Rust backtraces, Julia, rustc "-->").
const LOCATION_ONLY = new RegExp(`^\\s*(?:at\\s+|@\\s+|-->\\s+|└─\\s+)?(?:file://)?[A-Za-z]?:?(?:${LOCATION})`);
// Frames inside language runtimes, toolchains and test libraries, never the user's code.
const IGNORE_STACK = new RegExp([
  /node_modules|site-packages|\.cargo\/registry|internal\/process|\bnode:internal\/|\bat <anonymous>:\d+|\(<anonymous>:\d+/,
  /\/usr\/(?:local\/)?lib\/python|\/lib\/python|[\\/]Python[\d.]*[\\/](?:[\d.]+[\\/]x64[\\/])?Lib[\\/]/,
  /[\\/][Gg]o(?:-[\d.]+)?[\\/](?:[\d.]+[\\/](?:x64[\\/])?)?src[\\/][a-z]+[\\/]|\/rustc\/[0-9a-f]{7,}\//,
  /\borg\.junit\.|\bjava\.base\/|\bjdk\.internal\.|(?:^|\s)at (?:System|Microsoft|Xunit|NUnit)\./,
  /jsr\.io\/@std\/|deno\.land\/std|[\\/]gems[\\/][\w.-]+-\d+\.\d+[\w.]*[\\/]|[\\/]lib[\\/]ruby[\\/]\d/,
  /(?:^|[\s(])(?:\.\.\/)?(?:sysdeps|csu)\/|\/lib\/\w+-linux-gnu\/|(?:^|\s)\/usr\/(?:local\/)?include\/|\\(?:Microsoft Visual Studio|Windows Kits)\\/,
  /[\\/]zig[\\/](?:lib[\\/])?std[\\/]|[\\/]julia[\\/](?:stdlib|base)[\\/]|(?:^|\s)(?:package:(?:flutter|flutter_test|matcher|test_api|test_core|stack_trace)\/|dart:[a-z_]+[\s/])/,
  /(?:Raised at|Called from|Re-raised at) (?:Stdlib|Alcotest|Camlinternal)\w*/,
].map(re => re.source).join('|'));
// Count and status lines of a passing run; per-test "ok" or "PASSED" lines are not a summary.
const PASS_SUMMARY = /(?:passed|tests? passed|\bok\b|success|finished in|^\s*Ran\s+\d+\s+tests?\b|\b\d+\s+(?:passing|pending)\b|\btest result:|\b(?:pass|fail(?:ures|ed)?|tests?|suites|cancelled|skipped|todo)\s*[: ]\s*\d+)/i;
const PER_TEST = /\.\.\.\s*(?:ok|PASSED)\b|\bPASSED\s+\[\s*\d+%\]|^\s*[✓✔√]\s|^\s*ok \d+ /;
const DIAGNOSTIC_NOTE = /^\s*= (?:note|help): /;
// A rule line: Catch2 frames test titles with them, PHPStan frames its tables.
const RULE = /^\s*(?:[-=~─━]{20,}|-{3,}(?:\s+-{3,})+)\s*$/;

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

// Heuristic identification of test failures, assertion diffs, and source lines.
// Each candidate says whether it is essential: shown even when the model does not cite it.
export function extractFailureCandidates(logText) {
  const lines = logText.split('\n');
  const plain = lines.map(bare);
  const ignored = plain.map(text => IGNORE_STACK.test(text));
  const candidateRanks = new Map();
  const essential = new Set();
  const nearFailure = new Set();
  const headers = [];
  const add = (index, rank, key = false) => {
    if (ignored[index]) return;
    candidateRanks.set(index, Math.max(rank, candidateRanks.get(index) || 0));
    if (key) essential.add(index);
  };

  for (let i = 0; i < lines.length; i++) {
    if (!ignored[i] && (isHeader(plain[i]) || LAUNCH_ERROR.test(plain[i]))) {
      headers.push(i);
      add(i, 4, true);
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 5); j++) {
        add(j, 2);
      }
      // A header ending in a colon ("panicked at src/x.rs:4:9:", "Error Message:") prints its message next.
      if (/:\s*$/.test(plain[i])) {
        let next = i + 1;
        while (next < lines.length && next <= i + 2 && !plain[next].trim()) next++;
        if (next < lines.length && plain[next].trim()) add(next, 4, true);
      }
      for (let j = Math.max(0, i - 10); j <= Math.min(lines.length - 1, i + 20); j++) nearFailure.add(j);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    // rustc's "= note:" and "= help:" lines close a diagnostic (the lint name, the fix).
    if (!ignored[i] && DIAGNOSTIC_NOTE.test(plain[i])) add(i, nearFailure.has(i) ? 4 : 1, true);
    if (ignored[i] || !USER_STACK.test(plain[i])) continue;
    // A failure's own source location ranks with its header, so a log with more failures
    // than the budget keeps whole failures rather than only the headers of more of them.
    const rank = nearFailure.has(i) ? 4 : 1;
    add(i, rank, true);
    // A location on its own line belongs to the function or diagnostic printed just above it
    // (Go and Rust frames, rustc and ruff "-->" lines, esbuild locations).
    if (LOCATION_ONLY.test(plain[i])) {
      let p = i - 1;
      while (p >= i - 2 && p >= 0 && !plain[p].trim()) p--;
      if (p >= 0 && plain[p].trim() && !USER_STACK.test(plain[p]) && !/^\s*at\s/.test(plain[p])) add(p, rank, true);
    }
  }
  // A title between two rule lines (a Catch2 test name, a PHPStan file header) and the table
  // rows under it belong to the failure that follows them.
  for (let j = 0; j < lines.length; j++) {
    if (!RULE.test(plain[j])) continue;
    let k = j + 1;
    while (k < lines.length && k <= j + 4 && plain[k].trim() && !RULE.test(plain[k])) k++;
    if (k === j + 1 || k > j + 3 || k >= lines.length || !RULE.test(plain[k])) continue;
    let r = k + 1;
    while (r < lines.length && r <= k + 20 && plain[r].trim() && !RULE.test(plain[r])) r++;
    const table = r > k + 1 && r < lines.length && RULE.test(plain[r]);
    const end = table ? r : k;
    if (!headers.some(h => h > k && h <= end + 12)) continue;
    for (let t = j + 1; t < k; t++) add(t, 4, true);
    if (table) for (let t = k + 1; t < r; t++) add(t, 4, true);
  }

  // Trailing summary lines always keep a place: they carry the failure count the budget cannot.
  // A per-test "FAILED path::name" line is a failure, not a count, so it competes for the budget.
  const summary = [];
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    if (/(?:failed|passed|errors|finished in|Test Files|Tests\s+\d+)/i.test(plain[i]) && !/^FAILED \S+::/.test(plain[i]) && !ignored[i]) {
      summary.push(i);
      candidateRanks.delete(i);
    }
  }

  // The budget belongs to failure evidence first, rather than the first incidental trace lines.
  // Restore source order after selection so line numbers and verbatim context remain unchanged.
  return Array.from(candidateRanks.keys())
    .sort((a, b) => candidateRanks.get(b) - candidateRanks.get(a) || a - b)
    .slice(0, MAX_CANDIDATES - summary.length)
    .concat(summary)
    .sort((a, b) => a - b)
    .map(idx => ({ id: idx + 1, text: lines[idx], essential: essential.has(idx) }));
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
      .filter(l => PASS_SUMMARY.test(bare(l)) && !PER_TEST.test(bare(l)))
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

  // Failure regions this small cost less to return whole than to have the model cut down, and whole is always complete.
  const regions = candidates.map(c => c.text);
  if (regions.length && regions.join('\n').length <= WHOLE_REGIONS) {
    return { text: `$ ${cmd} (exit ${exitCode})\n${regions.join('\n')}`, rawChars, exitCode };
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
    evidenceLines = candidates
      .filter(c => citedIds.has(c.id) || c.essential)
      .map(c => c.text);
  }
  if (!evidenceLines || evidenceLines.length === 0) {
    // If model cited nothing or invalid lines, show the top candidate lines
    evidenceLines = candidates.slice(0, 12).map(c => c.text);
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
