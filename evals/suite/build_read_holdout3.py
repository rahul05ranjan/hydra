"""Third Read holdout (2026-11-20): 2,000 tasks for one aggregate-only scoring, built with the Read gold builder's
own parsers and selection rules, run on a copy of its inputs:
  - real tasks come only from holdout-split source files (inventory label), relabelled holdout3;
  - every (file, name) a first-holdout task anchors on, and every module it outlined, is removed first, so the
    builder (which only picks declared names) cannot pick them again;
  - synthetic fixtures use the first holdout's scenarios with a shifted payload index, so their content differs;
  - question templates are new, written within the Read head's documented question vocabulary.
build_read_quality.py itself is not changed. Run with the parsers it names, e.g.
  python3 -I evals/suite/build_read_holdout3.py
"""
import collections
import inspect
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals/suite"))
import build_read_quality as b  # noqa: E402

SPLIT = "holdout3"
# 1,800 real tasks; each count splits 3/5 symbols, 3/10 ranges, 1/10 outlines. JavaScript has the fewest outline-sized
# modules left once the first holdout's are removed (27), so it takes fewer tasks and the others more.
PER_LANGUAGE = {"python": 510, "javascript": 270, "go": 510, "rust": 510}
b.COUNTS[SPLIT] = 0
b.QUESTIONS[SPLIT] = {
    "symbol": ['show function {symbol} from "{file}"', 'read the code of {symbol} in "{file}"',
               'how does {symbol} work in "{file}"', 'explain {symbol} in "{file}"'],
    "range": ['read lines {lines} in "{file}"', 'show "{file}" from lines {lines}', 'slice lines {lines} of "{file}"'],
    "outline": ['read "{file}" outline', 'outline for "{file}"'],
    "whole": ['read the file "{file}"'],
}
for other in ("development", "holdout"):
    for kind, templates in b.QUESTIONS[other].items():
        assert not set(templates) & set(b.QUESTIONS[SPLIT][kind]), f"template shared with {other}"

_synthetic_content = b.synthetic_content
b.synthetic_content = lambda language, scenario, name, index: _synthetic_content(language, scenario, name, index + 500)
# Several scenarios' content depends only on the definition name, which the builder fixes as frozen_* for every
# non-development split. Load the same function with that one word changed, so names (and content) are new.
_source = inspect.getsource(b.synthetic_tasks)
# The short-name and stop-word scenarios fix their names ("xy", "code"); use another short name and another
# word the Read head treats as a stop word.
for old, new in (("'frozen'", "'third'"), ('name = "xy"', 'name = "qz"'), ('name = "code"', 'name = "file"')):
    assert _source.count(old) == 1, old
    _source = _source.replace(old, new)
exec(compile(_source, b.__file__, "exec"), b.__dict__)


def main():
    inventory = json.loads((ROOT / "evals/suite/source-inventory.json").read_text())
    cache = Path.home() / ".hydra/quality-sources/files"  # the inventory's "cache" names the machine it was built on
    parser = b.GoldParser(Path.home() / ".hydra/quality-parsers")
    first = json.loads((ROOT / "evals/suite/quality/holdout/read.json").read_text())
    used = {(t["sourceRef"]["source"], t["provenance"]["anchorSymbol"]) for t in first if t["provenance"]["origin"] == "real"}
    outlined = {t["sourceRef"]["source"] for t in first if t["provenance"]["origin"] == "real" and t["gold"]["expectedKind"] == "outline"}
    rows = [dict(row, split=SPLIT) for row in inventory["declarations"]
            if row["split"] == "holdout" and (row["source"], row["name"]) not in used and row["source"] not in outlined]
    copy = dict(inventory, declarations=rows)

    diagnostic, tasks = {}, []
    for language in b.LANGUAGES:
        b.COUNTS[SPLIT] = PER_LANGUAGE[language]
        tasks.extend(b.real_tasks(copy, cache, parser, SPLIT, language, diagnostic))
        print(f"{SPLIT}/{language} real tasks complete", file=sys.stderr, flush=True)
    synthetic = b.synthetic_tasks(parser, SPLIT)
    tasks.extend(synthetic)

    # Disjoint from the first holdout: no repeated source/query experiment, anchor or synthetic content.
    def identity(t):
        return (t.get("sourceRef", {}).get("source", t["file"]), json.dumps(t["query"], sort_keys=True))
    first_ids = {identity(t) for t in first if t["provenance"]["origin"] == "real"}
    assert not {identity(t) for t in tasks if t["provenance"]["origin"] == "real"} & first_ids, "repeats a first-holdout experiment"
    assert not {(t["sourceRef"]["source"], t["provenance"]["anchorSymbol"]) for t in tasks if t["provenance"]["origin"] == "real"} & used
    first_content = {t["provenance"]["contentSha256"] for t in first if t["provenance"]["origin"] == "synthetic"} - {b.sha256(b"")}
    assert not {t["provenance"]["contentSha256"] for t in synthetic} & first_content, "synthetic content repeats the first holdout"
    assert len({t["id"] for t in tasks}) == len(tasks) == 2000, len(tasks)
    for t in tasks:
        lines = (t["content"] if "content" in t else (cache / t["sourceRef"]["source"]).read_text()).split("\n")
        if t["gold"].get("sourceLineRange"):
            start, end = t["gold"]["sourceLineRange"]
            assert t["gold"]["targetLines"] == b.numbered(lines, start, end), t["id"]

    payload = b.encode(tasks)
    out = ROOT / "evals/suite/quality" / SPLIT / "read.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(payload)
    manifest = {
        "split": SPLIT, "tasks": len(tasks), "dataSha256": b.sha256(payload),
        "builderSha256": b.sha256(Path(b.__file__).read_bytes()), "scriptSha256": b.sha256(Path(__file__).read_bytes()),
        "kinds": dict(collections.Counter(t["gold"]["expectedKind"] for t in tasks)),
        "languages": dict(collections.Counter(t["language"] for t in tasks)),
        "excludedFirstHoldoutAnchors": len(used), "excludedFirstHoldoutOutlineModules": len(outlined),
        "candidateCoverage": diagnostic, "questionTemplates": b.QUESTIONS[SPLIT],
        "scope": "Third Read holdout for one aggregate-only scoring; failure rows are not read for tuning.",
        "trainingInputsUsed": False, "sealedInputsUsed": False, "developmentInputsUsed": False,
    }
    (out.parent / "read-manifest.json").write_bytes(b.encode(manifest))
    print(json.dumps({key: manifest[key] for key in ("split", "tasks", "dataSha256", "kinds", "languages")}))


if __name__ == "__main__":
    main()
