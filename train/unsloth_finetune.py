"""Supervised fine-tune with Unsloth under the same contracts as full_finetune.py: hash-checked
checkpoint and data, the same seeded batch sampling, assistant-only loss, the checkpoint's own
tokenizer and chat template, and a standalone checkpoint with the starting tensor names and shapes.
--method full trains every parameter (FP32 weights, CPU AdamW, FP16 autocast, like full_finetune.py);
--method lora trains FP32 adapters on an FP16 base and merges them. Preflight never imports Unsloth."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import random
import shutil
import struct
import time

from full_finetune import CpuAdamW, digest, encode_example, load_examples, verify_checkpoint

# The 6 full-attention layers, the MLP, and the 18 linear-attention layers' large projections.
LORA_TARGETS = ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj',
                'in_proj_qkv', 'in_proj_z', 'out_proj']
TOKENIZER_ASSETS = ('tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja')


def tensor_layout(directory):
    """Tensor name -> [dtype, shape] across every safetensors shard, read from the headers only."""
    layout = {}
    for file in sorted(Path(directory).glob('*.safetensors')):
        with file.open('rb') as stream:
            header = json.loads(stream.read(struct.unpack('<Q', stream.read(8))[0]))
        header.pop('__metadata__', None)
        layout.update({name: [spec['dtype'], spec['shape']] for name, spec in header.items()})
    return layout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--method', choices=['full', 'lora'], required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--checkpoint-manifest', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--data-manifest', type=Path, required=True)
    parser.add_argument('--head', required=True, help="One head, or several joined by commas (git, files, read, test, os, toolcall)")
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--approved', action='store_true', help='Only after a concrete runtime/budget notice and clear yes')
    parser.add_argument('--max-seconds', type=int, default=600)
    parser.add_argument('--steps', type=int, default=10)
    parser.add_argument('--max-length', type=int, default=2048)
    parser.add_argument('--accumulation', type=int, default=4)
    parser.add_argument('--learning-rate', type=float, default=1e-5)
    parser.add_argument('--initial-scale', type=float, default=65536)
    parser.add_argument('--sample-seed', type=int, default=1729)
    parser.add_argument('--lora-rank', type=int, default=16)
    parser.add_argument('--lora-alpha', type=int, default=16)
    args = parser.parse_args()
    if not args.preflight and not args.approved:
        parser.error('Training needs explicit approval, checkpoint/data hashes and a bounded GPU run notice')
    if min(args.max_seconds, args.steps, args.max_length, args.accumulation, args.lora_rank, args.lora_alpha) <= 0 or args.learning_rate <= 0:
        parser.error('Training limits must be positive')
    if not math.isfinite(args.initial_scale) or args.initial_scale <= 0:
        parser.error('Initial gradient scale must be finite and positive')
    if not args.head or not set(args.head.split(',')) <= {'git', 'files', 'read', 'test', 'os', 'toolcall'}:
        parser.error('Heads must come from git, files, read, test, os and toolcall')
    started = time.monotonic()
    checkpoint_spec = verify_checkpoint(args.checkpoint, args.checkpoint_manifest)
    rows, data_spec = load_examples(args.data, args.data_manifest, args.head)
    if not args.preflight:
        import unsloth  # noqa: F401  Unsloth patches transformers only when imported first
    from transformers import AutoTokenizer
    # Preserve the hash-pinned tokenizer regex; no automatic Mistral patch on Qwen exports.
    tokenizer = AutoTokenizer.from_pretrained(args.checkpoint, local_files_only=True, fix_mistral_regex=False)
    examples = [encode_example(tokenizer, row['messages'], args.max_length, row.get('tools'), row.get('head')) for row in rows]
    receipt = {'timestamp': datetime.now(timezone.utc).isoformat(), 'head': args.head,
        'method': f'unsloth-{args.method}', 'trainingStarted': False,
        'checkpointManifest': checkpoint_spec, 'dataManifest': data_spec,
        'examples': len(examples), 'maximumTokens': max(len(row['input_ids']) for row in examples),
        'chatEOS': tokenizer.eos_token_id, 'stepsRequested': args.steps,
        'maxSeconds': args.max_seconds, 'accumulation': args.accumulation,
        'learningRate': args.learning_rate, 'lossMethod': 'unsloth-labels-mean',
        'optimizer': 'cpu-adamw-fp32' if args.method == 'full' else 'adamw-fp32-adapters',
        'initialGradientScale': args.initial_scale,
        'maximumSupervisedTokens': max(sum(v != -100 for v in row['labels'][1:]) for row in examples)}
    if args.method == 'lora':
        receipt['lora'] = {'rank': args.lora_rank, 'alpha': args.lora_alpha, 'dropout': 0, 'targets': LORA_TARGETS}
    if args.preflight:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'preflight.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
        return
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Use a new output directory; do not overwrite a previous checkpoint')
    import importlib.metadata
    import torch
    from unsloth import FastLanguageModel
    if not torch.cuda.is_available():
        raise RuntimeError('Training requires CUDA; refusing CPU fallback')
    random.seed(args.sample_seed)
    torch.manual_seed(args.sample_seed)
    full = args.method == 'full'
    model, _ = FastLanguageModel.from_pretrained(model_name=str(args.checkpoint), max_seq_length=args.max_length,
        dtype=torch.float32 if full else torch.float16, load_in_4bit=False, load_in_8bit=False,
        full_finetuning=full, local_files_only=True)
    if full:
        model.gradient_checkpointing_enable()
        for parameter in model.parameters():
            parameter.requires_grad_(True)
    else:
        model = FastLanguageModel.get_peft_model(model, r=args.lora_rank, lora_alpha=args.lora_alpha,
            lora_dropout=0, bias='none', target_modules=LORA_TARGETS,
            use_gradient_checkpointing='unsloth', random_state=args.sample_seed)
    model.config.use_cache = False
    model.train()
    total = sum(p.numel() for p in model.parameters())
    trainable = [p for p in model.parameters() if p.requires_grad]
    if full and sum(p.numel() for p in trainable) != total:
        raise RuntimeError('Expected every text backbone parameter to train')
    if any(p.dtype != torch.float32 for p in trainable):
        raise RuntimeError('Trainable parameters must be FP32 for FP16 loss scaling')
    if full:
        optimizer = CpuAdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
        unscale_target = optimizer.gradient_optimizer
    else:
        optimizer = torch.optim.AdamW(trainable, lr=args.learning_rate, weight_decay=0.01)
        unscale_target = optimizer
    scaler = torch.amp.GradScaler('cuda', init_scale=args.initial_scale)
    optimizer.zero_grad(set_to_none=True)
    args.output.mkdir(parents=True, exist_ok=True)
    receipt.update(trainingStarted=True, totalParameters=total, trainableParameters=sum(p.numel() for p in trainable),
        sampleSeed=args.sample_seed, gpu=torch.cuda.get_device_name(0),
        versions={name: importlib.metadata.version(name) for name in ('unsloth', 'unsloth_zoo', 'transformers', 'torch', 'peft')},
        losses=[], completedSteps=0, overflowStepsSkipped=0, gradientScaleHistory=[])
    deadline = started + args.max_seconds
    training_begin = time.monotonic()
    try:
        for step in range(args.steps):
            # Reserve time for merging and a standalone save; the Kaggle parent enforces the hard cap.
            if time.monotonic() >= deadline - 180:
                receipt['stoppedForDeadline'] = True
                break
            batch = [random.choice(examples) for _ in range(args.accumulation)]
            for attempt in range(8):
                if time.monotonic() >= deadline - 180:
                    raise TimeoutError('Overflow recovery exhausted the reserved training time')
                optimizer.zero_grad(set_to_none=True)
                total_loss = 0.0
                for row in batch:
                    ids = torch.tensor([row['input_ids']], device='cuda')
                    labels = torch.tensor([row['labels']], device='cuda')
                    with torch.autocast('cuda', dtype=torch.float16):
                        loss = model(input_ids=ids, labels=labels, use_cache=False).loss
                    if not torch.isfinite(loss):
                        raise RuntimeError('Non-finite forward loss; loss scaling cannot repair it')
                    total_loss += float(loss.detach())
                    scaler.scale(loss / args.accumulation).backward()
                scaler.unscale_(unscale_target)
                norm = torch.nn.utils.clip_grad_norm_(trainable, 1.0)
                scale = scaler.get_scale()
                receipt['gradientScaleHistory'].append({'step': step, 'attempt': attempt, 'scale': scale,
                    'norm': float(norm) if torch.isfinite(norm) else 'non-finite'})
                if not torch.isfinite(norm):
                    # Overflow never updates weights. Retry the SAME batch at half scale.
                    receipt['overflowStepsSkipped'] += 1
                    scaler.update(new_scale=scale * scaler.get_backoff_factor())
                    continue
                if full:
                    optimizer.step()
                else:
                    scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                break
            else:
                raise RuntimeError('Persistent non-finite gradients after bounded scale recovery')
            receipt['completedSteps'] += 1
            receipt['losses'].append(total_loss / args.accumulation)
            print(json.dumps({'completedSteps': receipt['completedSteps'], 'loss': receipt['losses'][-1],
                'scale': scaler.get_scale(), 'peakMemoryBytes': torch.cuda.max_memory_allocated()}), flush=True)
        receipt['trainingSeconds'] = time.monotonic() - training_begin
        receipt['peakMemoryBytes'] = torch.cuda.max_memory_allocated()
        if not receipt['completedSteps']:
            raise RuntimeError('No optimization step completed')
        if not full:
            model.save_pretrained(args.output / 'adapter')
            model = model.merge_and_unload()
        # Complete standalone text weights. No publication/default switch.
        model.to('cpu', dtype=torch.float16)
        model.save_pretrained(args.output, safe_serialization=True)
        # Byte-identical tokenizer and chat template, so the candidate prompts exactly like the start.
        for name in TOKENIZER_ASSETS:
            if (args.checkpoint / name).exists():
                shutil.copyfile(args.checkpoint / name, args.output / name)
        if tensor_layout(args.output) != tensor_layout(args.checkpoint):
            raise RuntimeError('Saved tensors differ from the starting checkpoint in names, dtypes or shapes')
        receipt['weights'] = {file.name: digest(file) for file in args.output.glob('*.safetensors')}
        receipt['checkpointSaved'] = True
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        receipt['peakMemoryBytes'] = torch.cuda.max_memory_allocated()
        receipt['elapsedSeconds'] = time.monotonic() - started
        (args.output / 'training-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
