"""Second tool-calling mix, built after the first candidate (train/data-toolcall) was rejected on 2026-10-17.

That candidate declined even when an offered function fitted (BFCL non-live 73.4 -> 27.4) and took up the base
model's long markdown style (GSM8K strict 43.9 -> 15.5, IFEval prompt-strict 54.2 -> 43.4). Three causes, three
changes:
  - Declines outnumbered calls (1,500 to 1,036) and most were long markdown replies. Keep only the short, plain
    declines (at most 300 characters, no markdown), so calls outnumber declines about two to one.
  - Nothing held the starting checkpoint's general style in place. Add `chat` rows: OpenAssistant oasst1
    (Apache-2.0) first questions, each answered by Hydra Nano v2 itself, so the target is v2's own reply.
  - The Git "replay" came from a corpus v2 was never trained on (seeds 76000..76299), so it was new teaching.
    Keep only the rows v2 already answers exactly, so the Git rows hold v2's behaviour instead of moving it.
Declines and calls are taken unchanged from the first mix, which already dropped BFCL v4 overlaps. Chat questions
sharing an exact question or an 8-word run with BFCL v4, IFEval or GSM8K (train and test) are dropped. No Hydra
development, holdout or sealed input is used.

Usage: python train/build_toolcall_data_v2.py --tokenizer <hf dir> --v2-url http://127.0.0.1:18301 \
         --oasst <oasst1 train parquet> --ifeval <ifeval_input_data.jsonl> --gsm8k <test parquet> <train parquet> \
         --bfcl <bfcl_eval/data>
"""
import argparse
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import random
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIRST = ROOT / 'train/data-toolcall'
OUT = ROOT / 'train/data-toolcall-v2'
SEED = 20261018
DECLINE_CHARS, CHAT, GIT = 300, 900, 1200
MAX_TOKENS = 2048
MARKDOWN = re.compile(r'\*\*|^#|^\s*[-*] |^\s*\d+\. |\$\$|```', re.M)


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'train/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


first = load_module('build_toolcall_data')


def plain_decline(row):
    text = row['messages'][-1]['content']
    return len(text) <= DECLINE_CHARS and not MARKDOWN.search(text)


def benchmark_index(args):
    import pyarrow.parquet as pq
    questions, runs, functions = first.bfcl_index(args.bfcl)
    texts = [json.loads(l)['prompt'] for l in open(args.ifeval) if l.strip()]
    for path in args.gsm8k:
        texts += pq.read_table(path).column('question').to_pylist()
    for text in texts:
        questions.add(' '.join(first.words(text)))
        runs |= first.grams(text)
    return questions, runs, functions


def chat_reply(base_url, messages, max_tokens):
    body = {'messages': messages, 'temperature': 0, 'max_tokens': max_tokens,
            'chat_template_kwargs': {'enable_thinking': False}}
    request = urllib.request.Request(f'{base_url}/v1/chat/completions', json.dumps(body).encode(),
                                     {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=600) as response:
        choice = json.load(response)['choices'][0]
    return (choice['message'].get('content') or '').strip(), choice.get('finish_reason')


def oasst_questions(path, index):
    import pyarrow.parquet as pq
    table = pq.read_table(path, columns=['message_id', 'parent_id', 'role', 'lang', 'text', 'deleted', 'review_result'])
    seen, kept = set(), []
    for row in table.to_pylist():
        text = (row['text'] or '').strip()
        if row['parent_id'] is not None or row['role'] != 'prompter' or row['lang'] != 'en' or row['deleted']:
            continue
        if row['review_result'] is False or not 20 <= len(text) <= 1500:
            continue
        key = ' '.join(first.words(text))
        if key in seen or first.leaks(text, [], index):
            continue
        seen.add(key)
        kept.append({'id': row['message_id'], 'question': text})
    return kept


def same_target(reply, gold):
    try:
        return json.loads(reply) == json.loads(gold)
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser()
    for name in ('--tokenizer', '--v2-url', '--oasst', '--ifeval', '--bfcl'):
        parser.add_argument(name, required=True)
    parser.add_argument('--gsm8k', nargs='+', required=True)
    args = parser.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer)
    count = lambda messages, tools=None: len(tokenizer.apply_chat_template(messages, tools=tools, tokenize=True,
                                                                            enable_thinking=False, return_dict=False))
    rng = random.Random(SEED)
    stats = {}

    earlier = [json.loads(l) for l in (FIRST / 'train.jsonl').read_text().splitlines() if l.strip()]
    declines = [r for r in earlier if r.get('kind') == 'irrelevance']
    calls = [r for r in earlier if r.get('kind') == 'call']
    short = [r for r in declines if plain_decline(r)]
    stats['declines'] = {'firstMix': len(declines), 'shortPlain': len(short)}
    stats['calls'] = {'firstMix': len(calls), 'kept': len(calls)}

    # General questions answered by v2 itself.
    index = benchmark_index(args)
    pool = oasst_questions(args.oasst, index)
    stats['chat'] = {'oasstFirstQuestions': len(pool)}
    rng.shuffle(pool)
    pool = pool[:int(CHAT * 1.4)]

    def answer(item):
        messages = [{'role': 'user', 'content': item['question']}]
        text, finish = chat_reply(args.v2_url, messages, 768)
        return item, messages, text, finish

    chat = []
    with concurrent.futures.ThreadPoolExecutor(4) as executor:
        for item, messages, text, finish in executor.map(answer, pool):
            if finish != 'stop' or not text or '<tool_call>' in text or '<function=' in text:
                continue
            messages = messages + [{'role': 'assistant', 'content': text}]
            if count(messages) <= MAX_TOKENS:
                chat.append({'head': 'chat', 'source': 'OpenAssistant/oasst1', 'sourceId': item['id'], 'messages': messages})
    stats['chat'].update(asked=len(pool), keptStopped=len(chat))
    chat = chat[:CHAT]

    # Git rows v2 already answers exactly.
    corpus = ROOT / 'train/data-balanced-git'
    git_rows = [json.loads(l) for l in (corpus / 'train.jsonl').read_text().splitlines() if l.strip()]
    git_rows = [r for r in git_rows if r.get('head') == 'git']
    rng.shuffle(git_rows)
    git_pool = git_rows[:int(GIT * 1.4)]

    def check(row):
        text, finish = chat_reply(args.v2_url, row['messages'][:-1], 256)
        return row, finish == 'stop' and same_target(text, row['messages'][-1]['content'])

    agreed = []
    with concurrent.futures.ThreadPoolExecutor(4) as executor:
        for row, ok in executor.map(check, git_pool):
            if ok:
                agreed.append(row)
    stats['git'] = {'source': len(git_rows), 'asked': len(git_pool), 'v2Agrees': len(agreed)}
    agreed = agreed[:GIT]

    rows = short + calls + chat + agreed
    rng.shuffle(rows)
    rows = first.contract_filter(rows, stats)
    OUT.mkdir(parents=True, exist_ok=True)
    git_spec = json.loads((corpus / 'manifest.json').read_text())
    first_spec = json.loads((FIRST / 'manifest.json').read_text())
    manifest = {
        'scope': 'Tool-calling mix v2: short plain declines, calls outnumbering them, v2-answered general questions '
                 'and Git rows v2 already answers, so v2 keeps its style and Git skill while learning to decline.',
        'seed': SEED, 'maxTokens': MAX_TOKENS,
        'sources': {'train/data-toolcall': {'dataSha256': first_spec['dataSha256'], 'uses': 'short plain declines and all calls'},
                    'OpenAssistant/oasst1': {'license': 'Apache-2.0', 'sha256': first.sha256(args.oasst),
                                             'uses': 'English first questions; replies by Hydra Nano v2'},
                    'train/data-balanced-git': {'dataSha256': git_spec['dataSha256'], 'uses': 'rows v2 answers exactly'}},
        'chatTargets': 'Hydra Nano v2 (Q8_0 GGUF 6d6542c8) replies, temperature 0, thinking off',
        'gitFilter': 'kept only rows whose gold target equals v2 reply (temperature 0, no schema)',
        'benchmarkFilter': 'dropped any chat question sharing an exact question or an 8-word run with BFCL v4, IFEval or GSM8K',
        'filterSources': {'ifeval': first.sha256(args.ifeval), 'gsm8k': [first.sha256(p) for p in args.gsm8k]},
        'worldSeeds': git_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False}
    first.OUT = OUT
    first.write(rows, stats, manifest)


if __name__ == '__main__':
    main()
