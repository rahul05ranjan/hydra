"""Cache pinned public source releases and inventory real declarations for head evals.

No model calls, training or sealed inputs. Source files are data, never executed.
"""
import ast
import collections
import hashlib
import json
from pathlib import Path
import re
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path.home() / '.hydra/quality-sources'
SPECS = {
    'python': ('cpython-3.13.5', 'https://codeload.github.com/python/cpython/tar.gz/refs/tags/v3.13.5', 'cpython-3.13.5/Lib/', '.py'),
    'javascript': ('node-22.16.0', 'https://codeload.github.com/nodejs/node/tar.gz/refs/tags/v22.16.0', 'node-22.16.0/lib/', '.js'),
    'go': ('go-1.24.4', 'https://codeload.github.com/golang/go/tar.gz/refs/tags/go1.24.4', 'go-go1.24.4/src/', '.go'),
    'rust': ('rust-1.88.0', 'https://codeload.github.com/rust-lang/rust/tar.gz/refs/tags/1.88.0', 'rust-1.88.0/library/', '.rs'),
}
PATTERNS = {
    'javascript': re.compile(r'^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\('),
    'go': re.compile(r'^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*(?:\[[^]]*\])?\s*\('),
    'rust': re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern\s+"[^"]*")\s+)*fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\('),
}


def sha(data): return hashlib.sha256(data).hexdigest()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    output = ROOT / 'evals/suite/source-inventory.json'
    previous = json.loads(output.read_text()) if output.exists() else None
    archives, files, declarations = {}, {}, []
    for language, (release, url, prefix, extension) in SPECS.items():
        archive = CACHE / (release + '.tar.gz')
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as destination:
                while block := response.read(1024 * 1024): destination.write(block)
        archive_hash = sha(archive.read_bytes())
        if previous and previous['archives'][language]['sha256'] != archive_hash:
            raise ValueError(f'Pinned source archive changed: {release}')
        archives[language] = {'release': release, 'url': url, 'sha256': archive_hash}
        count = 0
        with tarfile.open(archive) as bundle:
            for member in sorted(bundle.getmembers(), key=lambda item: item.name):
                if not member.isfile() or not member.name.startswith(prefix) or not member.name.endswith(extension): continue
                relative = member.name[len(prefix):]
                if any(part in ('test', 'tests', 'testdata', 'fixtures', 'vendor') for part in Path(relative).parts) or relative.endswith('_test.go'): continue
                content = bundle.extractfile(member).read()
                if len(content) > 512 * 1024: continue
                try: text = content.decode('utf-8')
                except UnicodeDecodeError: continue
                key = release + '/' + relative
                destination = (CACHE / 'files' / key).resolve()
                if not destination.is_relative_to((CACHE / 'files').resolve()): raise ValueError('Source path escaped cache')
                destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(content)
                files[key] = sha(content)
                lines = text.splitlines()
                if language == 'python':
                    try: tree = ast.parse(text)
                    except SyntaxError: continue
                    found = [(node.name, node.lineno, node.end_lineno) for node in ast.walk(tree)
                             if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
                else:
                    found = [(match[1], i + 1, None) for i, line in enumerate(lines)
                             if (match := PATTERNS[language].match(line))]
                duplicates = collections.Counter(item[0] for item in found)
                found = [item for item in found if duplicates[item[0]] == 1 and 3 <= len(item[0]) <= 60]
                # Split whole source modules, never neighboring functions, between development and holdout.
                split = 'development' if int(sha(key.encode())[:8], 16) % 5 == 0 else 'holdout'
                for name, line, end in found:
                    declarations.append({'language': language, 'source': key, 'sourceFamily': key,
                        'split': split, 'name': name, 'line': line, 'endLine': end,
                        'definition': lines[line - 1], 'sourceSha256': files[key]})
                    count += 1
        print(json.dumps({'language': language, 'declarations': count, 'archiveSha256': archive_hash}), flush=True)
    counts = {split: dict(collections.Counter(row['language'] for row in declarations if row['split'] == split))
              for split in ('development', 'holdout')}
    result = {'scope': 'Independent real source declarations, whole-module split; not model accuracy or release proof.',
        'trainingInputsUsed': False, 'sealedInputsUsed': False, 'cache': str(CACHE / 'files'),
        'archives': archives, 'files': files, 'counts': counts, 'declarations': declarations}
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(files), 'counts': counts}))


if __name__ == '__main__': main()
