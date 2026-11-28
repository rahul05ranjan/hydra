"""Seventh tool-calling mix, built 2026-11-28: the v5 mix unchanged plus new Git planner rows for three thin intents.

v5 (train/build_toolcall_data_v5.py) was the closest candidate yet but missed Git development gates (original 197 vs
v2's 200, extended 784 vs 800). On the development sets its misses were probe choices on three intents whose
training rows carry very few wordings: upstream ahead/behind (picked branches or remotes), untracked files (picked
diff) and the files of the newest commit (picked log). v6 tried more weight on all of v2's Git and chat rows and a
lower learning rate instead, and lost Git and BFCL accuracy, so v7 goes back to v5's rows and recipe and adds only
rows for those three intents. Their wordings come from train/git_wordings_v7.py (GLM-5.3 from descriptions only,
filtered away from every development, held-out and sealed Git wording). Each new row uses the planner prompt the
production code sends today, captured the way train/build_balanced_git.mjs captures it.

Usage: python train/git_wordings_v7.py && python train/build_toolcall_data_v7.py
"""
import importlib.util
import json
from pathlib import Path
import random
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FIFTH = ROOT / 'train/data-toolcall-v5'
WORDINGS = ROOT / 'train/data-git-wordings-v7/wordings.json'
OUT = ROOT / 'train/data-toolcall-v7'
SEED = 20261128
REPEAT = 2
CAPTURE = """
import * as git from './skills/hydra/scripts/lib/git.mjs';
import { Unavailable } from './skills/hydra/scripts/lib/runtime.mjs';
const stop = new Unavailable('prompt capture only'); let options;
try { await git.gather('Inspect repository branch references.', process.cwd(), async value => { options = value; throw stop; }); }
catch (error) { if (error !== stop) throw error; }
process.stdout.write(options.system);
"""


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'train/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    first = load_module('build_toolcall_data')
    fifth_spec = json.loads((FIFTH / 'manifest.json').read_text())
    if fifth_spec['dataSha256'] != first.sha256(FIFTH / 'train.jsonl'):
        raise ValueError('data-toolcall-v5 does not match its manifest')
    rows = [json.loads(l) for l in (FIFTH / 'train.jsonl').read_text().splitlines() if l.strip()]
    wordings = json.loads(WORDINGS.read_text())
    system = subprocess.run(['node', '--input-type=module', '-e', CAPTURE], cwd=ROOT, capture_output=True,
                            text=True, check=True).stdout
    if 'Choose 1 to 3 probes' not in system: raise ValueError('Planner prompt capture failed')
    added = []
    for intent, questions in wordings['wordings'].items():
        target = json.dumps({'probes': [{'probe': wordings['probes'][intent]}]}, separators=(',', ':'))
        for question in questions:
            added += [{'head': 'git', 'intent': intent, 'source': 'git-wordings-v7',
                       'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': question},
                                    {'role': 'assistant', 'content': target}]}] * REPEAT
    rows = rows + added
    random.Random(SEED).shuffle(rows)
    stats = {'fromV5': len(rows) - len(added), 'added': {intent: len(q) * REPEAT for intent, q in wordings['wordings'].items()},
             'repeat': REPEAT}
    rows = first.contract_filter(rows, stats)
    manifest = {
        'scope': 'Tool-calling mix v7: the v5 mix unchanged, plus Git planner rows for upstream sync, untracked files '
                 'and the newest commit\'s files, with new GLM-5.3 wordings.',
        'seed': SEED, 'maxTokens': fifth_spec['maxTokens'], 'teacher': fifth_spec['teacher'],
        'sources': {'train/data-toolcall-v5': {'dataSha256': fifth_spec['dataSha256'], 'uses': 'every row'},
                    'train/data-git-wordings-v7': {'sha256': first.sha256(WORDINGS), 'uses': 'new Git planner rows',
                                                   'stats': wordings['stats'], 'overlap': wordings['overlap']}},
        'callFilter': fifth_spec['callFilter'], 'declineTargets': fifth_spec['declineTargets'],
        'probeFilter': fifth_spec['probeFilter'], 'bfclFilter': fifth_spec['bfclFilter'],
        'worldSeeds': fifth_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False,
        'exclusionFilter': 'New wordings were compared by script with development, held-out and sealed Git wordings '
                           'and dropped when near one; none of those wordings is in the data.'}
    first.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    first.write(rows, stats, manifest)


if __name__ == '__main__':
    main()
