"""Fifth tool-calling mix: text distillation from Cloudflare Workers AI GLM-5.3, built 2026-11-26.

v3 (full fine-tune) and v4 (LoRA) both trained on v2's own replies and failed: v2 calls a function on almost every
question it is offered one (1/50 right declines on the teacher probe, train/teacher_probe.py), so its replies cannot
teach declining. GLM-5.3 declined 45/50 and chose to call on 50/50 of the same questions. Here GLM writes every
tool-calling target:
  - Calls: first-turn single calls from glaiveai/glaive-function-calling-v2 (short questions) and
    NousResearch/hermes-function-calling-v1 func-calling-singleturn (long, sometimes several calls). A GLM reply is
    kept only when its calls name the same functions as the dataset's, every argument is declared, every required
    one is present and no value is null.
  - Declines: MadeAgents/xlam-irrelevance-7.5k and Glaive first turns that decline. Kept only when GLM makes no call
    and replies in at most 300 characters without markdown.
GLM gets a short style instruction (TEACHER_SYSTEM) so its replies match Hydra's plain style; the training rows hold
only the user's question, so the student learns the behaviour, not the instruction.
The chat rows and Git rows are reused unchanged from train/data-toolcall-v3 (v2's own replies), so the Hydra heads
keep their skill. v3's declines are dropped: their targets were base-model replies that often made up an answer.
Every row sharing a question, an 8-word run or a function name with BFCL v4 is dropped, as are rows offering a
function from the local probe and the 100 teacher-probe questions. No Hydra development, held-out or sealed input.

GLM replies are cached in --cache as they arrive, so an interrupted build continues where it stopped.

Usage: python train/build_toolcall_data_v5.py --tokenizer <hf dir> --glaive <glaive-function-calling-v2.json> \
         --hermes <func-calling-singleturn.json> --xlam <xlam-7.5k-irrelevancek.json> --bfcl <bfcl_eval/data> \
         [--cache ~/.hydra/build/toolcall-v5-glm.jsonl] [--workers 3] [--limit N]
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
THIRD = ROOT / 'train/data-toolcall-v3'
OUT = ROOT / 'train/data-toolcall-v5'
PROBE_RESULTS = ROOT / 'evals/results/teacher-probe-glm-5.3.json'
SEED = 20261126
# About 6,000 questions (the user's size, 2026-11-26); every reply that passes the checks is kept.
ASKS = {'glaive-call': 2400, 'hermes-call': 992, 'xlam-decline': 2500, 'glaive-decline': 142}
# The trainer samples rows uniformly, so the reused chat and Git rows appear twice to keep Git near v3's share.
REUSED_REPEAT = 2
MAX_TOKENS = 2048
TEACHER_SYSTEM = ("Reply in plain text without markdown, in at most two short sentences. Call a function only when "
                  "one of the offered functions can do what the user asks, and take every argument from the user's "
                  "words; never invent a value or pass null. If no offered function fits, call none: answer directly "
                  "if you can, or say briefly that none of the available tools can do it.")


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'train/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


first = load_module('build_toolcall_data')
second = load_module('build_toolcall_data_v2')
third = load_module('build_toolcall_data_v3')
probe = load_module('teacher_probe')
cloudflare = load_module('cloudflare_dev')


def has_null(value):
    if value is None:
        return True
    if isinstance(value, dict):
        return any(has_null(v) for v in value.values())
    if isinstance(value, list):
        return any(has_null(v) for v in value)
    return False


class Teacher:
    """GLM-5.3 replies at temperature 0, appended to a JSONL cache as each one arrives."""

    def __init__(self, config, cache_file, deadline=None):
        self.config, self.cache_file, self.lock = config, Path(cache_file), threading.Lock()
        self.deadline = deadline
        self.cache = {}
        if self.cache_file.exists():
            for line in self.cache_file.read_text().splitlines():
                if line.strip():
                    entry = json.loads(line)
                    self.cache[entry['key']] = entry['reply']
        self.asked = 0

    def key(self, question, tools):
        return hashlib.sha256(json.dumps([self.config['model'], TEACHER_SYSTEM, question, tools], sort_keys=True).encode()).hexdigest()

    def reply(self, question, tools):
        key = self.key(question, tools)
        if key in self.cache:
            return self.cache[key]
        if self.deadline and time.monotonic() > self.deadline:
            return None
        payload = {'model': self.config['model'], 'tools': tools, 'tool_choice': 'auto', 'temperature': 0, 'stream': False,
                   'max_completion_tokens': 2048, 'reasoning_effort': 'low',
                   'messages': [{'role': 'system', 'content': TEACHER_SYSTEM}, {'role': 'user', 'content': question}]}
        request = urllib.request.Request(self.config['base'] + '/chat/completions', data=json.dumps(payload).encode(),
                                         headers={'Authorization': 'Bearer ' + self.config['token'],
                                                  'Content-Type': 'application/json'}, method='POST')
        reply = None
        for attempt in range(10):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    body = json.load(response)
                choice = body['choices'][0]
                calls = []
                for call in choice['message'].get('tool_calls') or []:
                    arguments = call['function'].get('arguments')
                    try:
                        arguments = json.loads(arguments) if isinstance(arguments, str) else arguments
                    except ValueError:
                        arguments = None
                    calls.append({'name': call['function'].get('name'), 'arguments': arguments})
                reply = {'calls': calls, 'content': (choice['message'].get('content') or '').strip(),
                         'finish': choice.get('finish_reason'), 'usage': body.get('usage')}
                break
            except urllib.error.HTTPError as error:
                if error.code == 429:
                    time.sleep(20 + 10 * min(attempt, 4))
                    continue
                if error.code == 400:  # a schema the API refuses: record it, so it is not asked again
                    reply = {'calls': [], 'content': '', 'finish': 'refused', 'usage': None}
                    break
                time.sleep(5 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
                time.sleep(5 * (attempt + 1))
        if reply is None:
            return None  # not cached: the next build asks again
        with self.lock:
            self.cache[key] = reply
            with self.cache_file.open('a') as stream:
                stream.write(json.dumps({'key': key, 'reply': reply}) + '\n')
            self.asked += 1
            if self.asked % 50 == 0:
                print(f'[{time.strftime("%H:%M:%S")}] asked {self.asked} new, cached {len(self.cache)}', flush=True)
        return reply


def main():
    parser = argparse.ArgumentParser()
    for name in ('--tokenizer', '--glaive', '--hermes', '--xlam', '--bfcl'):
        parser.add_argument(name, required=True)
    parser.add_argument('--cache', default=str(Path.home() / '.hydra/build/toolcall-v5-glm.jsonl'))
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--limit', type=int, help='ask at most this many questions per pool (a dry run)')
    parser.add_argument('--deadline-seconds', type=float,
                        help='stop asking after this long and build from the replies so far (unanswered rows are left out)')
    args = parser.parse_args()
    started = time.monotonic()
    if (ROOT / '.env').exists():
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
    config = cloudflare.configuration(os.environ)
    if config['missing']:
        raise SystemExit('Missing environment variable names: ' + ', '.join(config['missing']))
    teacher = Teacher(config, args.cache, started + args.deadline_seconds if args.deadline_seconds else None)
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer)
    count = lambda messages, tools=None: len(tokenizer.apply_chat_template(messages, tools=tools, tokenize=True,
                                                                            enable_thinking=False, return_dict=False))
    index = first.bfcl_index(args.bfcl)
    rng = random.Random(SEED)
    probed = {' '.join(first.words(r['question'])) for r in json.loads(PROBE_RESULTS.read_text())['rows']}
    seen = set(probed)
    stats = {'teacher': config['model'], 'excludedProbeQuestions': len(probed)}

    def usable(question, tools):
        key = ' '.join(first.words(question))
        names = [t['function']['name'] for t in tools]
        if not tools or key in seen or set(names) & third.PROBE_FUNCTIONS or first.leaks(question, names, index):
            return False
        seen.add(key)
        return True

    pools = {k: [] for k in ASKS}
    for row in json.load(open(args.glaive)):
        tools = third.glaive_tools(row['system'])
        turn = third.glaive_first_turn(row['chat'])
        if not tools or not turn:
            continue
        question, call, text = turn
        if not 3 <= len(question.split()) <= 60:
            continue
        if call and third.fits(call, tools) and usable(question, tools):
            pools['glaive-call'].append({'question': question, 'tools': tools, 'gold': [call]})
        elif not call and text and third.DECLINE.search(text) and usable(question, tools):
            pools['glaive-decline'].append({'question': question, 'tools': tools, 'gold': []})
    for item in probe.hermes_calls(args.hermes):
        if usable(item['question'], item['tools']):
            pools['hermes-call'].append(item)
    for item in probe.xlam_declines(args.xlam):
        if usable(item['question'], item['tools']):
            pools['xlam-decline'].append(item)
    stats['pools'] = {k: len(v) for k, v in pools.items()}
    asks = {}
    for name, pool in pools.items():
        rng.shuffle(pool)
        asks[name] = pool[:min(len(pool), ASKS[name], args.limit or 10 ** 9)]
    stats['asked'] = {k: len(v) for k, v in asks.items()}
    print(json.dumps({'pools': stats['pools'], 'asking': {k: len(v) for k, v in asks.items()},
                      'alreadyCached': len(teacher.cache)}), flush=True)

    kept, verdicts = {k: [] for k in asks}, {k: {} for k in asks}
    with concurrent.futures.ThreadPoolExecutor(args.workers) as executor:
        for name, items in asks.items():
            for item, reply in zip(items, executor.map(lambda i: teacher.reply(i['question'], i['tools']), items)):
                verdict = 'unanswered'
                if reply is not None:
                    verdict, row = judge(name, item, reply)
                    if row and count(row['messages'], row['tools']) > MAX_TOKENS:
                        verdict, row = 'tooLong', None
                    if row:
                        kept[name].append(row)
                verdicts[name][verdict] = verdicts[name].get(verdict, 0) + 1
    stats['teacherVerdicts'] = verdicts
    stats['buildSeconds'] = round(time.monotonic() - started)
    print(json.dumps(verdicts, indent=1), flush=True)
    if any(v.get('unanswered') for v in verdicts.values()) and not args.deadline_seconds:
        raise SystemExit('Some questions got no reply; run again to ask only those')
    if args.limit:
        return
    stats['kept'] = {k: len(v) for k, v in kept.items()}

    earlier = [json.loads(l) for l in (THIRD / 'train.jsonl').read_text().splitlines() if l.strip()]
    chat = [r for r in earlier if r['head'] == 'chat']
    git = [r for r in earlier if r['head'] == 'git']
    stats['reused'] = {'chat': len(chat), 'git': len(git), 'repeat': REUSED_REPEAT}
    rows = [r for rows in kept.values() for r in rows] + (chat + git) * REUSED_REPEAT
    rng.shuffle(rows)
    rows = first.contract_filter(rows, stats)
    toolcall = [r for r in rows if r['head'] == 'toolcall']
    lengths = lambda calls: sorted(len(r['messages'][0]['content'].split()) for r in toolcall
                                   if bool(r['messages'][-1].get('tool_calls')) == calls)
    stats['questionWordsMedian'] = {'calls': lengths(True)[len(lengths(True)) // 2],
                                    'declines': lengths(False)[len(lengths(False)) // 2]}
    third_spec = json.loads((THIRD / 'manifest.json').read_text())
    manifest = {
        'scope': 'Tool-calling mix v5: GLM-5.3 (Cloudflare Workers AI) writes every call and decline target, '
                 'checked against the source labels; chat and Git rows reused from v3 (v2\'s own replies).',
        'seed': SEED, 'maxTokens': MAX_TOKENS, 'teacher': config['model'], 'teacherSystem': TEACHER_SYSTEM,
        'sources': {'train/data-toolcall-v3': {'dataSha256': third_spec['dataSha256'], 'uses': 'chat rows, Git rows'},
                    'glaiveai/glaive-function-calling-v2': {'license': 'Apache-2.0', 'sha256': first.sha256(args.glaive),
                                                            'uses': 'first-turn questions: single calls, declines'},
                    'NousResearch/hermes-function-calling-v1': {'license': 'Apache-2.0', 'sha256': first.sha256(args.hermes),
                                                                'uses': 'func-calling-singleturn questions that need calls'},
                    'MadeAgents/xlam-irrelevance-7.5k': {'license': 'CC-BY-4.0', 'sha256': first.sha256(args.xlam),
                                                         'uses': 'questions no offered function answers'},
                    'zai-org/GLM-5.3': {'license': 'GLM-5.3 License (MIT-style)', 'uses': 'teacher replies'}},
        'callFilter': "GLM's calls kept only when they name the same functions as the source's calls, every argument "
                      'is declared, every required one is present and no value is null',
        'declineTargets': "GLM's reply when it makes no call, at most 300 characters, no markdown",
        'probeFilter': 'dropped rows offering ' + ', '.join(sorted(third.PROBE_FUNCTIONS)) +
                       ', and the 100 teacher-probe questions',
        'bfclFilter': 'dropped any row sharing an exact question, an 8-word run or a function name with BFCL v4',
        'worldSeeds': third_spec['worldSeeds'], 'sealedInputsUsed': False, 'developmentInputsUsed': False,
        'holdoutInputsUsed': False, 'benchmarkInputsUsed': False}
    first.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    first.write(rows, stats, manifest)


def judge(name, item, reply):
    """('kept' or why not, training row or None) for one GLM reply."""
    if reply['finish'] == 'refused':
        return 'refused', None
    calls, text = reply['calls'], reply['content']
    if name.endswith('decline'):
        if calls:
            return 'called', None
        if reply['finish'] != 'stop' or not text:
            return 'unfinished', None
        if len(text) > second.DECLINE_CHARS or second.MARKDOWN.search(text):
            return 'tooLongOrMarkdown', None
        source = 'MadeAgents/xlam-irrelevance-7.5k' if name == 'xlam-decline' else 'glaiveai/glaive-function-calling-v2'
        return 'kept', {'head': 'toolcall', 'kind': 'irrelevance', 'source': source, 'tools': item['tools'],
                        'messages': [{'role': 'user', 'content': item['question']}, {'role': 'assistant', 'content': text}]}
    if not calls:
        return 'declined', None
    if sorted(c['name'] or '' for c in calls) != sorted(c['name'] for c in item['gold']):
        return 'otherFunctions', None
    if any(not isinstance(c['arguments'], dict) or not third.fits(c, item['tools']) for c in calls):
        return 'badArguments', None
    if any(has_null(c['arguments']) for c in calls):
        return 'nullArgument', None
    source = 'glaiveai/glaive-function-calling-v2' if name == 'glaive-call' else 'NousResearch/hermes-function-calling-v1'
    return 'kept', third.call_row(source, item['tools'], item['question'], calls)


if __name__ == '__main__':
    main()
