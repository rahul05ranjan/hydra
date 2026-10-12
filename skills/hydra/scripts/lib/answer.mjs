import { Unavailable } from './runtime.mjs';

// Output this small costs less to hand over whole than to describe, and whole is always faithful.
const PASS_THROUGH = 800;
const PER_SECTION = 5000;
const TOTAL = 14000;
const MAX_LINE = 200;
const MAX_CITED = 12;
const HEAD_LINES = 8;
// Always shown, cited or not: the top of an output carries its shape (branch line, diffstat, newest commit).
const LEAD_LINES = 3;
// What an agent would have read by running the command itself; its Bash tool truncates around here.
const ACCOUNT_CAP = 30000;
const COMPLETE_PROBES = new Set(['status', 'log', 'branches', 'remotes', 'stash', 'tags', 'worktrees']);

const SCHEMA = {
  type: 'object',
  properties: {
    lines: { type: 'array', items: { type: 'integer' }, maxItems: MAX_CITED },
  },
  required: ['lines'],
};

const SYSTEM = `You select verbatim evidence that answers a question about a repository.
Each output line starts with its line number in brackets, like [1], [2], [3].
Return a JSON object:
- "lines": An array of integer line numbers that directly contain the answer (e.g. [1, 2]). Always cite the specific lines containing the commits, files, author names, branch names, or status changes asked about.
Do not interpret commit subjects as changed file names. Cite the diffstat or patch lines for changes.

Examples:
Output:
$ git status --short --branch
[1] ## main...origin/main
[2]  M src/app.js
[3] ?? test.js
Question: what files are modified?
-> {"lines":[2]}

Output:
$ git log -n3
[1] 3a1b2c3 2026-04-10 Sarah: fix login timeout
[2] 4d5e6f7 2026-04-09 Alex: add metrics exporter
[3] 7g8h9i0 2026-04-08 Sarah: update dependencies
Question: who committed lately?
-> {"lines":[1,2,3]}

Output:
$ git show HEAD
[1] commit 9a8b7c6
[2] Author: Kim <kim@example.com>
[3] Date:   2026-04-11
[4]     refactor: cleanup database pool
[5] ---
[6]  src/pool.rs | 2 +-
[7]  1 file changed, 1 insertion(+), 1 deletion(-)
Question: what files changed in the last commit?
-> {"lines":[6]}`;

const NO_ANSWER = 'The local model gave no usable answer. The start of each output follows.';

// The model only chooses line numbers; the evidence printed is the command's own text, never a paraphrase.
export async function answer(question, sections, chat) {
  const rawChars = sections.reduce((sum, section) => sum + Math.min(section.out.length, ACCOUNT_CAP), 0);
  if (rawChars <= PASS_THROUGH || sections.every(section => COMPLETE_PROBES.has(section.probe))) {
    return { text: sections.map(section => `$ ${section.cmd}\n${section.out.trimEnd()}`).join('\n\n'), rawChars };
  }

  let budget = TOTAL;
  let count = 0;
  const parts = sections.map(section => {
    const all = section.out.trimEnd().split('\n');
    const kept = [];
    let room = Math.min(PER_SECTION, budget);
    for (const line of all) {
      const text = line.slice(0, MAX_LINE);
      if (text.length + 1 > room) break;
      kept.push({ id: ++count, text });
      room -= text.length + 1;
      budget -= text.length + 1;
    }
    return { cmd: section.cmd, total: all.length, lines: kept, complete: COMPLETE_PROBES.has(section.probe), out: section.out };
  });

  const numbered = parts
    .map(part => [`$ ${part.cmd}`, ...part.lines.map(line => `[${line.id}] ${line.text}`)].join('\n'))
    .join('\n\n');

  let reply;
  try {
    reply = await chat({ system: SYSTEM, user: `${numbered}\n\nQuestion: ${question}`, schema: SCHEMA });
  } catch (e) {
    if (e instanceof Unavailable) throw e;
  }
  const cited = new Set(
    (Array.isArray(reply?.lines) ? reply.lines : []).filter(id => Number.isInteger(id) && id >= 1 && id <= count),
  );

  const evidence = parts
    .map(part => {
      if (part.complete) return `$ ${part.cmd}\n${part.out.trimEnd()}`;
      const picked = cited.size
        ? part.lines.filter((line, i) => i < LEAD_LINES || cited.has(line.id))
        : part.lines.slice(0, HEAD_LINES);
      const rest = part.total - picked.length;
      return [`$ ${part.cmd}`, ...picked.map(line => line.text), ...(rest > 0 ? [`(${rest} more lines not shown)`] : [])].join(
        '\n',
      );
    })
    .join('\n\n');

  return { text: `${cited.size ? 'Selected evidence:' : NO_ANSWER}\n\n${evidence}`, rawChars };
}
