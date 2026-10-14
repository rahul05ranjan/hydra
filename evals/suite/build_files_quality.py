"""Build independent Files-head development and frozen holdout tasks.

Uses pinned public source declarations plus authored search fixtures. It never
calls a model, executes source files, reads training data, or reads sealed Git
inputs. The QA below checks source/gold integrity, not Hydra's holdout answers.
"""
import argparse
import ast
import collections
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
LANGUAGES = ('python', 'javascript', 'go', 'rust')
SIZES = {'development': (40, 5), 'holdout': (200, 25)}
PATTERNS = {
    'javascript': re.compile(r'^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\('),
    'go': re.compile(r'^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*(?:\[[^]]*\])?\s*\('),
    'rust': re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern\s+"[^"]*")\s+)*fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\('),
}

# Separate question constructions, not punctuation changes to one template.
DECLARATION_QUESTIONS = {
    'development': (
        ('named-declaration', 'Find the declaration of {name}.'),
        ('implementation-location', 'Where does the source declare {name}?'),
        ('source-origin', 'Show the source line that introduces {name}.'),
        ('import-disambiguation', 'Locate {name} itself rather than an import or a call.'),
        ('production-origin', 'Which current source file defines {name}?'),
    ),
    'holdout': (
        ('declaration-evidence', 'I need the declaration line for the identifier `{name}` and its file.'),
        ('declared-versus-mentioned', 'References mention `{name}`. Pinpoint where that routine is declared.'),
        ('origin-review', 'For a code review of `{name}`, identify its defining source location.'),
        ('declaration-navigation', 'Take me to the routine declaration named `{name}`.'),
        ('source-versus-archive', 'Trace `{name}` to its declaration in the active source tree.'),
        ('routine-introduction', 'What source line starts the named routine `{name}`?'),
        ('implementation-evidence', 'Return evidence locating the implementation declaration of `{name}`.'),
    ),
}

AUTHORED = {
    'config': {
        'development': ['cacheExpirySeconds', 'HTTP_BODY_LIMIT', 'retry_backoff_ms', 'feature.audit.enabled', 'session-ttl'],
        'holdout': ['connectTimeoutMs', 'MAX_HEADER_BYTES', 'redirect_budget', 'tls.minimumVersion', 'worker-idle-limit',
                    'acceptQueueCapacity', 'DNS_NEGATIVE_TTL', 'read_buffer_size', 'proxy.trustChain', 'upload-chunk-size',
                    'transactionDeadline', 'TRACE_SAMPLE_RATE', 'compression_threshold', 'auth.clockSkew', 'health-check-path',
                    'paginationWindow', 'SOCKET_KEEPALIVE_MS', 'temporary_file_limit', 'storage.writeMode', 'cors-origin-policy',
                    'replayRetentionHours', 'METRICS_FLUSH_SECONDS', 'scheduler_tick_budget', 'search.tokenizerVersion', 'shutdown-grace-period']},
    'literal': {
        'development': ['E_CACHE_STALE', '/api/v1/sessions', 'application/cbor', 'retry-after', 'urn:local:queue'],
        'holdout': ['E_TLS_HANDSHAKE', '/v2/checkpoints', 'application/problem+json', 'x-request-budget', 'urn:service:journal',
                    'E_QUOTA_EXHAUSTED', '/internal/heartbeat', 'text/event-stream', 'content-security-policy', 'urn:task:lease',
                    'E_RANGE_UNSUPPORTED', '/assets/manifest', 'application/wasm', 'if-modified-since', 'urn:storage:snapshot',
                    'E_SIGNATURE_INVALID', '/oauth/device/code', 'application/x-ndjson', 'x-correlation-id', 'urn:tenant:policy',
                    'E_CURSOR_EXPIRED', '/metrics/readiness', 'multipart/form-data', 'accept-encoding', 'urn:queue:deadletter']},
    'path': {
        'development': ['routing-table.json', 'error catalog.yaml', 'worker_policy.toml', 'compression.rules', 'request_limits.env'],
        'holdout': ['http-adapters.mjs', 'migration plan.sql', 'telemetry_policy.yaml', 'rate-limits.toml', 'lease_registry.py',
                    'blob-layout.json', 'certificate policy.md', 'resolver_cache.go', 'retry_schedule.rs', 'partition-map.csv',
                    'queue-controller.js', 'storage schema.json', 'session_rotation.py', 'health_checks.go', 'device-auth.mjs',
                    'render-pipeline.rs', 'permission matrix.yaml', 'archive_index.toml', 'request_router.ts', 'time-zones.csv',
                    'deployment-hooks.mjs', 'upload protocol.md', 'pool_allocator.rs', 'quota_windows.py', 'region_routes.json']},
    'multiple': {
        'development': [('loadCacheEntry', 'evictCacheEntry'), ('HTTP_PORT', 'HTTPS_PORT'), ('encodePacket', 'decodePacket'),
                        ('QUEUE_DEPTH_LIMIT', 'QUEUE_WAIT_MS'), ('createLease', 'releaseLease')],
        'holdout': [('openJournal', 'closeJournal'), ('TLS_CERT_PATH', 'TLS_KEY_PATH'), ('marshalEnvelope', 'unmarshalEnvelope'),
                    ('READ_WINDOW_BYTES', 'WRITE_WINDOW_BYTES'), ('reserveSlot', 'cancelReservation'),
                    ('beginSnapshot', 'finishSnapshot'), ('AUTH_ISSUER_URL', 'AUTH_AUDIENCE_ID'), ('hashBlob', 'verifyBlob'),
                    ('MAX_ACCEPTORS', 'MIN_ACCEPTORS'), ('publishRecord', 'acknowledgeRecord'),
                    ('parseCheckpoint', 'serializeCheckpoint'), ('POOL_IDLE_COUNT', 'POOL_ACTIVE_COUNT'), ('sendHeartbeat', 'receiveHeartbeat'),
                    ('UPLOAD_BLOCK_BYTES', 'UPLOAD_TOTAL_BYTES'), ('acquirePermit', 'returnPermit'),
                    ('normalizeOrigin', 'validateOrigin'), ('PRIMARY_REGION_ID', 'FALLBACK_REGION_ID'), ('mountPartition', 'unmountPartition'),
                    ('REPLAY_START_OFFSET', 'REPLAY_END_OFFSET'), ('rotateCredential', 'revokeCredential'),
                    ('loadDictionary', 'flushDictionary'), ('TRACE_PARENT_ID', 'TRACE_SPAN_ID'), ('freezeBuffer', 'thawBuffer'),
                    ('RECONNECT_MIN_MS', 'RECONNECT_MAX_MS'), ('scheduleCompaction', 'cancelCompaction')]},
    'empty': {
        'development': ['ObsoleteMailboxRouter', 'MISSING_CACHE_PROBE', 'legacyConnectionIndex', 'removed.codec.flag', 'GhostTaskScheduler'],
        'holdout': ['RetiredTlsNegotiator', 'ABSENT_REPLAY_CURSOR', 'removedBlobAdapter', 'old.telemetry.sink', 'PhantomQuotaLedger',
                    'DeprecatedRegionChooser', 'UNSET_SOCKET_STRATEGY', 'legacyLeaseMigrator', 'obsolete.auth.method', 'MissingSnapshotReader',
                    'WithdrawnDeviceRegistry', 'UNKNOWN_PARTITION_TAG', 'deletedHealthMonitor', 'retired.storage.driver', 'VacantEventBridge',
                    'DiscardedEnvelopeCodec', 'NO_JOURNAL_CANDIDATE', 'goneCompressionIndex', 'removed.proxy.option', 'AbsentPermitTracker',
                    'SupersededOriginPolicy', 'MISSING_TRACE_BACKEND', 'archivedPoolManager', 'retired.queue.class', 'ImaginaryUploadPlanner']},
    'noise': {
        'development': ['ACTIVE_RETRY_POLICY', 'cacheWarmupLimit', 'WORKER_DRAIN_MODE', 'originCheckBudget', 'LEASE_RENEW_WINDOW'],
        'holdout': ['ACTIVE_SOCKET_PROFILE', 'journalMergeBudget', 'CURRENT_TRACE_FORMAT', 'partitionScanLimit', 'UPLOAD_RETRY_WINDOW',
                    'ACTIVE_CERT_POLICY', 'resolverRefreshBudget', 'CURRENT_DEVICE_FLOW', 'checkpointReadLimit', 'QUOTA_RESET_WINDOW',
                    'ACTIVE_BLOB_SCHEMA', 'envelopeDecodeBudget', 'CURRENT_POOL_STRATEGY', 'heartbeatSendLimit', 'REPLAY_PREFETCH_WINDOW',
                    'ACTIVE_PROXY_ROUTE', 'credentialRotateBudget', 'CURRENT_PERMIT_MODE', 'snapshotWriteLimit', 'AUTH_RENEW_WINDOW',
                    'ACTIVE_CACHE_CODEC', 'queueCompactBudget', 'CURRENT_ORIGIN_RULE', 'dictionaryLoadLimit', 'PARTITION_MOVE_WINDOW']},
    'case': {
        'development': ['HTTPParserMode', 'ETagValidator', 'DNSCacheTTL', 'TLSHandshakeState', 'URLRoutePrefix'],
        'holdout': ['HTTP2FrameBudget', 'JSONEnvelopeCodec', 'UTCOffsetPolicy', 'IPv6ScopeLookup', 'QUICPacketWindow',
                    'XMLNamespaceTable', 'SSEReconnectDelay', 'SHA256DigestMode', 'UUIDLeaseKey', 'ALPNProtocolList',
                    'HMACSignatureKey', 'CIDRRouteMatcher', 'TCPKeepAliveCount', 'UTF8DecodePolicy', 'IDNHostnameMode',
                    'JWTClaimFilter', 'PKCS12BundlePath', 'ICMPProbeBudget', 'ASCIIHeaderMode', 'WASMModuleCache',
                    'RSAPublicKeyId', 'OIDCDiscoveryURI', 'PEMCertificateChain', 'CRLFLinePolicy', 'NTLMAuthPhase']},
    'punctuation': {
        'development': ['route[v1]', 'size+budget', 'cache.key', 'status(ready)', 'literal*marker'],
        'holdout': ['header[x-id]', 'retry+ceiling', 'journal.offset', 'lease(active)', 'exact*token',
                    'region{west}', 'quota^limit', 'checkpoint$tag', 'origin|policy', 'trace?sample',
                    'socket[ipv6]', 'upload+chunk', 'auth.issuer', 'snapshot(sealed)', 'literal*cursor',
                    'partition{primary}', 'buffer^count', 'event$label', 'pool|strategy', 'codec?version',
                    'device[trusted]', 'replay+window', 'proxy.route', 'envelope(valid)', 'fixed*pattern']},
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def order(value):
    return sha(('files-quality-v1:' + value).encode())


def declarations(language, text):
    if language == 'python':
        return [(node.name, node.lineno) for node in ast.walk(ast.parse(text))
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    return [(match[1], line + 1) for line, content in enumerate(text.splitlines())
            if (match := PATTERNS[language].match(content))]


def style(row):
    line = row['definition']
    if row['language'] == 'go' and re.match(r'^func\s+\(', line): return 'receiver-method'
    if row['language'] == 'rust':
        for token in ('unsafe', 'async', 'const'):
            if re.search(r'\b' + token + r'\s+fn\b', line): return token + '-routine'
        if line.rstrip().endswith(';'): return 'signature-declaration'
    if line.startswith((' ', '\t')): return 'indented-routine'
    if 'async ' in line: return 'async-routine'
    return 'routine'


def select(inventory, split, count, excluded_names):
    selected = []
    for language in LANGUAGES:
        by_module = collections.defaultdict(list)
        for row in inventory['declarations']:
            if row['split'] == split and row['language'] == language:
                by_module[row['sourceFamily']].append(row)
        for rows in by_module.values(): rows.sort(key=lambda row: order(row['source'] + ':' + row['name']))
        modules = sorted(by_module, key=lambda module: order(split + ':' + language + ':' + module))
        used_names = set().union(*excluded_names.values())
        chosen = []
        # Round robin gives source diversity before adding another symbol from
        # any module. Selection does not inspect Hydra output or hit ranking.
        for depth in range(max(map(len, by_module.values()))):
            for module in modules:
                rows = by_module[module]
                if depth >= len(rows): continue
                row = rows[depth]
                if row['name'] in used_names: continue
                used_names.add(row['name']); chosen.append(row)
                if len(chosen) == count: break
            if len(chosen) == count: break
        if len(chosen) != count: raise ValueError(f'Insufficient unique {split} {language} declarations')
        excluded_names[language].update(row['name'] for row in chosen)
        selected.extend(chosen)
    return selected


def companions(language, name, index):
    extension = {'python': 'py', 'javascript': 'js', 'go': 'go', 'rust': 'rs'}[language]
    imports = {'python': f'from source_module import {name}', 'javascript': f"const {{ {name} }} = require('../stdlib/module');",
               'go': f'// import reference: package uses {name}', 'rust': f'use crate::source_module::{name};'}
    usages = {'python': f'result = {name}(request)', 'javascript': f'processResult({name}(request));',
              'go': f'var result = {name}(request)', 'rust': f'let result = {name}(request);'}
    files = {
        f'app/imports.{extension}': imports[language] + '\n',
        f'app/caller.{extension}': '// Independent caller fixture\n' + usages[language] + '\n',
        'docs/navigation.md': f'# Navigation notes\nThe `{name}` routine is mentioned here; this is documentation.\n',
    }
    if index % 4 == 0:
        files['evals/results/previous.txt'] = f'Archived reference to {name}: outdated evaluation output.\n'
    if index % 4 == 1:
        files['docs/migration.md'] = ''.join(f'{name} appears in migration note {i}.\n' for i in range(24))
    if index % 4 == 2:
        files[f'examples/{name.lower()}-usage.{extension}'] = usages[language] + '\n'
    if index % 4 == 3:
        files['evals/results/archived.js'] = f'function {name}() {{ return "archived-fixture"; }}\n'
    files['package-lock.json'] = json.dumps({'generated': name}) + '\n'
    files['assets/generated.min.js'] = f'function {name}(){{return "generated-noise";}}\n'
    files['assets/generated.js.map'] = json.dumps({'names': [name]}) + '\n'
    return files


def definition_task(row, split, index):
    main_file = 'src/stdlib/' + row['source'].split('/', 1)[1]
    template, question = DECLARATION_QUESTIONS[split][index % len(DECLARATION_QUESTIONS[split])]
    fixtures = companions(row['language'], row['name'], index)
    return {
        'id': f'files-{split}-declaration-{row["language"]}-{index:04d}',
        'family': 'declaration/' + row['language'] + '/' + style(row),
        'language': row['language'], 'query': row['name'], 'question': question.format(name=row['name']),
        'templateFamily': template, 'sourceFamily': row['sourceFamily'], 'sourceSymbol': row['name'], 'sourceLine': row['line'],
        'files': fixtures, 'sourceFiles': {main_file: {'source': row['source'], 'sha256': row['sourceSha256']}},
        'gold': {'expectedDefFile': main_file, 'targetDefLine': row['definition'], 'expectedTerms': [row['name']],
                 'forbiddenFiles': ['package-lock.json', 'assets/generated.min.js', 'assets/generated.js.map']},
    }


def assignment(term, index):
    """Different formats and line positions; same literal-search contract."""
    variant = index % 6
    if variant == 0: return 'config/runtime.json', '{\n  "description": "runtime options",\n  ' + json.dumps(term) + ': 4096\n}\n', f'  {json.dumps(term)}: 4096'
    if variant == 1: return 'config/server.toml', '# Server configuration\n[server]\n' + json.dumps(term) + ' = 30\n', json.dumps(term) + ' = 30'
    if variant == 2: return 'config/worker.yaml', 'worker:\n  enabled: true\n  ' + json.dumps(term) + ': 64\n', '  ' + json.dumps(term) + ': 64'
    if variant == 3: return 'src/options.js', '// Application options\nconst options = {\n  ' + json.dumps(term) + ': true,\n};\n', '  ' + json.dumps(term) + ': true,'
    if variant == 4: return 'src/options.py', '# Application settings\nOPTIONS = {\n    ' + repr(term) + ': 120,\n}\n', '    ' + repr(term) + ': 120,'
    return 'config/limits.ini', '; Application limits\n[runtime]\n' + term + '=512\n', term + '=512'


def search_task(split, family, index, entry):
    prefix = 'files-' + split + '-' + family + '-' + f'{index:02d}'
    terms = list(entry) if family == 'multiple' else [entry]
    files = {'README.md': '# Service workspace\nSource and configuration live in this tree.\n'}
    required, forbidden = [], []
    gold = {'mode': 'search', 'requiredText': required, 'forbiddenText': forbidden, 'expectedTerms': terms}
    if family in ('config', 'noise', 'case'):
        target, content, line = assignment(entry, index)
        files[target] = content; required.append(f'{target}:{content.splitlines().index(line) + 1}:{line}')
        if family == 'noise':
            for target_noise in ('package-lock.json', 'assets/bundle.min.js', 'assets/bundle.js.map', 'deps.lock'):
                marker = 'GENERATED_' + prefix.replace('-', '_')
                files[target_noise] = json.dumps({'name': entry, 'marker': marker}) + '\n'
                forbidden.append(marker)
        if family == 'case':
            line_lower = 'const lowerCaseReference = ' + json.dumps(entry.lower()) + ';'
            files['src/case-reference.js'] = line_lower + '\n'
            required.append('src/case-reference.js:1:' + line_lower)
    elif family in ('literal', 'punctuation'):
        target = ('src/protocol.py', 'src/errors.js', 'data/messages.json', 'config/routes.toml', 'src/headers.go')[index % 5]
        line = '    ' + json.dumps(entry) + ','
        content = '// Literal registry\n// Values are matched as fixed strings\n' + line + '\n'
        files[target] = content; required.append(target + ':3:' + line)
        if family == 'punctuation':
            # A regexp-looking term must not widen the match to this near miss.
            near = re.sub(r'[^\w]', '_', entry)
            files['src/near-miss.txt'] = 'NEAR_MISS_' + near + '\n'
            forbidden.append('NEAR_MISS_' + near)
    elif family == 'path':
        target = ('config/', 'docs/', 'src/adapters/', 'resources/', 'src/core/')[index % 5] + entry
        files[target] = 'Artifact payload without its own file name.\n'
        required.append(target)
    elif family == 'multiple':
        for side, term in enumerate(terms):
            target = f'src/part-{side}.js'
            line = f'export const {term} = "registered";'
            files[target] = '// Service API registry\n' + line + '\n'
            required.append(target + ':2:' + line)
    elif family == 'empty':
        files['src/available.js'] = 'export const CurrentDispatcher = "available";\n'
        required.append('(no matches)')
    else: raise ValueError(f'Unknown family: {family}')

    shown = ', '.join('`' + term + '`' for term in terms)
    if split == 'development':
        prompts = {
            'config': 'Find the configuration key {terms}.', 'literal': 'Show occurrences of the literal {terms}.',
            'path': 'Find the file named {terms}.', 'multiple': 'Locate both {terms} in the source.',
            'empty': 'Search for {terms}.', 'noise': 'Find active configuration mentions of {terms}.',
            'case': 'Locate mentions of {terms}; keep the search term case as written.',
            'punctuation': 'Find the exact literal text {terms}, including punctuation.',
        }
    else:
        prompts = {
            'config': 'Which repository lines contain the setting spelled {terms}?',
            'literal': 'I am tracing the literal token {terms}; return its matching source evidence.',
            'path': 'Resolve {terms} to a repository path without guessing from the file content.',
            'multiple': 'Collect evidence for each of these separately named symbols: {terms}.',
            'empty': 'Check the tree for the named item {terms} and return the search evidence.',
            'noise': 'Give me current editable-source matches for {terms}, with generated artifacts filtered out.',
            'case': 'Search the identifier {terms} verbatim, preserving its capitalization in the terms you choose.',
            'punctuation': 'Treat {terms} as a fixed string and locate it without interpreting any character as a wildcard.',
        }
    return {'id': prefix, 'family': 'search/' + family, 'language': 'mixed', 'query': ' '.join(terms),
            'question': prompts[family].format(terms=shown), 'templateFamily': split + '-search-' + family,
            'files': files, 'sourceFiles': {}, 'gold': gold}


def build(inventory):
    result = {}
    excluded = {language: set() for language in LANGUAGES}
    for split, (real_count, synthetic_count) in SIZES.items():
        rows = select(inventory, split, real_count, excluded)
        tasks = [definition_task(row, split, i) for i, row in enumerate(rows)]
        tasks.extend(search_task(split, family, i, entry)
                     for family, values in AUTHORED.items() for i, entry in enumerate(values[split][:synthetic_count]))
        result[split] = tasks
    return result


def validate(inventory, tasks_by_split):
    cache = Path(inventory['cache']).resolve()
    index = {(row['source'], row['name']): row for row in inventory['declarations']}
    sources = {}
    families, templates = {}, {}
    statistics = {}
    all_ids = set()
    for split, tasks in tasks_by_split.items():
        real_count, synthetic_count = SIZES[split]
        if len(tasks) != real_count * 4 + synthetic_count * len(AUTHORED): raise ValueError('Incorrect task count')
        families[split], templates[split] = set(), set()
        selected_symbols, seen_questions = set(), set()
        late_definitions = 0
        for task in tasks:
            if task['id'] in all_ids: raise ValueError('Duplicate task id')
            all_ids.add(task['id'])
            if task['question'] in seen_questions: raise ValueError('Duplicate question')
            seen_questions.add(task['question']); templates[split].add(task['templateFamily'])
            for name in [*task['files'], *task['sourceFiles']]:
                if Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('Unsafe logical path')
            if task['sourceFiles']:
                if len(task['sourceFiles']) != 1: raise ValueError('Unexpected source count')
                logical, reference = next(iter(task['sourceFiles'].items()))
                key = reference['source']
                if key not in sources:
                    actual = (cache / key).resolve()
                    if not actual.is_relative_to(cache): raise ValueError('Source path escaped cache')
                    raw = actual.read_bytes()
                    if sha(raw) != inventory['files'][key]: raise ValueError('Source cache hash mismatch')
                    text = raw.decode('utf-8')
                    sources[key] = (text, declarations(task['language'], text))
                text, found = sources[key]
                name = task['sourceSymbol']
                if name in selected_symbols: raise ValueError('Repeated source symbol within split')
                selected_symbols.add(name)
                if found.count((name, task['sourceLine'])) != 1 or sum(n == name for n, _ in found) != 1:
                    raise ValueError('Source declaration is not uniquely identified')
                row = index[(key, name)]
                if row['split'] != split or row['sourceFamily'] != task['sourceFamily']: raise ValueError('Wrong module split')
                families[split].add(task['sourceFamily'])
                gold = task['gold']
                if reference['sha256'] != row['sourceSha256'] or reference['sha256'] != inventory['files'][key]:
                    raise ValueError('Reference hash mismatch')
                if logical != gold['expectedDefFile'] or text.splitlines()[task['sourceLine'] - 1] != gold['targetDefLine']:
                    raise ValueError('Declaration gold is not the authentic source line')
                occurrences = [i + 1 for i, line in enumerate(text.splitlines()) if name.lower() in line.lower()]
                late_definitions += task['sourceLine'] not in occurrences[:3]
            else:
                joined = '\n'.join(name + '\n' + value for name, value in task['files'].items())
                gold = task['gold']
                for evidence in gold['requiredText']:
                    if evidence == '(no matches)':
                        if any(term.lower() in joined.lower() for term in gold['expectedTerms']): raise ValueError('Nonempty empty-result gold')
                    elif re.match(r'.+:\d+:', evidence):
                        logical, number, line = evidence.split(':', 2)
                        if task['files'][logical].splitlines()[int(number) - 1] != line: raise ValueError('Search gold line mismatch')
                    elif evidence not in task['files']: raise ValueError('Filename gold missing')
        counts = collections.Counter(task['language'] for task in tasks if task['sourceFiles'])
        if counts != {language: real_count for language in LANGUAGES}: raise ValueError('Incorrect language coverage')
        statistics[split] = {'tasks': len(tasks), 'realDeclarations': sum(counts.values()), 'authoredSearchCases': synthetic_count * len(AUTHORED),
                             'sourceModules': len(families[split]), 'goldSourceValidationPassed': True,
                             'definitionAfterFirstThreeLiteralMatches': late_definitions}
    if families['development'] & families['holdout']: raise ValueError('Cross-split source module leakage')
    if templates['development'] & templates['holdout']: raise ValueError('Cross-split question template leakage')
    return statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=ROOT / 'evals/suite/source-inventory.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'evals/suite/quality')
    parser.add_argument('--check', action='store_true', help='Validate existing gold and byte-identical rebuild without writing')
    args = parser.parse_args()
    inventory_raw = args.inventory.read_bytes()
    inventory = json.loads(inventory_raw)
    tasks = build(inventory)
    statistics = validate(inventory, tasks)
    for split, rows in tasks.items():
        target = args.output / split / 'files.json'
        payload = json_bytes(rows)
        source_refs = {reference['source']: reference['sha256'] for task in rows for reference in task['sourceFiles'].values()}
        manifest = {
            'head': 'files', 'split': split, 'scope': 'Pinned real-source declarations and independently authored searches; gold QA only, no accuracy claim.',
            'trainingInputsUsed': False, 'sealedGitInputsUsed': False, 'modelCalls': 0, 'tasksSha256': sha(payload),
            'builderSha256': sha(Path(__file__).read_bytes()), 'inventorySha256': sha(inventory_raw),
            'counts': statistics[split], 'byFamily': dict(sorted(collections.Counter(task['family'] for task in rows).items())),
            'questionTemplateFamilies': sorted({task['templateFamily'] for task in rows}),
            'byLanguage': dict(sorted(collections.Counter(task['language'] for task in rows).items())),
            'sourceProvenance': {'archives': inventory['archives'], 'files': dict(sorted(source_refs.items()))},
            'independence': {'wholeSourceModulesSplit': True, 'questionTemplatePoolsDisjoint': True,
                             'sourceSymbolsUniqueWithinSplit': True, 'selectionUsesHeadOutputs': False},
        }
        manifest_payload = json_bytes(manifest)
        manifest_target = target.with_name('files.manifest.json')
        if args.check:
            if target.read_bytes() != payload or manifest_target.read_bytes() != manifest_payload: raise ValueError(f'{split} rebuild mismatch')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload); manifest_target.write_bytes(manifest_payload)
        print(json.dumps({'split': split, **statistics[split], 'tasksSha256': sha(payload), 'checkOnly': args.check}))


if __name__ == '__main__': main()
