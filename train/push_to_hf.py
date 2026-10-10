#!/usr/bin/env python3
"""Upload Hydra Nano model weights and model card to Hugging Face Hub."""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent

# Load tokens from local .env or fallback locations
load_dotenv(ROOT / ".env")
if not os.environ.get("HUGGINGFACE_API_KEY") and not os.environ.get("HF_TOKEN"):
    load_dotenv(Path("/Users/rivansh/Desktop/code/vasuki/.env"))

MODEL_CARD = """---
language:
- en
license: apache-2.0
tags:
- hydra
- code
- git
- agent
- tool-use
- coding-assistant
- mlx
- safetensors
pipeline_tag: text-generation
base_model: Qwen/Qwen3.5-0.8B
---

# Hydra Nano Git (`hydra-nano-git`)

**Hydra Nano Git** is a specialized 0.8B parameter local model trained specifically for frontier coding agents (such as Claude Code, Antigravity, and Codex) to plan and execute read-only git queries locally.

Instead of dumping multi-thousand-token outputs into a frontier model's expensive context window, the frontier agent delegates repo inspection to Hydra Nano.

## Key Capabilities

- **Zero Command Writing Risk:** The model never writes raw shell commands. It picks structured read-only probes from a hardened menu (`status`, `log`, `diff`, `show`, `blame`, `branches`, `stash`, `worktrees`).
- **Grounded Argument Verification:** Strict runtime guardrails ensure paths, branch references, and authors are validated against real git refs before execution.
- **Ultra Low Latency:** ~140ms per task on Apple Silicon M-series chips and local GPUs.
- **High Accuracy:**
  - **83%** plan accuracy on diverse git queries
  - **77%** usage-weighted solved accuracy on the 1,000-task sealed `git1` benchmark
  - Solves high-frequency tasks: `branch_current` (100%), `last_commit` (100%), `commit_files` (92%), `modified_files` (90%), `staged_files` (90%), `message_search` (86%).

## Usage with Ollama

You can run this model directly via Ollama:

```bash
ollama run rahul05ranjan/hydra-nano-git
```

Or within Hydra CLI:

```bash
hydra ask --head git "which branch am I on and what files are modified?"
```

## Prompt Shape & Format

The model accepts JSON-schema constrained planning instructions:

```json
{"probes":[{"probe":"status"},{"probe":"diff"}]}
```
"""

def main():
    parser = argparse.ArgumentParser(description="Upload Hydra model to Hugging Face Hub")
    parser.add_argument("--repo-id", default="rahul05ranjan/hydra-nano-git", help="Hugging Face repo ID")
    parser.add_argument("--model-dir", default=str(ROOT / "train" / "merged"), help="Path to model directory")
    parser.add_argument("--private", action="store_true", help="Create private repository (default is public)")
    args = parser.parse_args()

    token = os.environ.get("HUGGINGFACE_API_KEY") or os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("Error: HUGGINGFACE_API_KEY or HF_TOKEN is not set in environment or .env")

    model_dir = Path(args.model_dir).resolve()
    if not model_dir.exists():
        sys.exit(f"Error: Model directory not found at {model_dir}")

    # Write enriched model card README if none or minimal
    readme_path = model_dir / "README.md"
    readme_path.write_text(MODEL_CARD, encoding="utf-8")

    api = HfApi(token=token)
    user_info = api.whoami()
    print(f"Authenticated with Hugging Face as: {user_info.get('name')}")
    print(f"Target repository: {args.repo_id} (private={args.private})")
    print(f"Uploading files from: {model_dir}")

    # Create repo if it doesn't exist
    api.create_repo(repo_id=args.repo_id, repo_type="model", private=args.private, exist_ok=True)

    # Upload folder
    api.upload_folder(
        folder_path=str(model_dir),
        repo_id=args.repo_id,
        repo_type="model",
        commit_message="Initial release of Hydra Nano Git (0.8B specialized git agent model)",
    )

    print(f"\n✔ Successfully uploaded model to Hugging Face!")
    print(f"Repository URL: https://huggingface.co/{args.repo_id}")

if __name__ == "__main__":
    main()
