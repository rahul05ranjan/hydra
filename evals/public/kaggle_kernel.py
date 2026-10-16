"""Public lm-evaluation-harness benchmarks for Hydra Nano v2 and base Qwen3.5-0.8B on a private Kaggle
GPU notebook. Evaluation only: no training, no Hydra sealed or holdout data.

Both models load as the same 752M-parameter text model (Qwen3_5ForCausalLM) with identical settings,
so the difference between them is what Hydra's fine-tuning changed:
  - MMLU, ARC-Challenge, HellaSwag: 0-shot, log-likelihood.
  - GSM8K (5-shot, chat turns) and IFEval: generative, chat template, thinking off (as Hydra runs).
T4 has no bf16. A precision check first scores a 120-question slice in fp16 against the same slice
scored in bf16 on Apple MPS; if any metric moves by more than two questions, every run uses fp32.
Results, logs and summary.json go to /kaggle/working/public-bench.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

START = time.time()
DEADLINE = START + 12 * 3600 - 20 * 60  # Kaggle ends a GPU session at 12 hours
OUT = Path('/kaggle/working/public-bench')
MODELS = Path('/tmp/models')
HYDRA = ('rahul05ranjan/hydra-nano-git', '8129125fad1c664bbb58ebd3238f6598c879eb23',
         '7b6b4662dbba3542fd296696b1c94e06240b28931e5b8ac6eec5cb99fc3dc8f0')
BASE = ('Qwen/Qwen3.5-0.8B', '2fc06364715b967f1860aea9cf38778875588b17')
# Hydra Nano v2, bf16 on Apple MPS, lm-eval 0.4.13, 0-shot, --limit 40 per task.
REFERENCE = {('arc_challenge', 'acc,none'): 0.300, ('arc_challenge', 'acc_norm,none'): 0.350,
             ('hellaswag', 'acc,none'): 0.350, ('hellaswag', 'acc_norm,none'): 0.475,
             ('mmlu_abstract_algebra', 'acc,none'): 0.350}
TOLERANCE = 2 / 40 + 1e-9
# Which suites this run scores: 'll' (MMLU, ARC-Challenge, HellaSwag) and/or 'gen' (GSM8K, IFEval).
# Version 2 scored 'gen'; its 'll' runs ran out of GPU memory, so version 3 scores 'll' alone.
PHASES = {'ll'}
OUT.mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)
summary = {'started': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'hydra': HYDRA, 'base': BASE, 'runs': {}}


def log(message):
    line = f'[{time.time() - START:7.0f}s] {message}'
    print(line, flush=True)
    with open(OUT / 'kernel.log', 'a') as stream:
        stream.write(line + '\n')


def save():
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')


def sh(args, log_file=None, env=None, timeout=None):
    with open(log_file or OUT / 'setup.log', 'a') as stream:
        return subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT, env=env, timeout=timeout).returncode


def sha256(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(8 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def results(directory):
    files = sorted(Path(directory).rglob('results_*.json'))
    return json.loads(files[-1].read_text())['results'] if files else None


def lm_eval(model_dir, name, dtype, tasks, gpu, extra=(), model_extra='', limit=None, batch='32'):
    out = OUT / name
    args = [sys.executable, '-m', 'lm_eval', '--model', 'hf',
            '--model_args', f'pretrained={model_dir},dtype={dtype}{model_extra}', '--device', 'cuda',
            '--batch_size', batch, '--tasks', tasks, '--seed', '1234', '--output_path', str(out), *extra]
    if limit:
        args += ['--limit', str(limit)]
    env = dict(os.environ, CUDA_VISIBLE_DEVICES=str(gpu))
    started = time.time()
    try:
        code = sh(args, OUT / f'{name}.log', env, timeout=max(60, DEADLINE - time.time()))
    except subprocess.TimeoutExpired:
        code = 'timeout'
    summary['runs'][name] = {'exit': code, 'seconds': round(time.time() - started), 'dtype': dtype, 'gpu': gpu,
                             'tasks': tasks, 'results': results(out)}
    save()
    log(f'{name}: exit {code} in {summary["runs"][name]["seconds"]}s')
    return code


log('installing lm-eval 0.4.13 and transformers 5.19.0')
pins = ['lm-eval[api,ifeval,math]==0.4.13', 'transformers==5.19.0', 'accelerate', 'langdetect', 'immutabledict']
assert sh([sys.executable, '-m', 'pip', 'install', '-q', *pins]) == 0, 'pip install failed'
fla = sh([sys.executable, '-m', 'pip', 'install', '-q', 'flash-linear-attention']) == 0
gpus = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                      capture_output=True, text=True).stdout.strip().splitlines()
import torch  # noqa: E402  (after installs)
import transformers  # noqa: E402
summary.update(gpus=gpus, torch=torch.__version__, transformers=transformers.__version__, fla=fla)
log(f'GPUs: {gpus}; torch {torch.__version__}; transformers {transformers.__version__}; fla installed: {fla}')
save()

from huggingface_hub import snapshot_download  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402

hydra_dir = Path(snapshot_download(HYDRA[0], revision=HYDRA[1], local_dir=MODELS / 'hydra-nano-v2',
                                   allow_patterns=['*.json', '*.jinja', 'model.safetensors']))
assert sha256(hydra_dir / 'model.safetensors') == HYDRA[2], 'Hydra weights differ from v2'
base_raw = Path(snapshot_download(BASE[0], revision=BASE[1], local_dir=MODELS / 'qwen3.5-0.8b'))
base_dir = MODELS / 'qwen3.5-0.8b-text'
base = AutoModelForCausalLM.from_pretrained(base_raw, dtype=torch.float16)
assert type(base).__name__ == 'Qwen3_5ForCausalLM' and sum(p.numel() for p in base.parameters()) == 752393024
base.save_pretrained(base_dir)
AutoTokenizer.from_pretrained(base_raw).save_pretrained(base_dir)
for name in ('chat_template.jinja',):
    (base_dir / name).write_text((base_raw / name).read_text())
# The same generation stop tokens as Hydra, so both models end at <|im_end|>.
(base_dir / 'generation_config.json').write_text((hydra_dir / 'generation_config.json').read_text())
del base
log('models ready; Hydra v2 weights verified')

check_tasks = 'arc_challenge,hellaswag,mmlu_abstract_algebra'
dtype = 'float16'
code = lm_eval(hydra_dir, 'precision-check-fp16', dtype, check_tasks, 0, ('--num_fewshot', '0'), limit=40)
if code != 0 and fla:
    log('fp16 check failed with flash-linear-attention; retrying without it')
    sh([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'flash-linear-attention'])
    summary['fla'] = fla = False
    code = lm_eval(hydra_dir, 'precision-check-fp16', dtype, check_tasks, 0, ('--num_fewshot', '0'), limit=40)
check = summary['runs']['precision-check-fp16']['results'] or {}
drift = {f'{task}/{metric}': (check.get(task, {}).get(metric), ref) for (task, metric), ref in REFERENCE.items()}
ok = code == 0 and all(v is not None and abs(v - ref) <= TOLERANCE for v, ref in drift.values())
summary['precisionCheck'] = {'fp16Matches': ok, 'drift': drift, 'tolerance': TOLERANCE}
if not ok:
    dtype = 'float32'
    log(f'fp16 differs from the bf16 reference ({drift}); all runs use fp32')
summary['dtype'] = dtype
save()
log(f'precision: {dtype}')

ll = ('--num_fewshot', '0')
gen = ('--apply_chat_template', '--fewshot_as_multiturn', '--log_samples')
jobs = [('hydra-nano-v2', hydra_dir), ('qwen3.5-0.8b', base_dir)]


def suite(name, model_dir, gpu):
    # A 248k-token vocabulary makes the logits of 32 long MMLU prompts outgrow a T4's 15 GB, so
    # log-likelihood batches are sized by lm-eval, re-measured four times as prompts get shorter.
    if 'll' in PHASES:
        lm_eval(model_dir, f'{name}-ll', dtype, 'mmlu,arc_challenge,hellaswag', gpu, ll, batch='auto:4')
    if 'gen' in PHASES:
        lm_eval(model_dir, f'{name}-gen', dtype, 'gsm8k,ifeval', gpu, gen, ',enable_thinking=False')


if len(gpus) >= 2:
    from threading import Thread
    threads = [Thread(target=suite, args=(name, model_dir, gpu)) for gpu, (name, model_dir) in enumerate(jobs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
else:
    for name, model_dir in jobs:
        suite(name, model_dir, 0)
summary['finished'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
summary['elapsedSeconds'] = round(time.time() - START)
save()
log('done')
