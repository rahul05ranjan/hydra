"""SFT of a local, standard-HF text checkpoint: every parameter (--method full) or low-rank adapters
merged back into the weights (--method lora). Preflight never trains."""
import argparse
from datetime import datetime, timezone
import gc
import hashlib
import json
import math
from pathlib import Path
import random
import re
import time


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def host_memory(proc=Path('/proc')):
    """Host RAM on Linux: this process's resident set and what the kernel can still hand out.
    Empty where /proc does not say (macOS, Windows)."""
    memory = {}
    for file, key, name in ((proc / 'self' / 'status', 'VmRSS', 'hostRssBytes'),
                            (proc / 'meminfo', 'MemAvailable', 'hostAvailableBytes')):
        try:
            match = re.search(rf'^{key}:\s+(\d+) kB$', file.read_text(), re.MULTILINE)
        except OSError:
            return {}
        if not match:
            return {}
        memory[name] = int(match.group(1)) * 1024
    return memory


def release_host_memory(load=None):
    """Hand freed heap pages back to the OS with glibc's malloc_trim. Host RSS grew about 54-96 MB per
    update even with reused buffers, which looks like fragmentation. False where there is no glibc."""
    import ctypes
    try:
        libc = (load or ctypes.CDLL)('libc.so.6')
        return bool(libc.malloc_trim(0))
    except (OSError, AttributeError):
        return False


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


def validate_toolcall(row):
    """General tool calling: a call names an offered function with only its declared parameters;
    a reply without a call is plain text. Hydra's CLI never runs these calls; they teach the model
    when to call and when to decline."""
    messages, tools = row.get('messages'), row.get('tools')
    if [m.get('role') for m in messages or []] != ['user', 'assistant'] or not isinstance(tools, list) or not tools:
        raise ValueError('Tool rows need offered tools and exactly user/assistant messages')
    offered = {t['function']['name']: set((t['function'].get('parameters') or {}).get('properties') or {}) for t in tools}
    reply = messages[-1]
    calls = reply.get('tool_calls')
    if calls is None:
        text = reply.get('content')
        if not isinstance(text, str) or not text.strip() or '<tool_call>' in text or '<function=' in text:
            raise ValueError('A reply without a call must be plain text')
        return
    if not isinstance(calls, list) or not 1 <= len(calls) <= 8 or reply.get('content'):
        raise ValueError('A call reply holds one to eight calls and no text')
    for item in calls:
        function = item.get('function', item)
        if function.get('name') not in offered:
            raise ValueError('A call must name an offered function')
        if not isinstance(function.get('arguments'), dict) or not set(function['arguments']) <= offered[function['name']]:
            raise ValueError("A call may pass only the function's declared parameters")


def validate_chat(row):
    """General replay: one plain-text reply, offered no tools. The reply is the starting checkpoint's own,
    so these rows hold its general style in place while other rows change what it does with tools."""
    messages = row.get('messages')
    if [m.get('role') for m in messages or []] != ['user', 'assistant'] or row.get('tools'):
        raise ValueError('Chat rows need exactly user/assistant messages and no tools')
    text = messages[-1].get('content')
    if not isinstance(text, str) or not text.strip() or '<tool_call>' in text or '<function=' in text:
        raise ValueError('A chat reply must be plain text')


def validate_row(row):
    if row.get('head') == 'toolcall':
        validate_toolcall(row)
    elif row.get('head') == 'chat':
        validate_chat(row)
    else:
        validate_target(row.get('head'), row['messages'])


def encode_example(tokenizer, messages, maximum, tools=None, head=None):
    if head == 'chat':
        validate_chat({'messages': messages, 'tools': tools})
    elif tools is None:
        if [m.get('role') for m in messages] != ['system', 'user', 'assistant']:
            raise ValueError('Require exactly system/user/assistant messages')
        # Hydra trains constrained choices/evidence IDs, never shell command strings.
        target = json.loads(messages[-1]['content'])
        if not isinstance(target, dict) or set(target) not in ({'probes'}, {'terms'}, {'lines'}):
            raise ValueError('Assistant target must use one fixed Hydra JSON contract')
    else:
        validate_toolcall({'messages': messages, 'tools': tools})
    prompt = tokenizer.apply_chat_template(messages[:-1], tools=tools, tokenize=True,
        add_generation_prompt=True, enable_thinking=False, return_dict=False)
    full = tokenizer.apply_chat_template(messages, tools=tools, tokenize=True,
        add_generation_prompt=False, enable_thinking=False, return_dict=False)
    if full[:len(prompt)] != prompt:
        raise ValueError('Chat template training prefix differs from inference prefix')
    if len(full) > maximum:
        raise ValueError(f'Example has {len(full)} tokens; refusing silent target/prompt truncation')
    if not full[len(prompt):] or tokenizer.eos_token_id not in full[len(prompt):]:
        raise ValueError('Assistant target must include the tokenizer chat EOS')
    return {'input_ids': full, 'labels': [-100] * len(prompt) + full[len(prompt):]}


def load_examples(data, manifest, heads):
    spec = json.loads(manifest.read_text(encoding='utf-8'))
    if spec.get('sealedInputsUsed') is not False:
        raise ValueError('Require explicit disjoint-data provenance')
    if spec.get('dataSha256') != digest(data):
        raise ValueError('Training data differs from provenance manifest')
    seeds = spec.get('worldSeeds')
    if not isinstance(seeds, list) or not seeds or any(not isinstance(s, int) or 4100 <= s <= 4149 or 6100 <= s <= 6109 or 6200 <= s <= 6239 for s in seeds):
        raise ValueError('Require training seeds disjoint from sealed and current development worlds')
    rows = [json.loads(line) for line in data.read_text(encoding='utf-8').splitlines() if line.strip()]
    heads = heads.split(',') if isinstance(heads, str) else heads
    selected = [row for row in rows if row.get('head') in heads]
    for head in heads:
        if not any(row.get('head') == head for row in selected):
            raise ValueError(f'No training examples declared for {head}')
    for row in selected:
        validate_row(row)
    return selected, spec


def verify_checkpoint(checkpoint, manifest):
    config = json.loads((checkpoint / 'config.json').read_text())
    if 'text_config' in config:
        raise ValueError('Normalize to a verified standard-HF text checkpoint before full training')
    checkpoint_spec = json.loads(manifest.read_text())
    declared = checkpoint_spec.get('files', {})
    actual_weights = {file.name for file in checkpoint.glob('*.safetensors')}
    required_assets = {'config.json', 'tokenizer.json', 'tokenizer_config.json'}
    if (checkpoint / 'chat_template.jinja').exists():
        required_assets.add('chat_template.jinja')
    if not actual_weights or not (actual_weights | required_assets).issubset(declared):
        raise ValueError('Checkpoint manifest must cover every weight shard, config and tokenizer/chat assets')
    for name, sha in declared.items():
        target = (checkpoint / name).resolve()
        if not target.is_relative_to(checkpoint.resolve()) or digest(target) != sha:
            raise ValueError(f'Checkpoint provenance mismatch: {name}')
    return checkpoint_spec


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
    The CPU gradient buffers are allocated once: a fresh full-model copy every
    update churns gigabytes of host memory over a long run.
    """

    def __init__(self, parameters, lr, weight_decay):
        import torch
        self.model_parameters = list(parameters)
        self.cpu_parameters = [torch.nn.Parameter(p.detach().to('cpu', copy=True))
            for p in self.model_parameters]
        self.gradient_buffers = [torch.empty_like(p) for p in self.cpu_parameters]
        self.gradient_optimizer = torch.optim.SGD(self.model_parameters, lr=0, foreach=False)
        self.optimizer = torch.optim.AdamW(self.cpu_parameters, lr=lr,
            weight_decay=weight_decay, foreach=False)

    def zero_grad(self, set_to_none=True):
        self.gradient_optimizer.zero_grad(set_to_none=set_to_none)
        self.optimizer.zero_grad(set_to_none=set_to_none)

    def step(self):
        import torch
        for model_parameter, cpu_parameter, buffer in zip(self.model_parameters, self.cpu_parameters,
                                                          self.gradient_buffers):
            if model_parameter.grad is None:
                cpu_parameter.grad = None
                continue
            buffer.copy_(model_parameter.grad.detach())
            cpu_parameter.grad = buffer
            model_parameter.grad = None
        self.optimizer.step()
        with torch.no_grad():
            for model_parameter, cpu_parameter in zip(self.model_parameters, self.cpu_parameters):
                model_parameter.copy_(cpu_parameter)
        self.optimizer.zero_grad(set_to_none=True)


# The 6 full-attention layers, the MLP, and the 18 linear-attention layers' large projections.
LORA_TARGETS = ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj',
                'in_proj_qkv', 'in_proj_z', 'out_proj']


def _lora_linear():
    import torch

    class LoraLinear(torch.nn.Module):
        """A frozen Linear plus a trainable low-rank update B @ A, scaled by alpha / rank. B starts at
        zero, so a fresh adapter leaves the model's output exactly as it was."""

        def __init__(self, base, rank, alpha):
            super().__init__()
            self.base, self.scale = base, alpha / rank
            weight = base.weight
            self.lora_a = torch.nn.Parameter(torch.empty(rank, base.in_features, device=weight.device, dtype=torch.float32))
            self.lora_b = torch.nn.Parameter(torch.zeros(base.out_features, rank, device=weight.device, dtype=torch.float32))
            torch.nn.init.kaiming_uniform_(self.lora_a, a=math.sqrt(5))

        def forward(self, x):
            update = torch.nn.functional.linear(torch.nn.functional.linear(x, self.lora_a.to(x.dtype)), self.lora_b.to(x.dtype))
            return self.base(x) + update * self.scale

    return LoraLinear


_LORA_CLASS = None


def __getattr__(name):
    # LoraLinear needs torch, which preflight never imports; build the class on first use.
    global _LORA_CLASS
    if name == 'LoraLinear':
        _LORA_CLASS = _LORA_CLASS or _lora_linear()
        return _LORA_CLASS
    raise AttributeError(name)


def tensor_shapes(model):
    return {name: tuple(t.shape) for name, t in model.state_dict().items()}


def apply_lora(model, targets, rank, alpha):
    """Freeze every parameter and wrap each Linear whose name ends in a target. Returns the wrapped
    module names; a target that matches no Linear is refused rather than silently skipped."""
    import torch
    lora = __getattr__('LoraLinear')
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    chosen = [(name, module) for name, module in model.named_modules()
              if isinstance(module, torch.nn.Linear) and name.rsplit('.', 1)[-1] in targets]
    missing = set(targets) - {name.rsplit('.', 1)[-1] for name, _ in chosen}
    if missing:
        raise ValueError(f'LoRA targets match no layer: {sorted(missing)}')
    for name, module in chosen:
        parent_name, _, child = name.rpartition('.')
        setattr(model.get_submodule(parent_name) if parent_name else model, child, lora(module, rank, alpha))
    return [name for name, _ in chosen]


def merge_lora(model):
    """Fold each adapter into its base weight and put the plain Linear back. Returns the count."""
    import torch
    lora = __getattr__('LoraLinear')
    wrapped = [(name, module) for name, module in model.named_modules() if isinstance(module, lora)]
    with torch.no_grad():
        for name, module in wrapped:
            weight = module.base.weight
            weight.add_((module.lora_b.float() @ module.lora_a.float() * module.scale).to(weight.dtype))
            parent_name, _, child = name.rpartition('.')
            setattr(model.get_submodule(parent_name) if parent_name else model, child, module.base)
    return len(wrapped)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--method', choices=['full', 'lora'], default='full')
    parser.add_argument('--lora-rank', type=int, default=16)
    parser.add_argument('--lora-alpha', type=int, default=16)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--checkpoint-manifest', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--data-manifest', type=Path, required=True)
    parser.add_argument('--head', required=True, help="One head, or several joined by commas (git, files, read, test, os, toolcall, chat)")
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
    parser.add_argument('--min-host-available-gb', type=float, default=4.0,
        help='Stop and save before an update starts with less host RAM available than this (Linux only); '
             'the OOM killer ends a run without a checkpoint')
    args = parser.parse_args()
    if not args.preflight and not args.approved:
        parser.error('Full training needs explicit approval, checkpoint/data hashes and a bounded GPU run notice')
    if min(args.max_seconds, args.steps, args.max_length, args.accumulation, args.lora_rank, args.lora_alpha) <= 0 \
            or args.learning_rate <= 0 or args.min_host_available_gb < 0:
        parser.error('Training limits must be positive')
    if not math.isfinite(args.initial_scale) or args.initial_scale <= 0:
        parser.error('Initial gradient scale must be finite and positive')
    if not args.head or not set(args.head.split(',')) <= {'git', 'files', 'read', 'test', 'os', 'toolcall', 'chat'}:
        parser.error('Heads must come from git, files, read, test, os, toolcall and chat')
    started = time.monotonic()
    checkpoint_spec = verify_checkpoint(args.checkpoint, args.checkpoint_manifest)
    rows, data_spec = load_examples(args.data, args.data_manifest, args.head)
    from transformers import AutoTokenizer
    # Preserve the hash-pinned tokenizer regex; no automatic Mistral patch on Qwen exports.
    tokenizer = AutoTokenizer.from_pretrained(args.checkpoint, local_files_only=True, fix_mistral_regex=False)
    examples = [encode_example(tokenizer, row['messages'], args.max_length, row.get('tools'), row.get('head')) for row in rows]
    lora = args.method == 'lora'
    receipt = {'timestamp': datetime.now(timezone.utc).isoformat(), 'head': args.head,
        'method': 'lora-supervised-fine-tuning-merged' if lora else 'full-parameter-supervised-fine-tuning',
        'trainingStarted': False,
        'checkpointManifest': checkpoint_spec, 'dataManifest': data_spec,
        'examples': len(examples), 'maximumTokens': max(len(row['input_ids']) for row in examples),
        'chatEOS': tokenizer.eos_token_id, 'stepsRequested': args.steps,
        'maxSeconds': args.max_seconds, 'accumulation': args.accumulation,
        'learningRate': args.learning_rate, 'lossMethod': 'assistant-selected-logits',
        'optimizer': 'adamw-fp32-adapters' if lora else 'cpu-adamw-fp32',
        'initialGradientScale': args.initial_scale,
        **({'lora': {'rank': args.lora_rank, 'alpha': args.lora_alpha, 'targets': LORA_TARGETS}} if lora else {}),
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
    model.train()
    if lora:
        # The base is frozen, so reentrant checkpointing would see no input needing a gradient
        # and give the adapters none; the non-reentrant kind does not depend on that.
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
        layout = tensor_shapes(model)
        total = sum(p.numel() for p in model.parameters())
        wrapped = apply_lora(model, LORA_TARGETS, args.lora_rank, args.lora_alpha)
        trained = [p for p in model.parameters() if p.requires_grad]
        trainable = sum(p.numel() for p in trained)
        if not trainable or any(not n.endswith(('.lora_a', '.lora_b')) for n, p in model.named_parameters() if p.requires_grad):
            raise RuntimeError('Expected only LoRA adapters to train')
        # Adapters are about 1% of the model, so plain AdamW on the GPU holds their state.
        optimizer = torch.optim.AdamW(trained, lr=args.learning_rate, weight_decay=0.0, foreach=False)
        unscale_target = optimizer
        receipt['lora']['wrappedModules'] = len(wrapped)
    else:
        model.gradient_checkpointing_enable()
        for parameter in model.parameters():
            parameter.requires_grad_(True)
        trained = list(model.parameters())
        total = sum(p.numel() for p in model.parameters())
        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        if total != trainable:
            raise RuntimeError('Expected every text backbone parameter to train')
        # Keep all text parameters trainable on CUDA, with FP32 AdamW states on CPU.
        optimizer = CpuAdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
        unscale_target = optimizer.gradient_optimizer
    scaler = torch.amp.GradScaler('cuda', init_scale=args.initial_scale)
    optimizer.zero_grad(set_to_none=True)
    args.output.mkdir(parents=True, exist_ok=True)
    receipt.update(trainingStarted=True, totalParameters=total, trainableParameters=trainable,
        sampleSeed=args.sample_seed,
        gpu=torch.cuda.get_device_name(0), losses=[], completedSteps=0, overflowStepsSkipped=0,
        gradientScaleHistory=[], minHostAvailableGb=args.min_host_available_gb, hostMemory=[])
    deadline = started + args.max_seconds
    training_begin = time.monotonic()
    try:
        for step in range(args.steps):
            # Reserve time for a standalone save; the Kaggle parent enforces the hard cap.
            if time.monotonic() >= deadline - 90:
                receipt['stoppedForDeadline'] = True
                break
            # Stop while there is still host RAM to save in: the OOM killer leaves no checkpoint.
            memory = host_memory()
            receipt['hostMemory'].append({'step': step, **memory})
            if memory and memory['hostAvailableBytes'] < args.min_host_available_gb * 1024 ** 3:
                receipt['stoppedForHostMemory'] = True
                print(json.dumps({'stoppedForHostMemory': True, 'step': step, **memory}), flush=True)
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
                scaler.unscale_(unscale_target)
                norm = torch.nn.utils.clip_grad_norm_(trained, 1.0)
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
            receipt['hostMemoryTrimmed'] = release_host_memory()
            receipt['losses'].append(total_loss / args.accumulation)
            print(json.dumps({'completedSteps': receipt['completedSteps'], 'loss': receipt['losses'][-1],
                'scale': scaler.get_scale(), 'peakMemoryBytes': torch.cuda.max_memory_allocated(),
                **host_memory()}), flush=True)
        receipt['trainingSeconds'] = time.monotonic() - training_begin
        receipt['peakMemoryBytes'] = torch.cuda.max_memory_allocated()
        if not receipt['completedSteps']:
            raise RuntimeError('No optimization step completed')
        # The CPU weight copies, moments and gradient buffers (about four times the model) are
        # done with; free them before the save needs host memory of its own.
        del optimizer, unscale_target
        gc.collect()
        if lora:
            # Fold the adapters into the weights so the checkpoint has the starting layout and
            # converts and runs like any other; the adapters themselves are not shipped.
            receipt['lora']['mergedModules'] = merge_lora(model)
            if tensor_shapes(model) != layout:
                raise RuntimeError('Merged checkpoint layout differs from the starting checkpoint')
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
        receipt['hostMemoryAtEnd'] = host_memory()
        receipt['elapsedSeconds'] = time.monotonic() - started
        (args.output / 'training-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
