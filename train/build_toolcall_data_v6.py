"""Sixth tool-calling mix, built 2026-11-27 from the v5 mix with no new teacher replies.

The v5 candidate (GLM-5.3 distillation, train/build_toolcall_data_v5.py) fixed over-calling on BFCL but missed two
Git development gates (original 197 vs v2's 200, extended 784 vs 800) and lost IFEval (46.77 vs 54.16). Its Git misses
were probe choices on a few phrasings, not broad forgetting, so v6 keeps every v5 tool-calling row unchanged and only
gives v2's own replies more weight: the chat and Git rows from train/data-toolcall-v3 appear three times instead of
twice. The training run also halves the LoRA learning rate (train/kaggle/toolcall_control.py, run v6). No development
phrasing is added. No Hydra development, held-out or sealed input.

Usage: python train/build_toolcall_data_v6.py
"""
import importlib.util
import json
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]
FIFTH = ROOT / 'train/data-toolcall-v5'
THIRD = ROOT / 'train/data-toolcall-v3'
OUT = ROOT / 'train/data-toolcall-v6'
SEED = 20261127
REUSED_REPEAT = 3


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'train/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    first = load_module('build_toolcall_data')
    fifth_spec = json.loads((FIFTH / 'manifest.json').read_text())
    third_spec = json.loads((THIRD / 'manifest.json').read_text())
    for spec, folder in ((fifth_spec, FIFTH), (third_spec, THIRD)):
        if spec['dataSha256'] != first.sha256(folder / 'train.jsonl'):
            raise ValueError(f'{folder.name} does not match its manifest')
    read = lambda folder: [json.loads(l) for l in (folder / 'train.jsonl').read_text().splitlines() if l.strip()]
    toolcall = [r for r in read(FIFTH) if r['head'] == 'toolcall']
    earlier = read(THIRD)
    chat = [r for r in earlier if r['head'] == 'chat']
    git = [r for r in earlier if r['head'] == 'git']
    rows = toolcall + (chat + git) * REUSED_REPEAT
    random.Random(SEED).shuffle(rows)
    stats = {'toolcallFromV5': len(toolcall), 'reused': {'chat': len(chat), 'git': len(git), 'repeat': REUSED_REPEAT}}
    rows = first.contract_filter(rows, stats)
    manifest = {
        'scope': 'Tool-calling mix v6: the v5 GLM-5.3 tool-calling rows unchanged; chat and Git rows from v3 '
                 "(v2's own replies) three times instead of twice.",
        'seed': SEED, 'maxTokens': fifth_spec['maxTokens'], 'teacher': fifth_spec['teacher'],
        'sources': {'train/data-toolcall-v5': {'dataSha256': fifth_spec['dataSha256'], 'uses': 'tool-calling rows'},
                    'train/data-toolcall-v3': {'dataSha256': third_spec['dataSha256'], 'uses': 'chat rows, Git rows'}},
        'callFilter': fifth_spec['callFilter'], 'declineTargets': fifth_spec['declineTargets'],
        'probeFilter': fifth_spec['probeFilter'], 'bfclFilter': fifth_spec['bfclFilter'],
        'worldSeeds': fifth_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False}
    first.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    first.write(rows, stats, manifest)


if __name__ == '__main__':
    main()
