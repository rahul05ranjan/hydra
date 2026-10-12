"""Compare frozen development plans on original weights and converted GGUF."""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request


def main(repo, node, output):
    # One question per development intent; never open sealed tasks or failures.
    capture = r"""
import fs from 'node:fs';
import * as git from './skills/hydra/scripts/lib/git.mjs';
const tasks=fs.readFileSync('evals/git_dev/tasks.jsonl','utf8').trim().split('\n').map(JSON.parse);
const seen=new Set(), rows=[];
let menu;await git.gather('Which branch am I currently on?',process.cwd(),async opts=>{menu=opts;return {probes:[]};});
for(const task of tasks){
 if(seen.has(task.intent))continue;seen.add(task.intent);
 const prompt={...menu,user:task.question};
 rows.push({intent:task.intent,accept:task.accept,prompt});
}
console.log(JSON.stringify(rows));
"""
    rows = json.loads(subprocess.check_output([node, '--input-type=module', '-e', capture], cwd=repo, text=True))
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer, Qwen3_5ForCausalLM, Qwen3_5TextConfig
    from safetensors.torch import load_file
    revision = '05d850ee62e55e2921e9ec970a9636109daa85e7'
    name = 'rahul05ranjan/hydra-nano-git'
    source = snapshot_download(name, revision=revision, allow_patterns=['*.json', '*.safetensors', '*.jinja', '*.txt'], ignore_patterns=['*.index.json'])
    tokenizer = AutoTokenizer.from_pretrained(source)
    config = json.loads((Path(source) / 'config.json').read_text())
    model = Qwen3_5ForCausalLM(Qwen3_5TextConfig(**config['text_config']))
    weights = {}
    for key, tensor in load_file(str(Path(source) / 'model.safetensors')).items():
        key = key.removeprefix('language_model.')
        if key.endswith('.conv1d.weight'):
            tensor = tensor.transpose(1, 2).contiguous()
        elif key.endswith(('.input_layernorm.weight', '.post_attention_layernorm.weight', 'model.norm.weight', '.q_norm.weight', '.k_norm.weight')):
            tensor = tensor.float() - 1.0
        weights[key] = tensor
    incompatible = model.load_state_dict(weights, strict=False, assign=True)
    if set(incompatible.missing_keys) != {'lm_head.weight'} or incompatible.unexpected_keys:
        raise ValueError(f'Unexpected checkpoint mapping: {incompatible}')
    model.tie_weights()
    model = model.to(device='cuda', dtype=torch.float16).eval()
    del weights
    results = []
    for row in rows:
        prompt = row['prompt']
        messages = [{'role': 'system', 'content': prompt['system']}, {'role': 'user', 'content': prompt['user']}]
        encoded = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, enable_thinking=False, return_tensors='pt', return_dict=True).to('cuda')
        with torch.inference_mode():
            generated = model.generate(**encoded, max_new_tokens=512, do_sample=False,
                                       eos_token_id=tokenizer.eos_token_id, pad_token_id=tokenizer.pad_token_id)
        original = tokenizer.decode(generated[0, encoded['input_ids'].shape[-1]:], skip_special_tokens=True)
        body = {'model': 'hydra-nano:git', 'messages': messages, 'temperature': 0, 'max_tokens': 512,
                'chat_template_kwargs': {'enable_thinking': False},
                'response_format': {'type': 'json_schema', 'json_schema': {'name': 'hydra_reply', 'schema': prompt['schema'], 'strict': True}}}
        request = urllib.request.Request('http://127.0.0.1:11435/v1/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=60) as response:
            reply = json.load(response)['choices'][0]
        results.append({'intent': row['intent'], 'accept': row['accept'], 'original': original, 'gguf': reply})
        Path(output).write_text(json.dumps({'sourceRevision': revision, 'developmentOnly': True, 'rows': results}, indent=2))
        print(row['intent'], flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
