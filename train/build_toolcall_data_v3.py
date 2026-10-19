"""Third tool-calling mix, built after the second candidate (train/data-toolcall-v2) failed the local probe on 2026-10-19.

That candidate kept v2's math and style but declined, or made up an answer, when a short question had a fitting
function (2/6 against v2's 6/6). The mix taught that from prompt length alone: every call question came from Hermes
and had at least 100 words, while 359 of the 440 declines had 20 words or fewer. Changes:
  - Short calls: first turns of glaiveai/glaive-function-calling-v2 (Apache-2.0) that make one call, kept only
    when Hydra Nano v2 makes the same call itself, so the rows hold v2's calling instead of moving it.
  - Hermes calls are kept only when v2 makes the same call, capped so short calls outnumber them.
  - Glaive first turns that decline an offered function join the declines. The target is v2's own reply when v2
    declines in a short, plain reply, and Glaive's decline when v2 wrongly calls.
  - The 440 short declines, the v2-answered chat rows and the Git rows v2 already answers are reused from the
    second mix unchanged.
Rows offering a function named like one in the local probe (~/.hydra/build/toolcall-probe/probe.py) are dropped so
the probe stays a fair check, and any row sharing a question, an 8-word run or a function name with BFCL v4 is
dropped. No Hydra development, holdout or sealed input is used.

Usage: python train/build_toolcall_data_v3.py --tokenizer <hf dir> --v2-url http://127.0.0.1:18301 \
         --glaive <glaive-function-calling-v2.json> --bfcl <bfcl_eval/data> [--cache <replies.jsonl>]
"""
import argparse
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import random
import re
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SECOND = ROOT / 'train/data-toolcall-v2'
OUT = ROOT / 'train/data-toolcall-v3'
SEED = 20261019
SHORT_CALLS, LONG_CALLS, GLAIVE_DECLINES = 1000, 600, 300
MAX_TOKENS = 2048
PROBE_FUNCTIONS = {'get_weather', 'convert_currency', 'send_email', 'create_calendar_event'}
DECLINE = re.compile(r"\b(sorry|unable|can't|cannot|can not|don't have the (ability|capability))\b", re.I)


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'train/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


first = load_module('build_toolcall_data')
second = load_module('build_toolcall_data_v2')


def glaive_tools(system):
    """Glaive lists each function as a JSON object after the 'Use them if required -' line."""
    head, sep, rest = system.partition('Use them if required -')
    if not sep:
        return []
    decoder, tools, index = json.JSONDecoder(), [], 0
    while True:
        rest = rest[index:].lstrip()
        if not rest.startswith('{'):
            return tools
        try:
            spec, index = decoder.raw_decode(rest)
        except ValueError:
            return []
        if not isinstance(spec, dict) or not spec.get('name') or not isinstance(spec.get('parameters'), dict) \
                or spec['parameters'].get('type') != 'object' \
                or not isinstance(spec['parameters'].get('properties', {}), dict) \
                or not isinstance(spec['parameters'].get('required', []), list):
            return []
        tools.append({'type': 'function', 'function': {'name': spec['name'], 'description': spec.get('description', ''),
                                                       'parameters': spec['parameters']}})


def glaive_first_turn(chat):
    """The first user question and the first assistant reply: one call, or plain text."""
    match = re.match(r'\s*USER:\s*(.*?)\s*ASSISTANT:\s*(.*?)\s*<\|endoftext\|>', chat, re.DOTALL)
    if not match:
        return None
    question, reply = match.group(1).strip(), match.group(2).strip()
    if '<functioncall>' not in reply:
        return question, None, reply
    call = re.fullmatch(r'<functioncall>\s*\{"name":\s*"([^"]+)",\s*"arguments":\s*\'(.*)\'\s*\}', reply, re.DOTALL)
    if not call:
        return None
    try:
        arguments = json.loads(call.group(2))
    except ValueError:
        return None
    return (question, {'name': call.group(1), 'arguments': arguments}, None) if isinstance(arguments, dict) else None


def fits(call, tools):
    schema = next((t['function']['parameters'] for t in tools if t['function']['name'] == call['name']), None)
    return schema is not None and set(call['arguments']) <= set(schema.get('properties', {})) \
        and set(schema.get('required', [])) <= set(call['arguments'])


def v2_reply(base_url, question, tools, cache=None):
    body = {'messages': [{'role': 'user', 'content': question}], 'tools': tools, 'temperature': 0, 'max_tokens': 512,
            'chat_template_kwargs': {'enable_thinking': False}}
    key = json.dumps(body, sort_keys=True)
    if cache is not None and key in cache:
        choice = cache[key]
    else:
        request = urllib.request.Request(f'{base_url}/v1/chat/completions', json.dumps(body).encode(),
                                         {'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                choice = json.load(response)['choices'][0]
        except urllib.error.HTTPError:
            # llama.cpp rejects some schemas (an empty enum, for one); such a row cannot be checked.
            choice = {'message': {}, 'finish_reason': 'error'}
        if cache is not None:
            cache[key] = choice
    if choice.get('finish_reason') == 'error':
        return [{'name': None, 'arguments': None}], '', 'error'
    message = choice['message']
    calls = []
    for call in message.get('tool_calls') or []:
        try:
            calls.append({'name': call['function']['name'], 'arguments': json.loads(call['function']['arguments'])})
        except (KeyError, ValueError):
            calls.append({'name': None, 'arguments': None})
    return calls, (message.get('content') or '').strip(), choice.get('finish_reason')


def call_row(source, tools, question, calls):
    return {'head': 'toolcall', 'kind': 'call', 'source': source, 'tools': tools,
            'messages': [{'role': 'user', 'content': question},
                         {'role': 'assistant', 'content': '', 'tool_calls': [{'type': 'function', 'function': c} for c in calls]}]}


def main():
    parser = argparse.ArgumentParser()
    for name in ('--tokenizer', '--v2-url', '--glaive', '--bfcl'):
        parser.add_argument(name, required=True)
    parser.add_argument('--cache', default=str(Path.home() / '.hydra/build/toolcall-v3-replies.jsonl'))
    args = parser.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer)
    count = lambda messages, tools=None: len(tokenizer.apply_chat_template(messages, tools=tools, tokenize=True,
                                                                            enable_thinking=False, return_dict=False))
    index = first.bfcl_index(args.bfcl)
    rng = random.Random(SEED)
    stats = {}

    earlier = [json.loads(l) for l in (SECOND / 'train.jsonl').read_text().splitlines() if l.strip()]
    declines = [r for r in earlier if r['head'] == 'toolcall' and not r['messages'][-1].get('tool_calls')]
    hermes = [r for r in earlier if r['head'] == 'toolcall' and r['messages'][-1].get('tool_calls')]
    chat = [r for r in earlier if r['head'] == 'chat']
    git = [r for r in earlier if r['head'] == 'git']
    stats['reused'] = {'declines': len(declines), 'chat': len(chat), 'git': len(git)}
    probe_free = lambda tools: not PROBE_FUNCTIONS & {t['function']['name'] for t in tools}

    # Glaive first turns, sorted into single calls and declines of an offered function.
    glaive = json.load(open(args.glaive))
    short_pool, decline_pool, seen = [], [], set()
    for number, row in enumerate(glaive):
        tools = glaive_tools(row['system'])
        turn = glaive_first_turn(row['chat'])
        if not tools or not turn or not probe_free(tools):
            continue
        question, call, text = turn
        key = ' '.join(first.words(question))
        if not 3 <= len(key.split()) <= 60 or key in seen:
            continue
        if first.leaks(question, [t['function']['name'] for t in tools], index):
            continue
        seen.add(key)
        item = {'id': number, 'tools': tools, 'question': question}
        if call and fits(call, tools):
            short_pool.append({**item, 'call': call})
        elif text and DECLINE.search(text) and len(text) <= second.DECLINE_CHARS and not second.MARKDOWN.search(text):
            decline_pool.append({**item, 'text': text})
    stats['glaive'] = {'source': len(glaive), 'singleCalls': len(short_pool), 'plainDeclines': len(decline_pool)}
    rng.shuffle(short_pool)
    rng.shuffle(decline_pool)

    # v2's replies, kept between runs so a failed build does not ask again. Temperature 0, so a reply is fixed.
    cache_file = Path(args.cache)
    cache = {}
    if cache_file.exists():
        for line in cache_file.read_text().splitlines():
            entry = json.loads(line)
            cache[entry['key']] = entry['choice']
    known = set(cache)

    def ask(item):
        return item, *v2_reply(args.v2_url, item['question'], item['tools'], cache)

    def save():
        with cache_file.open('a') as stream:
            for key in set(cache) - known:
                stream.write(json.dumps({'key': key, 'choice': cache[key]}) + '\n')
                known.add(key)

    def run(items):
        try:
            with concurrent.futures.ThreadPoolExecutor(4) as executor:
                yield from executor.map(ask, items)
        finally:
            save()

    short = []
    for item, calls, text, finish in run(short_pool[:int(SHORT_CALLS * 1.8)]):
        if calls == [item['call']]:
            row = call_row('glaiveai/glaive-function-calling-v2', item['tools'], item['question'], [item['call']])
            if count(row['messages'], row['tools']) <= MAX_TOKENS:
                short.append(row)
    stats['glaive'].update(callsAsked=int(SHORT_CALLS * 1.8), v2Agrees=len(short))
    short = short[:SHORT_CALLS]

    glaive_declines, v2_declined, v2_called = [], 0, 0
    for item, calls, text, finish in run(decline_pool[:int(GLAIVE_DECLINES * 1.5)]):
        if calls:
            v2_called += 1
            target = item['text']
        elif finish == 'stop' and text and len(text) <= second.DECLINE_CHARS and not second.MARKDOWN.search(text):
            v2_declined += 1
            target = text
        else:
            continue
        messages = [{'role': 'user', 'content': item['question']}, {'role': 'assistant', 'content': target}]
        if count(messages, item['tools']) <= MAX_TOKENS:
            glaive_declines.append({'head': 'toolcall', 'kind': 'irrelevance', 'source': 'glaiveai/glaive-function-calling-v2',
                                    'tools': item['tools'], 'messages': messages})
    stats['glaive'].update(declinesAsked=int(GLAIVE_DECLINES * 1.5), v2DeclinedPlainly=v2_declined,
                           v2CalledInstead=v2_called)
    glaive_declines = glaive_declines[:GLAIVE_DECLINES]

    long = []
    items = [{'row': r, 'question': r['messages'][0]['content'], 'tools': r['tools']} for r in hermes]
    for item, calls, text, finish in run(items):
        if calls == [c['function'] for c in item['row']['messages'][-1]['tool_calls']]:
            long.append(item['row'])
    stats['hermes'] = {'asked': len(hermes), 'v2Agrees': len(long),
                       'schemaRejected': sum(1 for i in items if v2_reply(args.v2_url, i['question'], i['tools'], cache)[2] == 'error')}
    rng.shuffle(long)
    long = long[:LONG_CALLS]

    rows = short + long + declines + glaive_declines + chat + git
    rng.shuffle(rows)
    rows = first.contract_filter(rows, stats)
    toolcall = [r for r in rows if r['head'] == 'toolcall']
    lengths = lambda kind: sorted(len(r['messages'][0]['content'].split()) for r in toolcall
                                  if bool(r['messages'][-1].get('tool_calls')) == kind)
    stats['questionWordsMedian'] = {'calls': lengths(True)[len(lengths(True)) // 2],
                                    'declines': lengths(False)[len(lengths(False)) // 2]}
    OUT.mkdir(parents=True, exist_ok=True)
    second_spec = json.loads((SECOND / 'manifest.json').read_text())
    manifest = {
        'scope': 'Tool-calling mix v3: short calls v2 already makes, so question length no longer predicts a decline; '
                 'declines, v2-answered chat and Git rows v2 already answers, as in v2.',
        'seed': SEED, 'maxTokens': MAX_TOKENS,
        'sources': {'train/data-toolcall-v2': {'dataSha256': second_spec['dataSha256'],
                                               'uses': 'short plain declines, chat rows, Git rows; Hermes calls v2 makes'},
                    'glaiveai/glaive-function-calling-v2': {'license': 'Apache-2.0',
                                                            'revision': 'e7f4b6456019f5d8bcb991ef0dd67d8ff23221ac',
                                                            'sha256': first.sha256(args.glaive),
                                                            'uses': 'first-turn single calls v2 makes; first-turn declines'}},
        'callFilter': 'kept only calls Hydra Nano v2 (Q8_0 GGUF 6d6542c8) makes itself: same name and arguments, '
                      'temperature 0, thinking off',
        'declineTargets': "v2's own reply when it declines in at most 300 characters without markdown, else Glaive's decline",
        'probeFilter': 'dropped rows offering ' + ', '.join(sorted(PROBE_FUNCTIONS)),
        'bfclFilter': 'dropped any Glaive row sharing an exact question, an 8-word run or a function name with BFCL v4',
        'worldSeeds': second_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False}
    first.OUT = OUT
    first.write(rows, stats, manifest)


if __name__ == '__main__':
    main()
