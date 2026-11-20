"""Third Files holdout (2026-11-20): 2,000 tasks for one aggregate-only scoring, built with the Files builder's own
selection, fixtures and gold, from a frozen data file (evals/suite/quality/holdout3/files-authored.json):
  - 1,680 real declarations, 420 per language, from holdout-split source modules; every name the development or
    first holdout set uses is excluded before selection;
  - 320 authored searches, 40 per family, with terms and wordings written by Cloudflare GLM (glm-5.3), filtered
    for format and for no overlap with earlier terms, then frozen before any scoring.
build_files_quality.py itself is not changed.
  python3 -I evals/suite/build_files_holdout3.py
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals/suite"))
import build_files_quality as f  # noqa: E402

SPLIT = "holdout3"
REAL_PER_LANGUAGE = 420
AUTHORED_PER_FAMILY = 40
DATA = ROOT / "evals/suite/quality/holdout3/files-authored.json"


def main():
    data = json.loads(DATA.read_text())
    inventory = json.loads((ROOT / "evals/suite/source-inventory.json").read_text())
    cache = Path.home() / ".hydra/quality-sources/files"  # the inventory's "cache" names the machine it was built on

    # Replay the earlier splits' selections so their names are excluded, then continue in the holdout modules.
    excluded = {language: set() for language in f.LANGUAGES}
    for split, (real, _) in f.SIZES.items():
        f.select(inventory, split, real, excluded)
    earlier = {split: json.loads((ROOT / f"evals/suite/quality/{split}/files.json").read_text()) for split in f.SIZES}
    for split, tasks in earlier.items():
        assert {t["sourceSymbol"] for t in tasks if t["sourceFiles"]} <= set().union(*excluded.values()), f"{split} replay differs"
    rows = f.select(inventory, "holdout", REAL_PER_LANGUAGE, excluded)

    f.DECLARATION_QUESTIONS[SPLIT] = tuple((f"h3-declaration-{i}", q) for i, q in enumerate(data["declaration"]))
    tasks = [f.definition_task(row, SPLIT, i) for i, row in enumerate(rows)]
    for family in f.AUTHORED:
        for i, entry in enumerate(data["terms"][family][:AUTHORED_PER_FAMILY]):
            task = f.search_task(SPLIT, family, i, tuple(entry) if family == "multiple" else entry)
            terms = list(entry) if family == "multiple" else [entry]
            template = data["search"][family][i % len(data["search"][family])]
            task["question"] = template.format(terms=", ".join("`" + term + "`" for term in terms))
            task["templateFamily"] = f"{SPLIT}-search-{family}-{i % len(data['search'][family])}"
            tasks.append(task)

    # Gold checks, as the builder's validate() does for its own splits.
    index = {(row["source"], row["name"]): row for row in inventory["declarations"]}
    assert len(tasks) == 2000 and len({t["id"] for t in tasks}) == 2000 and len({t["question"] for t in tasks}) == 2000
    texts = {}
    for t in tasks:
        if t["sourceFiles"]:
            logical, ref = next(iter(t["sourceFiles"].items()))
            raw = (cache / ref["source"]).read_bytes()
            assert f.sha(raw) == inventory["files"][ref["source"]] == ref["sha256"], t["id"]
            text = texts.setdefault(ref["source"], raw.decode("utf-8"))
            found = f.declarations(t["language"], text)
            assert found.count((t["sourceSymbol"], t["sourceLine"])) == 1 and sum(n == t["sourceSymbol"] for n, _ in found) == 1, t["id"]
            assert index[(ref["source"], t["sourceSymbol"])]["split"] == "holdout", t["id"]
            assert text.splitlines()[t["sourceLine"] - 1] == t["gold"]["targetDefLine"], t["id"]
        else:
            joined = "\n".join(name + "\n" + value for name, value in t["files"].items())
            for evidence in t["gold"]["requiredText"]:
                if evidence == "(no matches)":
                    assert not any(term.lower() in joined.lower() for term in t["gold"]["expectedTerms"]), t["id"]
                elif re.match(r".+:\d+:", evidence):
                    logical, number, line = evidence.split(":", 2)
                    assert t["files"][logical].splitlines()[int(number) - 1] == line, t["id"]
                else:
                    assert evidence in t["files"], t["id"]
    earlier_symbols = {t["sourceSymbol"] for tasks_ in earlier.values() for t in tasks_ if t["sourceFiles"]}
    assert not {t["sourceSymbol"] for t in tasks if t["sourceFiles"]} & earlier_symbols
    earlier_questions = {t["question"] for tasks_ in earlier.values() for t in tasks_}
    assert not {t["question"] for t in tasks} & earlier_questions

    payload = f.json_bytes(tasks)
    out = ROOT / "evals/suite/quality" / SPLIT / "files.json"
    out.write_bytes(payload)
    manifest = {
        "head": "files", "split": SPLIT, "tasks": len(tasks), "tasksSha256": f.sha(payload),
        "builderSha256": f.sha(Path(f.__file__).read_bytes()), "scriptSha256": f.sha(Path(__file__).read_bytes()),
        "authoredDataSha256": f.sha(DATA.read_bytes()),
        "byFamily": dict(sorted(collections.Counter(t["family"].split("/")[0] + "/" + (t["language"] if t["sourceFiles"] else t["family"].split("/")[1]) for t in tasks).items())),
        "scope": "Third Files holdout for one aggregate-only scoring; failure rows are not read for tuning.",
        "trainingInputsUsed": False, "sealedGitInputsUsed": False, "developmentInputsUsed": False,
    }
    (out.parent / "files.manifest.json").write_bytes(f.json_bytes(manifest))
    print(json.dumps({key: manifest[key] for key in ("split", "tasks", "tasksSha256")}))


if __name__ == "__main__":
    main()
