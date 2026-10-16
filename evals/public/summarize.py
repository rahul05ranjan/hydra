"""Collect public-benchmark results (BFCL from the local run, lm-eval from the Kaggle runs) into
evals/results/public/summary.json. Only aggregate scores and run settings are kept.
Usage: python evals/public/summarize.py <bench-results dir>"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(sys.argv[1])
MODELS = {'hydra-nano-v2': 'Hydra Nano v2', 'qwen3.5-0.8b': 'Qwen3.5-0.8B (base)'}
BFCL = {'data_non_live.csv': ['Non-Live Overall Acc', 'Python Simple AST', 'Java Simple AST', 'JavaScript Simple AST',
                              'Multiple AST', 'Parallel AST', 'Parallel Multiple AST', 'Irrelevance Detection'],
        'data_live.csv': ['Live Overall Acc', 'Python Simple AST', 'Python Multiple AST', 'Python Parallel AST',
                          'Python Parallel Multiple AST', 'Irrelevance Detection', 'Relevance Detection'],
        'data_multi_turn.csv': ['Multi Turn Overall Acc', 'Base', 'Miss Func', 'Miss Param', 'Long Context']}
LMEVAL = {'mmlu': 'acc,none', 'arc_challenge': 'acc_norm,none', 'hellaswag': 'acc_norm,none',
          'gsm8k': ['exact_match,flexible-extract', 'exact_match,strict-match'],
          'ifeval': ['prompt_level_strict_acc,none', 'inst_level_strict_acc,none']}


def percent(text):
    return float(text.rstrip('%'))


def kaggle_runs():
    runs = {}
    for directory in ('kaggle-v2', 'kaggle'):
        summary = json.loads((RESULTS / directory / 'public-bench/summary.json').read_text())
        for name, run in summary['runs'].items():
            if run['exit'] == 0 and not name.startswith('precision'):
                runs[name] = (run, summary)
    return runs


out = {'protocol': {
    'models': {'hydra-nano-v2': 'rahul05ranjan/hydra-nano-git @ 8129125f (weights 7b6b4662, Q8_0 GGUF 6d6542c8)',
               'qwen3.5-0.8b': 'Qwen/Qwen3.5-0.8B @ 2fc06364, text model only (752,393,024 parameters; Q8_0 GGUF c709226b)'},
    'thinking': 'off for both models, as Hydra runs',
    'bfcl': 'bfcl-eval 2026.3.23, BFCL v4 non-live, live and multi-turn (agentic categories need third-party keys and were not run, so BFCL "Overall" is not reported); Q8_0 GGUF on llama.cpp b11563, Metal; evals/public/bfcl_qwen35.py',
    'lm_eval': 'lm-evaluation-harness 0.4.13, transformers 5.19.0, fp16 on Kaggle 2x T4 (fp16 matched a bf16 MPS slice within one question); MMLU, ARC-Challenge, HellaSwag 0-shot log-likelihood; GSM8K 5-shot and IFEval 0-shot with the chat template; evals/public/kaggle_kernel.py'},
    'scores': {}}
runs = kaggle_runs()
for key, label in MODELS.items():
    scores = {'label': label, 'bfcl': {}, 'lm_eval': {}}
    for file, columns in BFCL.items():
        rows = list(csv.reader(open(RESULTS / 'bfcl' / key / 'score' / file)))
        row = dict(zip(rows[0], rows[1]))
        scores['bfcl'][file.removeprefix('data_').removesuffix('.csv')] = {c: percent(row[c]) for c in columns}
    for suite in ('ll', 'gen'):
        run, summary = runs[f'{key}-{suite}']
        for task, metrics in LMEVAL.items():
            if task in run['results']:
                for metric in metrics if isinstance(metrics, list) else [metrics]:
                    scores['lm_eval'][f'{task}/{metric}'] = round(100 * run['results'][task][metric], 2)
    out['scores'][key] = scores
target = ROOT / 'evals/results/public/summary.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({k: {'bfcl': {s: v[next(iter(v))] for s, v in sc['bfcl'].items()}, 'lm_eval': sc['lm_eval']} for k, sc in out['scores'].items()}, indent=1))
