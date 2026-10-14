"""Bounded GLM development requests; no commands, file writes or sealed data access by the model."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MODEL = '@cf/zai-org/glm-5.3'


def configuration(environ):
    account = environ.get('CLOUDFLARE_ACCOUNT_ID', '').strip()
    token = environ.get('CLOUDFLARE_API_TOKEN', '').strip()
    if any(ord(char) < 32 for char in token): raise ValueError('Cloudflare token must be a single-line value')
    model = environ.get('CLOUDFLARE_DEVELOPMENT_MODEL', MODEL).strip() or MODEL
    base = environ.get('CLOUDFLARE_DEVELOPMENT_BASE_URL', '').strip()
    missing = [name for name, value in [('CLOUDFLARE_ACCOUNT_ID', account), ('CLOUDFLARE_API_TOKEN', token)] if not value]
    if base:
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme != 'https' or parsed.hostname not in ('api.cloudflare.com', 'gateway.ai.cloudflare.com') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Use an HTTPS Cloudflare API or AI Gateway base URL without credentials/query')
    elif account:
        if not re.fullmatch(r'[a-fA-F0-9]{32}', account): raise ValueError('Cloudflare account ID must contain32 hexadecimal characters')
        base = f'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1'
    return {'base': base.rstrip('/'), 'token': token, 'model': model, 'missing': missing}


def load_request(file):
    resolved = file.resolve()
    forbidden = [ROOT / 'evals/git1', ROOT / 'evals/suite/quality/holdout']
    if file.name.startswith('.env') or any(resolved.is_relative_to(path.resolve()) for path in forbidden):
        raise ValueError('Secrets and sealed/holdout inputs are excluded from development assistance')
    request = json.loads(file.read_text(encoding='utf-8'))
    messages = request.get('messages')
    if not isinstance(messages, list) or not messages or any(not isinstance(item, dict) or item.get('role') not in ('system', 'user', 'assistant') or not isinstance(item.get('content'), str) for item in messages):
        raise ValueError('Input must contain text messages with system/user/assistant roles')
    if sum(len(item['content']) for item in messages) > 64000:
        raise ValueError('Development request exceeds64,000 characters')
    return messages


def request_json(config, messages, maximum=4096, timeout=120):
    if config['missing']: raise ValueError('Missing environment variable names: ' + ', '.join(config['missing']))
    if not 128 <= maximum <= 8192 or not 1 <= timeout <= 180: raise ValueError('Invalid bounded request limits')
    payload = {'model': config['model'], 'messages': messages, 'stream': False,
        'max_completion_tokens': maximum, 'reasoning_effort': 'low',
        'response_format': {'type': 'json_object'}, 'options': {'rejectIfBusy': True}}
    req = urllib.request.Request(config['base'] + '/chat/completions',
        data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'}, method='POST')
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Cloudflare request failed with HTTP{error.code}; check model access/token permissions') from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('Cloudflare request could not complete within its network limit') from None
    choices = result.get('choices')
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError('Cloudflare returned no completion choices')
    content = choices[0].get('message', {}).get('content')
    if not isinstance(content, str) or not content.strip():
        raise ValueError('Cloudflare returned no final text; reasoning may have consumed the bounded output budget')
    try: value = json.loads(content)
    except json.JSONDecodeError: raise ValueError('Cloudflare returned invalid JSON; no draft accepted') from None
    return {'model': result.get('model', config['model']), 'elapsedSeconds': time.monotonic() - started,
        'usage': result.get('usage', {}), 'value': value,
        'scope': 'Development assistance only. Independent review required before use as training or code.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'request'])
    parser.add_argument('--smoke', action='store_true', help='Make one bounded JSON inference request')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--maximum-tokens', type=int, default=4096)
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    load_dotenv(ROOT / '.env')
    config = configuration(os.environ)
    if args.action == 'doctor' and not args.smoke:
        print(json.dumps({'configured': not config['missing'], 'missingNames': config['missing'],
            'model': config['model'], 'networkRequestMade': False})); return
    if args.action == 'doctor':
        messages = [{'role': 'user', 'content': 'Reply with only the JSON object {"ok":true}.'}]
    else:
        if not args.input or not args.output: parser.error('request requires --input and --output')
        messages = load_request(args.input)
    result = request_json(config, messages, args.maximum_tokens, args.timeout)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({key: result[key] for key in ('model', 'elapsedSeconds', 'usage')}))
    else:
        print(json.dumps(result))


if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
