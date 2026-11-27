"""Check a Cloudflare Workers AI model as a distillation teacher before building any data from it.

Sends questions with known answers from the tool-calling training sources (no BFCL, development, held-out
or sealed input) and scores the teacher's reply:
  - call rows (NousResearch/hermes-function-calling-v1, func-calling-singleturn): the dataset's calls,
    kept only when every call names an offered function with declared parameters. Right decision = any
    call; exact = the same calls (name and arguments, order ignored).
  - decline rows (MadeAgents/xlam-irrelevance-7.5k): no offered function fits. Right decision = no call.

Usage: python train/teacher_probe.py --hermes <func-calling-singleturn.json> --xlam <xlam-7.5k-irrelevancek.json>
         --out evals/results/teacher-probe-<model>.json [--calls 50] [--declines 50] [--model @cf/zai-org/glm-5.3]
         [--local http://127.0.0.1:<port>] [--workers 2]   (4 workers hit Cloudflare's per-minute limit)
"""
import argparse
import collections
import concurrent.futures
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'train'))
from build_toolcall_data import xlam_tool  # noqa: E402
from cloudflare_dev import configuration  # noqa: E402

SEED = 20261126


def hermes_calls(path):
    rows = []
    for row in json.load(open(path)):
        tools = json.loads(row['tools']) if isinstance(row['tools'], str) else row['tools']
        human = next(m['value'] for m in row['conversations'] if m['from'] == 'human')
        reply = next(m['value'] for m in row['conversations'] if m['from'] == 'gpt')
        schemas = {t['function']['name']: set((t['function'].get('parameters') or {}).get('properties', {})) for t in tools}
        try:
            calls = [json.loads(b) for b in re.findall(r'<tool_call>\s*(.*?)\s*</tool_call>', reply, re.DOTALL)]
        except ValueError:
            continue
        if calls and all(c.get('name') in schemas and isinstance(c.get('arguments'), dict)
                         and set(c['arguments']) <= schemas[c['name']] for c in calls):
            rows.append({'kind': 'call', 'source': 'hermes', 'question': human, 'tools': tools, 'gold': calls})
    return rows


def xlam_declines(path):
    rows = []
    for row in json.load(open(path)):
        answers = json.loads(row['answers']) if isinstance(row['answers'], str) else row['answers']
        tools = [xlam_tool(t) for t in json.loads(row['tools'])]
        if not answers and tools:
            rows.append({'kind': 'decline', 'source': 'xlam-irrelevance', 'question': row['query'], 'tools': tools, 'gold': []})
    return rows


def norm(value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return norm(json.loads(text)) if text[:1] in '[{' else text.lower()
        except ValueError:
            return text.lower()
    if isinstance(value, list):
        return [norm(v) for v in value]
    if isinstance(value, dict):
        return {k: norm(v) for k, v in sorted(value.items())}
    return value


def call_key(call):
    args = call.get('arguments')
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            pass
    return json.dumps({'name': call.get('name'), 'arguments': norm(args)}, sort_keys=True)


def ask(config, row, retries=8):
    payload = {'model': config['model'], 'messages': [{'role': 'user', 'content': row['question']}],
               'tools': row['tools'], 'tool_choice': 'auto', 'temperature': 0, 'stream': False,
               'max_completion_tokens': 2048, 'reasoning_effort': 'low'}
    if config['token'] == 'local':  # Hydra serves Qwen3.5 with thinking off
        payload['chat_template_kwargs'] = {'enable_thinking': False}
    request = urllib.request.Request(config['base'] + '/chat/completions', data=json.dumps(payload).encode(),
                                     headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'},
                                     method='POST')
    for attempt in range(retries):
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = json.load(response)
            return body, round(time.monotonic() - started, 2), None
        except urllib.error.HTTPError as error:
            detail = f'HTTP {error.code}: {error.read()[:300].decode(errors="replace")}'
            if error.code == 429:  # per-minute request limit: wait for the window to pass
                time.sleep(20 + 10 * attempt)
                continue
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            detail = f'{type(error).__name__}: {error}'
        time.sleep(2 * (attempt + 1))
    return None, None, detail


def score(row, body, seconds, error):
    out = {'kind': row['kind'], 'source': row['source'], 'question': row['question'], 'gold': row['gold'], 'seconds': seconds}
    if error:
        return {**out, 'error': error}
    message = body['choices'][0]['message']
    calls = [{'name': c['function']['name'], 'arguments': c['function'].get('arguments')}
             for c in message.get('tool_calls') or []]
    out.update(content=message.get('content'), calls=calls, finish=body['choices'][0].get('finish_reason'),
               usage=body.get('usage'))
    out['decisionRight'] = bool(calls) == (row['kind'] == 'call')
    if row['kind'] == 'call':
        out['exact'] = collections.Counter(map(call_key, calls)) == collections.Counter(map(call_key, row['gold']))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hermes', required=True)
    parser.add_argument('--xlam', required=True)
    parser.add_argument('--calls', type=int, default=50)
    parser.add_argument('--declines', type=int, default=50)
    parser.add_argument('--model')
    parser.add_argument('--local', help='OpenAI-compatible local server (for example llama-server --jinja) in place of Cloudflare')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--out', required=True, help='for example evals/results/teacher-probe-glm-5.3.json')
    args = parser.parse_args()
    if args.local:
        config = {'base': args.local.rstrip('/') + '/v1', 'token': 'local', 'model': args.model or 'local', 'missing': []}
    else:
        from dotenv import load_dotenv
        load_dotenv(ROOT / '.env')
        config = configuration(os.environ)
        if args.model:
            config['model'] = args.model
    if config['missing']:
        raise SystemExit('Missing environment variable names: ' + ', '.join(config['missing']))
    rng = random.Random(SEED)
    calls, declines = hermes_calls(args.hermes), xlam_declines(args.xlam)
    rows = rng.sample(calls, args.calls) + rng.sample(declines, args.declines)
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        results = list(pool.map(lambda r: score(r, *ask(config, r)), rows))
    done = [r for r in results if 'error' not in r]
    summary = {'model': config['model'], 'seed': SEED, 'elapsedSeconds': round(time.monotonic() - started, 1),
               'errors': len(results) - len(done)}
    for kind in ('call', 'decline'):
        part = [r for r in done if r['kind'] == kind]
        summary[kind] = {'tasks': sum(r['kind'] == kind for r in results), 'decisionRight': sum(r['decisionRight'] for r in part)}
        if kind == 'call':
            summary[kind]['exact'] = sum(r['exact'] for r in part)
    usage = [r['usage'] for r in done if r.get('usage')]
    summary['tokens'] = {k: sum(u.get(k) or 0 for u in usage) for k in ('prompt_tokens', 'completion_tokens')}
    Path(args.out).write_text(json.dumps({'summary': summary, 'rows': results}, indent=1) + '\n')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
