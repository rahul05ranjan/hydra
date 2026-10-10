import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Load .env if present
function loadEnv() {
  try {
    const text = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch {}
}

loadEnv();

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const MODEL = process.env.CF_MODEL ?? '@cf/zai-org/glm-5.3';

if (!ACCOUNT || !TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN missing in .env');
  process.exit(1);
}

const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`;

async function callModel(system, user, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.7,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`CF HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? data.result?.response ?? '';
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// 20 intents and their required slot tokens
const INTENT_SPECS = [
  { intent: 'branch_current', slots: [], desc: 'Ask which branch is currently checked out' },
  { intent: 'sync', slots: [], desc: 'Ask whether current branch is ahead, behind or in sync with remote upstream' },
  { intent: 'modified_files', slots: [], desc: 'Ask which files have uncommitted or dirty changes' },
  { intent: 'untracked_files', slots: [], desc: 'Ask which files are untracked / new and not added to git' },
  { intent: 'staged_files', slots: [], desc: 'Ask which files or changes are staged for commit' },
  { intent: 'change_in_file', slots: ['{path}'], desc: 'Ask what changes or diff exist in a specific file {path}' },
  { intent: 'branch_diff_files', slots: ['{base}'], desc: 'Ask which files changed on this branch compared to base branch {base}' },
  { intent: 'last_commit', slots: [], desc: 'Ask what was in the most recent / last commit (hash or message)' },
  { intent: 'recent_commits', slots: ['{n}'], desc: 'Ask to show the last {n} commits in history' },
  { intent: 'file_last_change', slots: ['{path}'], desc: 'Ask who last changed {path} and what that change was' },
  { intent: 'file_history', slots: ['{path}'], desc: 'Ask for the history or past commits of file {path}' },
  { intent: 'author_commits', slots: ['{author}'], desc: 'Ask for commits written by author {author}' },
  { intent: 'message_search', slots: ['{word}'], desc: 'Ask for commits whose message contains {word}' },
  { intent: 'branch_commits', slots: ['{base}'], desc: 'Ask which commits exist on this branch that are not on base branch {base}' },
  { intent: 'last_commit_files', slots: [], desc: 'Ask which files were modified in the last commit' },
  { intent: 'commit_files', slots: ['{hash}'], desc: 'Ask which files were changed in commit {hash}' },
  { intent: 'branches', slots: [], desc: 'Ask to list all branches (local and remote)' },
  { intent: 'stashes', slots: [], desc: 'Ask to show or list stashed changes' },
  { intent: 'worktrees', slots: [], desc: 'Ask to list worktrees of this repo' },
  { intent: 'line_author', slots: ['{path}', '{token}'], desc: 'Ask who wrote or touched the line with {token} in file {path}' },
];

export async function generatePhrasings() {
  console.log(`Generating phrasings for 20 intents with ${MODEL}...`);
  const results = {};

  for (const item of INTENT_SPECS) {
    const system = `You generate diverse English natural questions that a developer or coding agent asks about a git repository.
Output JSON only: an array of 12 distinct questions.
Requirements:
- Preserve every required slot EXACTLY: ${item.slots.length ? item.slots.join(', ') : 'none'}.
- Diverse sentence structures (short, conversational, formal, terse, imperative).
- Do not repeat templates.`;

    const user = `Intent: ${item.intent} (${item.desc}).
Slots that MUST appear in every question: ${item.slots.join(', ') || 'none'}.
Return a JSON array of 12 distinct question templates.`;

    const raw = await callModel(system, user);
    let parsed = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      console.warn(`Could not parse JSON for ${item.intent}, got:\n${raw.slice(0, 200)}`);
    }

    // Load git1 templates to strictly guarantee no overlap
    const git1List = (await import('../evals/git1/questions.mjs')).INTENTS[item.intent]?.templates ?? [];
    const git1Set = new Set(git1List.map(t => t.trim().toLowerCase()));

    // Code validation: ensure every required slot is present and no overlap with git1
    const valid = parsed.filter(
      q => typeof q === 'string' &&
           item.slots.every(slot => q.includes(slot)) &&
           !git1Set.has(q.trim().toLowerCase())
    );
    results[item.intent] = valid;
    console.log(`- ${item.intent}: ${valid.length} valid templates (0 overlap with git1)`);
  }

  const outPath = path.join(HERE, 'phrasings.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Saved phrasings to ${outPath}`);
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generatePhrasings().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
