"""Push, watch and collect the private Kaggle notebook in kaggle_kernel.py. Credentials come from the
root .env and are never printed. Usage: python evals/public/kaggle_control.py push|status|output"""
import os
import subprocess
import sys
import json
import shutil
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
STAGE = Path.home() / '.hydra/kaggle-public-bench'
OUTPUT = Path.home() / '.hydra/build/bench-results/kaggle'
USER = os.environ['KAGGLE_USERNAME']
KERNEL = f'{USER}/hydra-public-benchmarks'
TIMEOUT = 12 * 3600  # the longest GPU session Kaggle allows


def kaggle(*args):
    subprocess.run([sys.executable, '-X', 'utf8', '-m', 'kaggle', *args], check=True)


action = sys.argv[1]
if action == 'push':
    kernel = STAGE / 'kernel'
    kernel.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'evals/public/kaggle_kernel.py', kernel / 'kaggle_kernel.py')
    (kernel / 'kernel-metadata.json').write_text(json.dumps({
        'id': KERNEL, 'title': 'Hydra public benchmarks', 'code_file': 'kaggle_kernel.py',
        'language': 'python', 'kernel_type': 'script', 'is_private': True, 'enable_gpu': True,
        'enable_internet': True, 'dataset_sources': [], 'competition_sources': [], 'kernel_sources': []}, indent=2))
    kaggle('kernels', 'push', '-p', str(kernel), '--accelerator', 'NvidiaTeslaT4', '--timeout', str(TIMEOUT))
elif action == 'status':
    kaggle('kernels', 'status', KERNEL)
elif action == 'logs':
    kaggle('kernels', 'logs', KERNEL)
elif action == 'output':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    kaggle('kernels', 'output', KERNEL, '-p', str(OUTPUT), '--force')
else:
    sys.exit('usage: push|status|output')
