"""Score raw development plans; this is not an end-to-end or sealed score."""
import json
from pathlib import Path
import sys


def matches(probe, accepted):
    if not isinstance(probe, dict) or probe.get('probe') != accepted['probe']:
        return False
    for key, expected in accepted.get('args', {}).items():
        if key == 'nMin':
            count = probe.get('n', 15)
            if not isinstance(count, (int, float)) or count < expected:
                return False
        else:
            choices = expected if isinstance(expected, list) else [expected]
            default = False if key == 'staged' else None
            if str(probe.get(key, default)).lower() not in [str(value).lower() for value in choices]:
                return False
    return True


def score(content, accepted):
    try:
        reply = json.loads(content)
        probes = reply['probes']
        if not isinstance(probes, list):
            raise ValueError('Invalid probes')
        return {'valid': True, 'correct': any(matches(probe, want) for probe in probes for want in accepted)}
    except (ValueError, KeyError, TypeError):
        return {'valid': False, 'correct': False}


def main(file):
    report = json.loads(Path(file).read_text())
    results = []
    for row in report['rows']:
        results.append({'intent': row['intent'], 'original': score(row['original'], row['accept']),
                        'gguf': score(row['gguf']['message']['content'], row['accept'])})
    summary = {'developmentOnly': True, 'metric': 'raw planning, not end-to-end accuracy', 'tasks': len(results),
               'sourceRevision': report['sourceRevision'], 'rows': results}
    for backend in ['original', 'gguf']:
        summary[backend] = {key: sum(row[backend][key] for row in results) for key in ['valid', 'correct']}
    destination = Path(file).with_name('diagnosis-summary.json')
    destination.write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({key: value for key, value in summary.items() if key != 'rows'}, indent=2))


if __name__ == '__main__':
    main(sys.argv[1])
