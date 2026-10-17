# Tool-calling training mix, second version

Built by `train/build_toolcall_data_v2.py`; counts, hashes and filters are in `manifest.json`. It replaces `train/data-toolcall`, whose candidate declined even when a function fitted and took up the base model's markdown style.

- Declines: the 440 short, plain declines (at most 300 characters, no markdown) from `train/data-toolcall`, originally [MadeAgents/xlam-irrelevance-7.5k](https://huggingface.co/datasets/MadeAgents/xlam-irrelevance-7.5k) (CC-BY-4.0) with replies by base Qwen3.5-0.8B.
- Calls: all 1,036 calls from `train/data-toolcall`, originally [NousResearch/hermes-function-calling-v1](https://huggingface.co/datasets/NousResearch/hermes-function-calling-v1) `func-calling-singleturn` (Apache-2.0).
- Chat: 723 English first questions from [OpenAssistant/oasst1](https://huggingface.co/datasets/OpenAssistant/oasst1) (Apache-2.0), answered by Hydra Nano v2 itself, so the target is v2's own reply.
- Git: 1,200 rows of `train/data-balanced-git` that v2 already answers exactly.

Any question sharing a question, an 8-word run or a function name with BFCL v4 was dropped, and chat questions overlapping IFEval or GSM8K (train and test) were dropped too.
