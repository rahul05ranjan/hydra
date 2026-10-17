# Tool-calling training mix

Built by `train/build_toolcall_data.py`; counts, hashes and filters are in `manifest.json`.

- Questions with no fitting function come from [MadeAgents/xlam-irrelevance-7.5k](https://huggingface.co/datasets/MadeAgents/xlam-irrelevance-7.5k) (CC-BY-4.0). Their replies were written by base Qwen3.5-0.8B and kept only when they make no call.
- Questions that need calls come from [NousResearch/hermes-function-calling-v1](https://huggingface.co/datasets/NousResearch/hermes-function-calling-v1), `func-calling-singleturn` (Apache-2.0).
- Hydra Git examples are replayed from `train/data-balanced-git`.

Any example sharing a question, an 8-word run of a question, or a function name with BFCL v4 was dropped.
