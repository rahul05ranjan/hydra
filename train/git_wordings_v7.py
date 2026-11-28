"""New training wordings for three thin Git planner intents, written by GLM-5.3 from intent descriptions only.

v5 (train/build_toolcall_data_v5.py) missed Git development gates on three intents whose training rows have very
few wordings in train/build_balanced_git.mjs: upstream ahead/behind (2 wordings), untracked files (2) and the files of
the newest commit (6). This asks GLM-5.3 for new wordings of those three intents. GLM sees only the descriptions
below, never a development, held-out or sealed question. Every reply is then compared by script with every Git
wording in evals/ (development, extended, paraphrase, lines, glm, holdout3, holdout_lines and the sealed git1 set,
which is loaded in memory and never printed or saved) and dropped when its word overlap with any of them is 0.5 or
more; near-duplicates inside the new set are dropped the same way. Accepted wordings are frozen in
train/data-git-wordings-v7/wordings.json; GLM's raw replies are cached beside them so a rerun makes no request.

Usage: python train/git_wordings_v7.py
"""
import json
from pathlib import Path
import re
import subprocess

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'train/data-git-wordings-v7'
THRESHOLD = 0.5
# Dropped after reading the kept wordings (2026-11-28): could also mean uncommitted edits.
REVIEW_DROPS = {'Which paths were added or deleted in the last change?'}
ASK = 45
INTENTS = {
    'sync': {'probe': 'status',
             'description': 'Whether the current local branch is ahead of, behind, or level with the remote branch it '
                            'tracks: how many commits it leads or trails by, whether it needs a push or a pull, whether '
                            'it is in sync with its upstream. Some wordings mention the remote, origin, the tracking '
                            'branch or the upstream; the question is always about the current branch\'s position.'},
    'untracked': {'probe': 'status',
                  'description': 'Which files exist in the working directory that Git does not track at all: new '
                                 'files never added, files not in the index, paths Git would show as untracked. Not '
                                 'ignored files and not modified tracked files. Some wordings mention the index, '
                                 'staging or adding; the question is always about files Git has never tracked.'},
    'latest_files': {'probe': 'show',
                     'description': 'Which files were changed by the most recent commit on the current branch (HEAD, '
                                    'the last commit, the tip, the latest revision): the list of paths that commit '
                                    'added, modified or deleted. Not uncommitted edits and not a range of commits.'},
}
SYSTEM = ('You write varied questions that a developer might ask a coding assistant about their Git repository. '
          'Reply with JSON only: {"questions": [...]}.')
PROMPT = ('Write {n} different questions or requests for this need:\n\n{description}\n\n'
          'Mix short and longer ones (3 to 18 words), questions and imperative requests, casual and formal tone, and '
          'vary the vocabulary widely; do not start most of them the same way. Do not include file names, branch '
          'names, people, commit hashes or numbers. Do not mention git commands or flags.')


def words(text):
    return set(re.findall(r"[a-z0-9']+", text.lower()))


def overlap(a, b):
    a, b = words(a), words(b)
    return len(a & b) / len(a | b) if a | b else 0.0


def strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, dict):
        for item in value.values(): yield from strings(item)
    elif isinstance(value, list):
        for item in value: yield from strings(item)


def protected():
    """Every Git wording in evals/, as one flat list. git1 is loaded by node and kept in memory only."""
    found = []
    for file in sorted((ROOT / 'evals').glob('git_*/**/phrasings.json')) + sorted((ROOT / 'evals').glob('git_*/phrasings.json')):
        found += strings(json.loads(file.read_text()))
    for file in sorted((ROOT / 'evals').glob('git_*/**/tasks.jsonl')) + sorted((ROOT / 'evals').glob('git_*/tasks.jsonl')):
        found += [json.loads(line)['question'] for line in file.read_text().splitlines() if line.strip()]
    sealed = subprocess.run(['node', '--input-type=module', '-e',
        "const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m.INTENTS));",
        (ROOT / 'evals/git1/questions.mjs').as_uri()], capture_output=True, text=True, check=True).stdout
    found += strings(json.loads(sealed))
    return sorted(set(text for text in found if len(text.split()) >= 2))


def ask(intent):
    import sys
    sys.path.insert(0, str(ROOT / 'train'))
    import cloudflare_dev
    config = cloudflare_dev.configuration({**dotenv_values(ROOT / '.env')})
    messages = [{'role': 'system', 'content': SYSTEM},
                {'role': 'user', 'content': PROMPT.format(n=ASK, description=INTENTS[intent]['description'])}]
    reply = cloudflare_dev.request_json(config, messages, maximum=4096, timeout=180)
    return {'model': reply['model'], 'usage': reply['usage'], 'questions': reply['value'].get('questions', [])}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / 'glm-replies.json'
    replies = json.loads(cache.read_text()) if cache.exists() else {}
    for intent in INTENTS:
        if intent not in replies:
            replies[intent] = ask(intent)
            cache.write_text(json.dumps(replies, indent=1) + '\n')
    guard = protected()
    accepted, stats = {}, {}
    for intent, reply in replies.items():
        kept, near, inside, malformed = [], 0, 0, 0
        for question in reply['questions']:
            if not isinstance(question, str) or not 3 <= len(question.split()) <= 22 or re.search(r'`|--|\bgit \w', question):
                malformed += 1; continue
            question = ' '.join(question.split())
            if question in REVIEW_DROPS: malformed += 1; continue
            if any(overlap(question, other) >= THRESHOLD for other in guard): near += 1; continue
            if any(overlap(question, other) >= THRESHOLD for other in kept): inside += 1; continue
            kept.append(question)
        accepted[intent] = kept
        stats[intent] = {'asked': ASK, 'returned': len(reply['questions']), 'malformed': malformed,
                         'nearEvalWording': near, 'nearAnotherNewWording': inside, 'kept': len(kept)}
    result = {'scope': 'Training wordings for three Git planner intents, written by GLM-5.3 from descriptions only.',
              'teacher': '@cf/zai-org/glm-5.3', 'overlap': f'word-set Jaccard >= {THRESHOLD} against {len(guard)} '
              'evaluation wordings (development, held-out, sealed git1) and within the new set',
              'probes': {intent: spec['probe'] for intent, spec in INTENTS.items()}, 'stats': stats,
              'wordings': accepted, 'sealedInputsUsed': 'only as an exclusion filter, never read or kept',
              'developmentInputsUsed': 'only as an exclusion filter'}
    (OUT / 'wordings.json').write_text(json.dumps(result, indent=1) + '\n')
    print(json.dumps(stats, indent=1))


if __name__ == '__main__':
    main()
