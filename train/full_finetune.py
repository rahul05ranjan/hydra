"""Full parameter SFT of a local, standard-HF text checkpoint. Preflight never trains."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import random
import time


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def validate_target(head, messages):
    target = json.loads(messages[-1]['content'])
    if not isinstance(target, dict) or len(target) != 1:
        raise ValueError('Require exactly one Hydra output contract')
    if set(target) == {'lines'}:
        if not isinstance(target['lines'], list) or len(target['lines']) > 12 or any(type(v) is not int or v < 1 for v in target['lines']):
            raise ValueError('Invalid evidence line IDs')
        return
    if head == 'files' and set(target) == {'terms'}:
        if not isinstance(target['terms'], list) or not 1 <= len(target['terms']) <= 5 or any(not isinstance(v, str) or not v or len(v) > 60 or '\n' in v for v in target['terms']):
            raise ValueError('Invalid literal search terms')
        return
    menus = {'git': {'status', 'log', 'diff', 'show', 'blame', 'branches', 'remotes', 'stash', 'tags', 'worktrees'},
             'os': {'ports', 'processes', 'disk', 'memory', 'system', 'env'}}
    allowed = {'git': {'probe', 'n', 'path', 'rev', 'base', 'author', 'grep', 'staged'},
               'os': {'probe', 'name', 'var'}}
    if head not in menus or set(target) != {'probes'} or not isinstance(target['probes'], list) or not 1 <= len(target['probes']) <= 3:
        raise ValueError('Target does not match the head fixed menu')
    for probe in target['probes']:
        if not isinstance(probe, dict) or probe.get('probe') not in menus[head] or not set(probe).issubset(allowed[head]):
            raise ValueError('Unknown probe or arbitrary command field in training target')


def encode_example(tokenizer, messages, maximum):
    if [m.get('role') for m in messages] != ['system', 'user', 'assistant']:
        raise ValueError('Require exactly system/user/assistant messages')
    # Hydra trains constrained choices/evidence IDs, never shell command strings.
    target = json.loads(messages[-1]['content'])
    if not isinstance(target, dict) or set(target) not in ({'probes'}, {'terms'}, {'lines'}):
        raise ValueError('Assistant target must use one fixed Hydra JSON contract')
    prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=True,
        add_generation_prompt=True, enable_thinking=False, return_dict=False)
    full = tokenizer.apply_chat_template(messages, tokenize=True,
        add_generation_prompt=False, enable_thinking=False, return_dict=False)
    if full[:len(prompt)] != prompt:
        raise ValueError('Chat template training prefix differs from inference prefix')
    if len(full) > maximum:
        raise ValueError(f'Example has {len(full)} tokens; refusing silent target/prompt truncation')
    if not full[len(prompt):] or tokenizer.eos_token_id not in full[len(prompt):]:
        raise ValueError('Assistant target must include the tokenizer chat EOS')
    return {'input_ids': full, 'labels': [-100] * len(prompt) + full[len(prompt):]}


def load_examples(data, manifest, head):
    spec = json.loads(manifest.read_text(encoding='utf-8'))
    if spec.get('sealedInputsUsed') is not False:
        raise ValueError('Require explicit disjoint-data provenance')
    if spec.get('dataSha256') != digest(data):
        raise ValueError('Training data differs from provenance manifest')
    seeds = spec.get('worldSeeds')
    if not isinstance(seeds, list) or not seeds or any(not isinstance(s, int) or 4100 <= s <= 4149 or 6100 <= s <= 6109 or 6200 <= s <= 6239 for s in seeds):
        raise ValueError('Require training seeds disjoint from sealed and current development worlds')
    rows = [json.loads(line) for line in data.read_text(encoding='utf-8').splitlines() if line.strip()]
    selected = [row for row in rows if row.get('head') == head]
    if not selected:
        raise ValueError(f'No training examples declared for {head}')
    for row in selected:
        validate_target(head, row['messages'])
    return selected, spec


def assistant_loss(model, input_ids, labels):
    """Keep the full causal context, projecting only positions with a loss target.

    The trainer has one sequence per microbatch. Label t is predicted by hidden
    state t-1, including the first assistant token and chat EOS. Dropping ignored
    positions before lm_head avoids prompt-length vocabulary tensors without
    changing the mean assistant-only objective or its parameter gradients.
    """
    import torch
    if input_ids.ndim != 2 or input_ids.shape[0] != 1 or labels.shape != input_ids.shape:
        raise ValueError('Assistant loss requires a single sequence with matching labels')
    shifted = labels[0, 1:]
    positions = torch.nonzero(shifted != -100, as_tuple=True)[0]
    if positions.numel() == 0:
        raise ValueError('Assistant loss requires at least one supervised next token')
    logits = model(input_ids=input_ids, logits_to_keep=positions,
        use_cache=False, return_dict=True).logits
    if logits.shape[:2] != (1, positions.numel()):
        raise ValueError('Model did not honor selected loss positions')
    # Match Transformers ForCausalLMLoss's FP32 cross-entropy and mean reduction.
    return torch.nn.functional.cross_entropy(logits[0].float(), shifted[positions])


class CpuAdamW:
    """Full AdamW updates with FP32 optimizer weights and moments on the CPU.

    CUDA parameters retain their autograd gradients through unscale/clipping.
    Each gradient is then copied to CPU and released before the AdamW update;
    updated weights are copied back to the same model parameters in place.
    """

    def __init__(self, parameters, lr, weight_decay):
        import torch
        self.model_parameters = list(parameters)
        self.cpu_parameters = [torch.nn.Parameter(p.detach().to('cpu', copy=True))
            for p in self.model_parameters]
        self.gradient_optimizer = torch.optim.SGD(self.model_parameters, lr=0, foreach=False)
        self.optimizer = torch.optim.AdamW(self.cpu_parameters, lr=lr,
            weight_decay=weight_decay, foreach=False)

    def zero_grad(self, set_to_none=True):
        self.gradient_optimizer.zero_grad(set_to_none=set_to_none)
        self.optimizer.zero_grad(set_to_none=set_to_none)

    def step(self):
        import torch
        for model_parameter, cpu_parameter in zip(self.model_parameters, self.cpu_parameters):
            cpu_parameter.grad = (model_parameter.grad.detach().to('cpu', copy=True)
                if model_parameter.grad is not None else None)
            model_parameter.grad = None
        self.optimizer.step()
        with torch.no_grad():
            for model_parameter, cpu_parameter in zip(self.model_parameters, self.cpu_parameters):
                model_parameter.copy_(cpu_parameter)
        self.optimizer.zero_grad(set_to_none=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--checkpoint-manifest', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--data-manifest', type=Path, required=True)
    parser.add_argument('--head', choices=['git', 'files', 'read', 'test', 'os'], required=True)
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
    args = parser.parse_args()
    if not args.preflight and not args.approved:
        parser.error('Full training needs explicit approval, checkpoint/data hashes and a bounded GPU run notice')
    if min(args.max_seconds, args.steps, args.max_length, args.accumulation) <= 0 or args.learning_rate <= 0:
        parser.error('Training limits must be positive')
    if not math.isfinite(args.initial_scale) or args.initial_scale <= 0:
        parser.error('Initial gradient scale must be finite and positive')
    started = time.monotonic()
    config = json.loads((args.checkpoint / 'config.json').read_text())
    if 'text_config' in config:
        raise ValueError('Normalize to a verified standard-HF text checkpoint before full training')
    checkpoint_spec = json.loads(args.checkpoint_manifest.read_text())
    declared = checkpoint_spec.get('files', {})
    actual_weights = {file.name for file in args.checkpoint.glob('*.safetensors')}
    required_assets = {'config.json', 'tokenizer.json', 'tokenizer_config.json'}
    if (args.checkpoint / 'chat_template.jinja').exists():
        required_assets.add('chat_template.jinja')
    if not actual_weights or not (actual_weights | required_assets).issubset(declared):
        raise ValueError('Checkpoint manifest must cover every weight shard, config and tokenizer/chat assets')
    for name, sha in declared.items():
        target = (args.checkpoint / name).resolve()
        if not target.is_relative_to(args.checkpoint.resolve()) or digest(target) != sha:
            raise ValueError(f'Checkpoint provenance mismatch: {name}')
    rows, data_spec = load_examples(args.data, args.data_manifest, args.head)
    from transformers import AutoTokenizer
    # Preserve the hash-pinned tokenizer regex; no automatic Mistral patch on Qwen exports.
    tokenizer = AutoTokenizer.from_pretrained(args.checkpoint, local_files_only=True, fix_mistral_regex=False)
    examples = [encode_example(tokenizer, row['messages'], args.max_length) for row in rows]
    receipt = {'timestamp': datetime.now(timezone.utc).isoformat(), 'head': args.head,
        'method': 'full-parameter-supervised-fine-tuning', 'trainingStarted': False,
        'checkpointManifest': checkpoint_spec, 'dataManifest': data_spec,
        'examples': len(examples), 'maximumTokens': max(len(row['input_ids']) for row in examples),
        'chatEOS': tokenizer.eos_token_id, 'stepsRequested': args.steps,
        'maxSeconds': args.max_seconds, 'accumulation': args.accumulation,
        'learningRate': args.learning_rate, 'lossMethod': 'assistant-selected-logits',
        'optimizer': 'cpu-adamw-fp32',
        'initialGradientScale': args.initial_scale,
        'maximumSupervisedTokens': max(sum(v != -100 for v in row['labels'][1:]) for row in examples)}
    if args.preflight:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'preflight.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt, indent=2))
        return
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Use a new output directory; do not overwrite a previous checkpoint')
    import torch
    from transformers import AutoModelForCausalLM
    if not torch.cuda.is_available():
        raise RuntimeError('Full training requires CUDA; refusing CPU fallback')
    random.seed(args.sample_seed)
    torch.manual_seed(args.sample_seed)
    model, loading_info = AutoModelForCausalLM.from_pretrained(args.checkpoint, local_files_only=True,
        dtype=torch.float32, attn_implementation='sdpa', output_loading_info=True)
    if loading_info.get('missing_keys') or loading_info.get('unexpected_keys') or loading_info.get('mismatched_keys'):
        raise RuntimeError('Checkpoint loading is incomplete; refusing to train randomly initialized/mismapped weights')
    model = model.to('cuda')
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.train()
    for parameter in model.parameters():
        parameter.requires_grad_(True)
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    if total != trainable:
        raise RuntimeError('Expected every text backbone parameter to train')
    # Keep all text parameters trainable on CUDA, with FP32 AdamW states on CPU.
    optimizer = CpuAdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
    scaler = torch.amp.GradScaler('cuda', init_scale=args.initial_scale)
    optimizer.zero_grad(set_to_none=True)
    args.output.mkdir(parents=True, exist_ok=True)
    receipt.update(trainingStarted=True, totalParameters=total, trainableParameters=trainable,
        sampleSeed=args.sample_seed,
        gpu=torch.cuda.get_device_name(0), losses=[], completedSteps=0, overflowStepsSkipped=0,
        gradientScaleHistory=[])
    deadline = started + args.max_seconds
    training_begin = time.monotonic()
    try:
        for step in range(args.steps):
            # Reserve time for a standalone save; the Kaggle parent enforces the hard cap.
            if time.monotonic() >= deadline - 90:
                receipt['stoppedForDeadline'] = True
                break
            batch = [random.choice(examples) for _ in range(args.accumulation)]
            for attempt in range(8):
                if time.monotonic() >= deadline - 90:
                    raise TimeoutError('Overflow recovery exhausted the reserved training time')
                optimizer.zero_grad(set_to_none=True)
                total_loss = 0.0
                for row in batch:
                    ids = torch.tensor([row['input_ids']], device='cuda')
                    labels = torch.tensor([row['labels']], device='cuda')
                    with torch.autocast('cuda', dtype=torch.float16):
                        loss = assistant_loss(model, ids, labels)
                    if not torch.isfinite(loss):
                        raise RuntimeError('Non-finite forward loss; loss scaling cannot repair it')
                    total_loss += float(loss.detach())
                    scaler.scale(loss / args.accumulation).backward()
                scaler.unscale_(optimizer.gradient_optimizer)
                norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scale = scaler.get_scale()
                receipt['gradientScaleHistory'].append({'step': step, 'attempt': attempt, 'scale': scale,
                    'norm': float(norm) if torch.isfinite(norm) else 'non-finite'})
                if not torch.isfinite(norm):
                    # Overflow never updates weights. Retry the SAME batch at half
                    # scale, isolating scaling from the data and model variables.
                    receipt['overflowStepsSkipped'] += 1
                    scaler.update(new_scale=scale * scaler.get_backoff_factor())
                    print(json.dumps({'overflowSkipped': receipt['overflowStepsSkipped'],
                        'nextScale': scaler.get_scale(), 'peakMemoryBytes': torch.cuda.max_memory_allocated()}), flush=True)
                    continue
                optimizer.step()
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
            raise RuntimeError('No full-parameter optimization step completed')
        # Complete standalone text weights, not an adapter. No publication/default switch.
        model.to('cpu', dtype=torch.float16)
        model.save_pretrained(args.output, safe_serialization=True)
        tokenizer.save_pretrained(args.output)
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
