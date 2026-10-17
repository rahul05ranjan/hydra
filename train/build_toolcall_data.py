"""Build the tool-calling training mix that teaches Hydra Nano to decline when no offered function fits.

Sources (licences recorded in the manifest):
  - MadeAgents/xlam-irrelevance-7.5k (CC-BY-4.0): questions whose offered functions cannot answer them.
    The target is base Qwen3.5-0.8B's own reply to the same prompt, kept only when it makes no call,
    so the model learns to decline without learning a new writing style or new facts.
  - NousResearch/hermes-function-calling-v1, func-calling-singleturn (Apache-2.0): questions that do
    need calls. The target is the dataset's calls, kept only when every call names an offered function
    and passes only that function's declared parameters.
  - Hydra's own Git corpus (train/data-balanced-git), replayed so the fixed-menu heads keep their skill.
Any example sharing an exact question, an 8-word run of a question, or a function name with BFCL v4 is
dropped, so the training data cannot leak the benchmark. No Hydra development, holdout or sealed input
is used.

Usage: python train/build_toolcall_data.py --tokenizer <hf dir> --base-url http://127.0.0.1:18102 \
         --xlam <xlam-7.5k-irrelevancek.json> --hermes <func-calling-singleturn.json> --bfcl <bfcl_eval/data>
"""
import argparse
import concurrent.futures
import glob
import importlib.util
import hashlib
import json
import os
import random
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'train/data-toolcall'
SEED = 20261017
IRRELEVANT, CALLS, REPLAY = 1500, 1800, 1500
MAX_TOKENS = 2048
XLAM_TYPES = {'str': 'string', 'string': 'string', 'int': 'integer', 'integer': 'integer', 'float': 'number',
              'number': 'number', 'bool': 'boolean', 'boolean': 'boolean', 'dict': 'object', 'object': 'object'}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def words(text):
    return re.sub(r'\W+', ' ', text.lower()).split()


def grams(text, n=8):
    w = words(text)
    return {' '.join(w[i:i + n]) for i in range(len(w) - n + 1)}


def bfcl_index(directory):
    questions, runs, functions = set(), set(), set()
    for file in glob.glob(os.path.join(directory, 'BFCL_v4_*.json')):
        for line in open(file):
            try:
                row = json.loads(line)
            except ValueError:
                continue
            for turn in row.get('question', []):
                for message in turn if isinstance(turn, list) else [turn]:
                    if isinstance(message, dict) and isinstance(message.get('content'), str):
                        questions.add(' '.join(words(message['content'])))
                        runs |= grams(message['content'])
            for function in row.get('function', []) or []:
                if isinstance(function, dict):
                    functions.add(function.get('name'))
    return questions, runs, functions


def leaks(question, names, index):
    questions, runs, functions = index
    return ' '.join(words(question)) in questions or bool(grams(question) & runs) or any(n in functions for n in names)


def xlam_tool(tool):
    """xLAM writes parameters as {name: {type, description, default}}; Qwen's template takes JSON Schema."""
    properties, required = {}, []
    for name, spec in (tool.get('parameters') or {}).items():
        kind = str(spec.get('type', 'string')).split(',')[0].strip()
        base = XLAM_TYPES.get(kind.lower(), 'array' if kind.lower().startswith('list') else 'string')
        properties[name] = {'type': base, 'description': spec.get('description', '')}
        if 'default' not in spec:
            required.append(name)
    return {'type': 'function', 'function': {'name': tool['name'], 'description': tool.get('description', ''),
                                             'parameters': {'type': 'object', 'properties': properties, 'required': required}}}


def complete(base_url, prompt):
    body = json.dumps({'prompt': prompt, 'temperature': 0, 'max_tokens': 512, 'cache_prompt': True}).encode()
    request = urllib.request.Request(f'{base_url}/v1/completions', body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=600) as response:
        choice = json.load(response)['choices'][0]
    return choice['text'], choice.get('finish_reason')


def contract_filter(rows, stats):
    """Last step: keep only rows the trainer's own contract accepts (validate_row in full_finetune.py).
    Order is kept, so re-running this on a built file gives the same result as a fresh build."""
    spec = importlib.util.spec_from_file_location('full_finetune', ROOT / 'train/full_finetune.py')
    trainer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trainer)
    kept, rejected = [], {}
    for row in rows:
        try:
            trainer.validate_row(row)
            kept.append(row)
        except ValueError as error:
            rejected[str(error)] = rejected.get(str(error), 0) + 1
    stats['contractRejected'] = rejected
    return kept


def write(rows, stats, manifest):
    data = OUT / 'train.jsonl'
    data.write_text(''.join(json.dumps(r, sort_keys=True) + '\n' for r in rows))
    heads = {}
    for row in rows:
        heads[row['head']] = heads.get(row['head'], 0) + 1
    manifest.update(dataSha256=sha256(data), examples=len(rows), heads=heads, stats=stats)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: v for k, v in manifest.items() if k in ('examples', 'heads', 'stats', 'dataSha256')}, indent=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refilter', action='store_true', help='Re-apply only the final contract filter to the built file')
    for name in ('--tokenizer', '--base-url', '--xlam', '--hermes', '--bfcl'):
        parser.add_argument(name, required=False)
    args = parser.parse_args()
    if args.refilter:
        manifest = json.loads((OUT / 'manifest.json').read_text())
        rows = [json.loads(l) for l in (OUT / 'train.jsonl').read_text().splitlines() if l.strip()]
        return write(contract_filter(rows, manifest['stats']), manifest['stats'], manifest)
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer)
    count = lambda messages, tools: len(tokenizer.apply_chat_template(messages, tools=tools, tokenize=True,
                                                                        enable_thinking=False, return_dict=False))
    index = bfcl_index(args.bfcl)
    rng = random.Random(SEED)
    stats = {}

    # Questions no offered function can answer: the target is the base model's own reply without a call.
    xlam = json.load(open(args.xlam))
    candidates = []
    for row in xlam:
        tools = [xlam_tool(t) for t in json.loads(row['tools'])]
        if json.loads(row['answers']) if isinstance(row['answers'], str) else row['answers']:
            continue
        # Every BFCL question offers functions; a question offered none teaches nothing about declining one.
        if tools and not leaks(row['query'], [t['function']['name'] for t in tools], index):
            candidates.append({'tools': tools, 'question': row['query']})
    stats['irrelevance'] = {'source': len(xlam), 'afterBfclFilter': len(candidates)}
    rng.shuffle(candidates)
    # About half of base replies decline without a call, so distil a pool large enough for the target.
    pool = candidates[:int(IRRELEVANT * 2.6)]

    def distill(item):
        messages = [{'role': 'user', 'content': item['question']}]
        prompt = tokenizer.apply_chat_template(messages, tools=item['tools'], add_generation_prompt=True,
                                               tokenize=False, enable_thinking=False)
        text, finish = complete(args.base_url, prompt)
        return item, text.strip(), finish

    irrelevant = []
    with concurrent.futures.ThreadPoolExecutor(4) as executor:
        for item, text, finish in executor.map(distill, pool):
            if finish == 'stop' and text and '<tool_call>' not in text and '<function=' not in text:
                messages = [{'role': 'user', 'content': item['question']}, {'role': 'assistant', 'content': text}]
                if count(messages, item['tools']) <= MAX_TOKENS:
                    irrelevant.append({'head': 'toolcall', 'kind': 'irrelevance', 'source': 'MadeAgents/xlam-irrelevance-7.5k',
                                       'tools': item['tools'], 'messages': messages})
    stats['irrelevance'].update(distilled=len(pool), keptNoCall=len(irrelevant))
    irrelevant = irrelevant[:IRRELEVANT]

    # Questions that need calls: the dataset's calls, checked against the offered functions.
    hermes = json.load(open(args.hermes))
    calls = []
    for row in hermes:
        tools = json.loads(row['tools']) if isinstance(row['tools'], str) else row['tools']
        human = next(m['value'] for m in row['conversations'] if m['from'] == 'human')
        reply = next(m['value'] for m in row['conversations'] if m['from'] == 'gpt')
        schemas = {t['function']['name']: set((t['function'].get('parameters') or {}).get('properties', {})) for t in tools}
        try:
            tool_calls = [json.loads(block) for block in re.findall(r'<tool_call>\s*(.*?)\s*</tool_call>', reply, re.DOTALL)]
        except ValueError:
            continue
        if not tool_calls or any(c.get('name') not in schemas or not isinstance(c.get('arguments'), dict)
                                 or not set(c['arguments']) <= schemas[c['name']] for c in tool_calls):
            continue
        if leaks(human, list(schemas), index):
            continue
        messages = [{'role': 'user', 'content': human},
                    {'role': 'assistant', 'content': '', 'tool_calls': [{'type': 'function', 'function': c} for c in tool_calls]}]
        if count(messages, tools) <= MAX_TOKENS:
            calls.append({'head': 'toolcall', 'kind': 'call', 'source': 'NousResearch/hermes-function-calling-v1',
                          'tools': tools, 'messages': messages})
    stats['calls'] = {'source': len(hermes), 'kept': len(calls)}
    rng.shuffle(calls)
    calls = calls[:CALLS]

    # Hydra's own fixed-menu Git examples, replayed unchanged.
    corpus = ROOT / 'train/data-balanced-git'
    git_rows = [json.loads(l) for l in (corpus / 'train.jsonl').read_text().splitlines() if l.strip()]
    git_rows = [r for r in git_rows if r.get('head') == 'git']
    rng.shuffle(git_rows)
    replay = git_rows[:REPLAY]
    stats['replay'] = {'source': len(git_rows), 'kept': len(replay)}

    rows = irrelevant + calls + replay
    rng.shuffle(rows)
    rows = contract_filter(rows, stats)
    OUT.mkdir(parents=True, exist_ok=True)
    git_spec = json.loads((corpus / 'manifest.json').read_text())
    manifest = {
        'scope': 'Tool-calling mix: decline when no offered function fits, call correctly when one does, and replay Hydra Git examples.',
        'seed': SEED, 'maxTokens': MAX_TOKENS,
        'sources': {'MadeAgents/xlam-irrelevance-7.5k': {'license': 'CC-BY-4.0', 'sha256': sha256(args.xlam)},
                    'NousResearch/hermes-function-calling-v1 func-calling-singleturn': {'license': 'Apache-2.0', 'sha256': sha256(args.hermes)},
                    'train/data-balanced-git': {'dataSha256': git_spec['dataSha256']}},
        'irrelevanceTargets': 'base Qwen3.5-0.8B (Q8_0 GGUF c709226b) replies, temperature 0, thinking off, kept only without a call',
        'bfclFilter': 'dropped any example sharing an exact question, an 8-word run or a function name with BFCL v4',
        'worldSeeds': git_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False}
    write(rows, stats, manifest)


if __name__ == '__main__':
    main()
