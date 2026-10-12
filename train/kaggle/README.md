# Kaggle sealed evaluation

Put `KAGGLE_USERNAME` and `KAGGLE_API_TOKEN` in the project's root `.env`, following `.env.example`. `control.py` loads that file without printing credentials. Install `kaggle` and `python-dotenv` in your Python environment.

```bash
python train/kaggle/control.py auth-check
python train/kaggle/control.py prepare --model /path/to/hydra-nano-git-Q8_0.gguf
python train/kaggle/control.py upload
```

Preparation writes a frozen source bundle, hash plan, GGUF and private dataset/kernel metadata under `~/.hydra/kaggle`. Upload creates private input data and consumes no GPU run. Kaggle expands ZIP resources; the kernel handles either the original ZIP or its expanded `frozen` directory, verifying every source hash.

Before a GPU run, give the user the kernel name, T4 accelerator and maximum 30-minute runtime and obtain explicit approval. Then:

```bash
python train/kaggle/control.py run --approved
python train/kaggle/control.py status
python train/kaggle/control.py logs
python train/kaggle/control.py output
```

The kernel downloads hash-pinned CUDA binaries and a pinned Node fallback if needed. It verifies GPU memory allocation and model/source hashes, runs the unchanged 1,000-task `git1` evaluator, rechecks sources and terminates the server. It never trains or changes a prompt. Read aggregate accuracy for reporting; sealed failure rows must not drive training or prompt changes.

Downloaded reports go to `evals/results/kaggle-q8`. Download filtering excludes runtime binaries. Preserve prior attempt artifacts before downloading a later attempt. `--approved` documents caller authorization; it is not a substitute for the user's approval.
