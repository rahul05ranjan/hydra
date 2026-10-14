#!/usr/bin/env python3
"""Build independent Read development/holdout gold; never calls Hydra or a model.

Real source comes only from source-inventory.json's pinned whole-module splits.
Python gold uses stdlib ast; JS/TS/Go/Rust gold uses pinned tree-sitter grammars.
Install the parser wheels explicitly into an isolated directory before running:
  python -m pip install --target ~/.hydra/quality-parsers tree-sitter==0.25.2 \
    tree-sitter-javascript==0.23.1 tree-sitter-typescript==0.23.2 \
    tree-sitter-go==0.25.0 tree-sitter-rust==0.24.0
The builder downloads nothing and imports no production Read/slicing code.
"""

from __future__ import annotations

import argparse
import ast
import collections
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys
from dataclasses import dataclass


ROOT = Path(__file__).resolve().parents[2]
LANGUAGES = ("python", "javascript", "go", "rust")
SYNTHETIC_LANGUAGES = (*LANGUAGES, "typescript")
VERSIONS = {
    "tree-sitter": "0.25.2",
    "tree-sitter-javascript": "0.23.1",
    "tree-sitter-typescript": "0.23.2",
    "tree-sitter-go": "0.25.0",
    "tree-sitter-rust": "0.24.0",
}
EXTENSIONS = {"python": "py", "javascript": "js", "typescript": "ts", "go": "go", "rust": "rs"}
COUNTS = {"development": 40, "holdout": 200}
# These question-template families were authored for this corpus. Splits do not
# share a template string; only documented gather vocabulary is used.
QUESTIONS = {
    "development": {
        "symbol": ['show {symbol} in "{file}"', 'read "{file}" at function {symbol}'],
        "range": ['read "{file}" lines {lines}', 'show code from "{file}" lines {lines}'],
        "outline": ['outline "{file}"', 'show outline of "{file}"'],
        "whole": ['read "{file}"'],
    },
    "holdout": {
        "symbol": ['slice "{file}" from {symbol}', 'where function {symbol} defined in "{file}"',
                   'show the code of {symbol} from "{file}"'],
        "range": ['slice "{file}" at lines {lines}', 'show the lines {lines} of "{file}"',
                  'read code in "{file}" from lines {lines}'],
        "outline": ['show the outline from "{file}"', 'read the outline in "{file}"'],
        "whole": ['show the file "{file}"'],
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_rank(value: str) -> str:
    return sha256(value.encode("utf-8"))


def encode(value) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


@dataclass(frozen=True)
class Definition:
    name: str
    start: int
    end: int
    top: bool
    kind: str
    header: int | None = None


class GoldParser:
    def __init__(self, parser_path: Path):
        sys.path.insert(0, str(parser_path))
        from tree_sitter import Language, Parser
        import tree_sitter_javascript
        import tree_sitter_typescript
        import tree_sitter_go
        import tree_sitter_rust
        self.parsers = {
            "javascript": Parser(Language(tree_sitter_javascript.language())),
            "typescript": Parser(Language(tree_sitter_typescript.language_typescript())),
            "go": Parser(Language(tree_sitter_go.language())),
            "rust": Parser(Language(tree_sitter_rust.language())),
        }
        self.versions = {name: importlib.metadata.version(name) for name in VERSIONS}
        if self.versions != VERSIONS:
            raise ValueError(f"Parser version mismatch: {self.versions}")

    def definitions(self, content: str, language: str) -> list[Definition]:
        if language == "python":
            tree = ast.parse(content)
            result = []

            def visit(node, top):
                for child in ast.iter_child_nodes(node):
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        start = min([child.lineno] + [x.lineno for x in child.decorator_list])
                        kind = "class" if isinstance(child, ast.ClassDef) else "function"
                        result.append(Definition(child.name, start, child.end_lineno, top, kind, child.lineno))
                        visit(child, False)
                    else:
                        visit(child, top and isinstance(node, ast.Module))

            visit(tree, True)
            # Only direct module children belong to an outline. Conditional and
            # nested definitions are symbol targets but not top-level entries.
            direct = {id(x) for x in tree.body}
            top_spans = {(x.name, min([x.lineno] + [d.lineno for d in x.decorator_list]))
                         for x in tree.body if id(x) in direct and
                         isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
            return [Definition(x.name, x.start, x.end, (x.name, x.start) in top_spans, x.kind, x.header) for x in result]

        data = content.encode("utf-8")
        tree = self.parsers[language].parse(data)
        if tree.root_node.has_error:
            raise ValueError(f"{language} grammar rejected source")
        types = {
            "javascript": {"function_declaration", "generator_function_declaration", "class_declaration", "method_definition", "variable_declarator"},
            "typescript": {"function_declaration", "generator_function_declaration", "class_declaration", "method_definition", "variable_declarator", "interface_declaration", "type_alias_declaration", "enum_declaration"},
            "go": {"function_declaration", "method_declaration", "type_spec", "type_alias"},
            "rust": {"function_item", "struct_item", "enum_item", "trait_item", "type_item"},
        }[language]
        result = []

        def walk(node):
            if node.type in types:
                name = node.child_by_field_name("name")
                if name is not None:
                    text = data[name.start_byte:name.end_byte].decode("utf-8")
                    parent = node.parent
                    if language in ("javascript", "typescript"):
                        if parent and parent.type in ("lexical_declaration", "variable_declaration", "export_statement"):
                            parent = parent.parent
                        if parent and parent.type == "export_statement":
                            parent = parent.parent
                    elif language == "go" and parent and parent.type == "type_declaration":
                        parent = parent.parent
                    top = bool(parent and parent.type in ("program", "source_file"))
                    end = node.end_point.row + (1 if node.end_point.column else 0)
                    kind = "function" if node.type in ("function_declaration", "method_declaration", "function_item", "method_definition", "generator_function_declaration") else "type"
                    if node.type == "variable_declarator":
                        value = node.child_by_field_name("value")
                        kind = "function" if value and value.type in ("arrow_function", "function_expression") else "binding"
                    result.append(Definition(text, node.start_point.row + 1, end, top, kind))
            for child in node.named_children:
                walk(child)

        walk(tree.root_node)
        return result


def numbered(lines: list[str], start: int, end: int) -> list[str]:
    # The final empty numbered line is printed as "N:" after answer.trimEnd().
    # Its line identity must still be required, without an impossible trailing
    # formatting space. CR is a line terminator, not source content.
    return [(f"{i}: {lines[i - 1].rstrip(chr(13))}" if lines[i - 1].strip() else f"{i}:") for i in range(start, end + 1)]


def docs_start(lines: list[str], start: int, language: str) -> int:
    """Documentation is allowed context, not mandatory gold copied from Hydra."""
    position = start
    while position > 1:
        text = lines[position - 2].lstrip()
        if text.startswith(("#", "//", "/*", "*", "@")):
            position -= 1
        else:
            break
    return position


def fits_citations(lines: list[str], start: int, end: int) -> bool:
    return 1 <= start <= end <= len(lines) and end - start < 12 and all(len(f"{i}: {lines[i - 1]}") <= 190 for i in range(start, end + 1))


def boundary_forbidden(lines: list[str], allowed: list[int], definitions: list[Definition]) -> list[str]:
    permitted = set(allowed)
    candidates = {x.start for x in definitions}
    if allowed:
        candidates.update(range(max(1, min(allowed) - 3), min(len(lines), max(allowed) + 3) + 1))
    return [f"{i}: {lines[i - 1]}" for i in sorted(candidates) if i not in permitted and lines[i - 1].strip()]


def question(split: str, kind: str, index: int, file: str, query: dict) -> tuple[str, str]:
    templates = QUESTIONS[split][kind]
    template_index = index % len(templates)
    return (templates[template_index].format(file=file, **query), f"{split}-{kind}-wording-{template_index}")


def real_tasks(inventory: dict, cache: Path, parser: GoldParser, split: str, language: str, diagnostic: dict) -> list[dict]:
    wanted = COUNTS[split]
    quotas = {"symbol": wanted * 3 // 5, "range": wanted * 3 // 10, "outline": wanted // 10}
    grouped = collections.defaultdict(list)
    for row in inventory["declarations"]:
        if row["split"] == split and row["language"] == language:
            grouped[row["source"]].append(row)
    pools = {key: [] for key in quotas}
    sources = {}
    exclusions = collections.Counter()
    for key, declared in sorted(grouped.items(), key=lambda item: stable_rank(item[0])):
        data = (cache / key).read_bytes()
        expected_hash = inventory["files"][key]
        if sha256(data) != expected_hash:
            raise ValueError(f"Pinned source hash mismatch: {key}")
        content = data.decode("utf-8")
        lines = content.split("\n")
        try:
            definitions = parser.definitions(content, language)
        except (SyntaxError, ValueError):
            exclusions["parserRejectedModules"] += 1
            continue
        sources[key] = (lines, definitions, expected_hash, declared[0]["sourceFamily"])
        names = collections.Counter(x.name for x in definitions)
        inventory_names = {x["name"] for x in declared}
        for item in definitions:
            if item.name not in inventory_names or len(item.name) <= 2 or not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", item.name):
                exclusions["unqueryableNames"] += 1
                continue
            if names[item.name] != 1:
                exclusions["ambiguousSameFileNames"] += 1
                continue
            if fits_citations(lines, item.start, item.end):
                pools["symbol"].append((key, item, item.start, item.end))
            else:
                exclusions["fullSymbolExceedsCitationOrLineCap"] += 1
            # Ranges ask for a complete bounded excerpt near an authentic named
            # declaration, including cross-definition excerpts. No model-failure
            # output is involved in choosing a span.
            start = max(1, item.start - 2)
            end = min(len(lines), start + 11)
            if fits_citations(lines, start, end):
                pools["range"].append((key, item, start, end))
            else:
                exclusions["rangeExceedsLineCap"] += 1
        top = [x for x in definitions if x.top]
        # Blank source lines are not definitions. A complete outline must fit
        # the model's citation count, rather than keeping only its first entries.
        if 1 <= len(top) <= 12 and all(len(lines[(x.header or x.start) - 1].strip()) <= 80 for x in top):
            pools["outline"].append((key, top[0], 0, 0))
        else:
            exclusions["wholeOutlineExceedsCitationOrPreviewCap"] += 1

    result = []
    used_symbols = set()
    used_ranges = set()
    source_counts = collections.Counter()
    for kind in ("outline", "symbol", "range"):
        pool = pools[kind]
        # Spread tasks across source modules; among equal module counts alternate
        # short and >800-character excerpts to exercise both production paths.
        remaining = [(candidate,
                      sum(len(x) + 1 for x in numbered(sources[candidate[0]][0], candidate[2], candidate[3])) > 800 if candidate[2] else False,
                      stable_rank(f"{kind}:{candidate[0]}:{candidate[1].name}")) for candidate in pool]
        for index in range(quotas[kind]):
            candidates = []
            for candidate, long, rank in remaining:
                key, item, start, end = candidate
                if source_counts[key] >= 3:
                    continue
                identity = (key, item.name)
                if identity in used_symbols:
                    continue
                if kind == "range" and (key, start, end) in used_ranges:
                    continue
                candidates.append((int(long != (index % 2 == 0)), source_counts[key], rank, candidate))
            if not candidates:
                raise ValueError(f"Insufficient {split}/{language}/{kind}: wanted {quotas[kind]}, got {index}; independent exclusions={dict(exclusions)}")
            candidate = min(candidates)[-1]
            remaining = [entry for entry in remaining if entry[0] != candidate]
            key, item, start, end = candidate
            lines, definitions, source_hash, source_family = sources[key]
            used_symbols.add((key, item.name))
            used_ranges.add((key, start, end))
            source_counts[key] += 1
            file = f"{'sources with spaces' if len(result) % 5 == 0 else 'sources'}/{key}"
            query = {"symbol": item.name} if kind == "symbol" else {"lines": f"{start}-{end}"} if kind == "range" else {"outline": True}
            natural_question, template_family = question(split, kind, index, file, query)
            if kind == "outline":
                top = [x for x in definitions if x.top]
                targets = [f"L{x.header or x.start}: {lines[(x.header or x.start) - 1].strip()}" for x in top]
                allowed = [x.header or x.start for x in top]
                forbidden = []
            else:
                targets = numbered(lines, start, end)
                allowed_start = docs_start(lines, start, language) if kind == "symbol" else start
                allowed = list(range(allowed_start, end + 1))
                forbidden = boundary_forbidden(lines, allowed, definitions)
            result.append({
                "id": f"read-{split}-{language}-{kind}-{index:03d}",
                "family": f"{split}-real-{kind}", "language": language, "file": file,
                "sourceRef": {"source": key, "sha256": source_hash},
                "query": query, "question": natural_question,
                "gold": {"targetLines": targets, "forbiddenLines": forbidden, "expectedKind": kind,
                         "allowedLineNumbers": allowed, **({"sourceLineRange": [start, end]} if start else {})},
                "provenance": {"origin": "real", "sourceFamily": source_family,
                               "anchorSymbol": item.name, "anchorLine": item.header or item.start,
                               "templateFamily": template_family, "goldMethod": "stdlib-ast" if language == "python" else "tree-sitter-ast"},
                "coverage": {"targetSourceLines": len(targets), "targetChars": sum(len(x) + 1 for x in targets),
                             "modelCallGuaranteedForCorrectSlice": sum(len(x) + 1 for x in targets) > 800},
            })
    diagnostic[f"{split}/{language}"] = {"candidateCounts": {k: len(v) for k, v in pools.items()},
                                          "sourceModulesAvailable": len(sources), "exclusions": dict(exclusions)}
    return result


def function(language: str, name: str, body: list[str], header: str | None = None) -> str:
    if language == "python":
        return (header or f"def {name}(value):") + "\n" + "\n".join("    " + x for x in body) + "\n"
    if language in ("javascript", "typescript"):
        return (header or f"function {name}(value) {{") + "\n" + "\n".join("  " + x for x in body) + "\n}\n"
    if language == "go":
        return (header or f"func {name}(value int) int {{") + "\n" + "\n".join("\t" + x for x in body) + "\n}\n"
    return (header or f"fn {name}(value: i32) -> i32 {{") + "\n" + "\n".join("    " + x for x in body) + "\n}\n"


def basic_body(language: str, value: str = "value") -> list[str]:
    return [f"return {value}"] if language == "python" else [f"return {value};"] if language in ("javascript", "typescript") else [f"return {value}"] if language == "go" else [value]


def payload_statement(language: str, index: int, long: bool = False) -> str:
    payload = f"independent read fixture item {index:02d}; braces {{ }} and punctuation /: remain literal"
    if long:
        payload += f"; preserve original record {index:02d} with exact spelling"
    if language == "python":
        return f"record_{index} = {payload!r}"
    if language in ("javascript", "typescript"):
        return f"const record_{index} = {json.dumps(payload)};"
    if language == "go":
        return f"record_{index} := {json.dumps(payload)}; _ = record_{index}"
    return f"let record_{index} = {json.dumps(payload)};"


def synthetic_content(language: str, scenario: str, name: str, index: int) -> tuple[str, str, dict]:
    """Each scenario has a distinct source shape, not just renamed answer tokens."""
    sentinel = function(language, f"outside_{name}", basic_body(language, "0"))
    ordinary = function(language, name, basic_body(language))
    prefix = "package fixture\n\n" if language == "go" else ""
    mode = "symbol"
    query = {"symbol": name}
    body = None
    if scenario == "empty-file":
        return "", "whole", {}
    if scenario == "missing-file":
        return "", "whole", {}
    if scenario == "short-entire-file":
        return prefix + ordinary, "whole", {}
    if scenario == "plain-text-head":
        return "\n".join(f"source record {i:02d}: {name}; bounded plain-text material" for i in range(1, 36)), "range", {"lines": "1-12"}
    if scenario in ("outline-adjacent", "outline-nested", "outline-typed", "outline-export", "outline-multiline"):
        if scenario == "outline-nested":
            body = [f"def inner_{name}(item):", "    return item", "return value"] if language == "python" else [f"function inner_{name}(item) {{ return item; }}", "return value;"] if language in ("javascript", "typescript") else ["if value > 0 {", "    return value", "}", "return 0"] if language == "go" else ["if value > 0 { return value; }", "0"]
            ordinary = function(language, name, body)
        elif scenario == "outline-typed":
            ordinary = f"class {name}:\n    pass\n" if language == "python" else f"class {name} {{}}\n" if language in ("javascript", "typescript") else f"type {name} struct {{ value int }}\n" if language == "go" else f"struct {name} {{ value: i32 }}\n"
        elif scenario == "outline-export" and language in ("javascript", "typescript", "rust"):
            ordinary = ("pub " if language == "rust" else "export ") + ordinary
        elif scenario == "outline-multiline":
            headers = {"python": f"def {name}(\n    value,\n):", "javascript": f"function {name}(\n  value\n) {{", "typescript": f"function {name}(\n  value: number\n): number {{", "go": f"func {name}(\n value int,\n) int {{", "rust": f"fn {name}(\n value: i32,\n) -> i32 {{"}
            ordinary = function(language, name, basic_body(language), headers[language])
        return prefix + ordinary + "\n" + sentinel, "outline", {"outline": True}

    if scenario == "multiline-signature":
        headers = {"python": f"def {name}(\n    value,\n    other=2,\n):", "javascript": f"function {name}(\n  value,\n  other = 2\n) {{", "typescript": f"function {name}(\n  value: number,\n  other: number = 2\n): number {{", "go": f"func {name}(\n value int,\n other int,\n) int {{", "rust": f"fn {name}(\n value: i32,\n other: i32,\n) -> i32 {{"}
        ordinary = function(language, name, basic_body(language), headers[language])
    elif scenario == "nested-function":
        if language == "python":
            ordinary = f"def container_{name}(value):\n    def {name}(item):\n        return item + 1\n    return {name}(value)\n"
        elif language in ("javascript", "typescript"):
            ordinary = f"function container_{name}(value) {{\n  function {name}(item) {{\n    return item + 1;\n  }}\n  return {name}(value);\n}}\n"
        elif language == "rust":
            ordinary = f"fn container_{name}(value: i32) -> i32 {{\n    fn {name}(item: i32) -> i32 {{\n        item + 1\n    }}\n    {name}(value)\n}}\n"
        else:
            ordinary = function(language, name, ["increment := func(item int) int {", "    return item + 1", "}", "return increment(value)"])
    elif scenario == "method-in-type":
        if language == "python":
            ordinary = f"class Holder_{name}:\n    def {name}(self, value):\n        return value\n"
        elif language in ("javascript", "typescript"):
            ordinary = f"class Holder_{name} {{\n  {name}(value) {{\n    return value;\n  }}\n}}\n"
        elif language == "go":
            ordinary = f"type Holder_{name} struct {{}}\n" + function(language, name, basic_body(language), f"func (holder Holder_{name}) {name}(value int) int {{")
        else:
            ordinary = f"struct Holder_{name};\nimpl Holder_{name} {{\n    fn {name}(&self, value: i32) -> i32 {{\n        value\n    }}\n}}\n"
    elif scenario == "decorator-or-attribute":
        if language == "python":
            ordinary = "@staticmethod\n" + ordinary
        elif language in ("javascript", "typescript"):
            ordinary = "export " + ordinary
        elif language == "rust":
            ordinary = "#[inline]\n" + ordinary
        else:
            ordinary = f"// {name} retains its documentation.\n" + ordinary
    elif scenario == "reference-before-definition":
        comment = "#" if language == "python" else "//"
        ordinary = f"{comment} A mention of {name} appears before its definition.\n\n" + ordinary
    elif scenario in ("string-braces", "unicode-string", "escaped-string", "long-symbol", "long-symbol-later"):
        count = 9 if scenario.startswith("long-") else 2
        body = [payload_statement(language, i + index, scenario.startswith("long-")) for i in range(count)]
        if scenario == "unicode-string":
            body[0] = body[0].replace("independent", "हाइड्रा café 日本語")
        if scenario == "escaped-string":
            body[0] = body[0].replace("punctuation", "escaped \\\"quote\\\" and \\\\slash; punctuation")
        ordinary = function(language, name, body + basic_body(language))
        if scenario == "long-symbol-later":
            prefix += sentinel + "\n"
    elif scenario in ("comment-braces", "block-comment", "trailing-comment", "blank-body", "comment-only-context"):
        if scenario == "block-comment":
            body = ['"""Multiline literal begins {', 'and ends with an unmatched-looking }', '"""'] if language == "python" else ["/* multiline comment begins {", " * unrelated close markers } }", " */"]
        elif scenario == "blank-body":
            body = ["", "", *basic_body(language)]
        elif scenario == "trailing-comment":
            tail = " # } { remains comment" if language == "python" else " // } { remains comment"
            body = [basic_body(language)[0] + tail]
        elif scenario == "comment-only-context":
            ordinary = ("#" if language == "python" else "//") + f" Documentation for {name} with {{ and }}.\n" + ordinary
            body = None
        else:
            body = [("#" if language == "python" else "//") + " nested-looking { { } is a comment"]
        if body is not None:
            ordinary = function(language, name, body + (basic_body(language) if scenario not in ("blank-body", "trailing-comment") else []))
    elif scenario in ("raw-or-template-string", "multiline-literal", "regex-or-interpolation"):
        if language == "python":
            body = ['text = rf"literal {{ braces }} {value}"', "return text"] if scenario == "regex-or-interpolation" else ['text = r"literal \\{ braces \\} in a raw string"', "return text"] if scenario == "raw-or-template-string" else ['text = """literal {', 'continues across a line with }', 'ends here"""', "return text"]
        elif language in ("javascript", "typescript"):
            body = ["const pattern = /[{}]+\\/tail/g;", "return pattern.test(String(value));"] if scenario == "regex-or-interpolation" else ["const text = `literal { ${value} }`;", "return text;"] if scenario == "raw-or-template-string" else ["const text = `literal {", "continues } with ${value}", "end`;", "return text;"]
        elif language == "go":
            body = ['text := `literal { raw } with // punctuation`', "_ = text", "return value"] if scenario == "raw-or-template-string" else ['text := `literal {', 'continues } with // punctuation', 'end`', "_ = text", "return value"]
        else:
            body = ['let text = r###"literal { raw } with /* punctuation */"###;', "let _ = text;", "value"] if scenario == "raw-or-template-string" else ['let text = r###"literal {', 'continues } with /* punctuation */', 'end"###;', "let _ = text;", "value"]
        ordinary = function(language, name, body)
    elif scenario == "one-line-function":
        ordinary = f"def {name}(value): return value + 1\n" if language == "python" else f"function {name}(value) {{ return value + 1; }}\n" if language in ("javascript", "typescript") else f"func {name}(value int) int {{ return value + 1 }}\n" if language == "go" else f"fn {name}(value: i32) -> i32 {{ value + 1 }}\n"
    elif scenario in ("conditional-block", "loop-block", "nested-object", "early-return"):
        if language == "python":
            body = ["if value > 0:", "    return value", "return 0"] if scenario in ("conditional-block", "early-return") else ["for item in range(value):", "    value += item", "return value"] if scenario == "loop-block" else ['record = {"outer": {"inner": value}}', "return record"]
        elif language in ("javascript", "typescript"):
            body = ["if (value > 0) {", "  return value;", "}", "return 0;"] if scenario in ("conditional-block", "early-return") else ["for (let item = 0; item < value; item++) {", "  value += item;", "}", "return value;"] if scenario == "loop-block" else ['const record = { outer: { inner: value } };', "return record;"]
        elif language == "go":
            body = ["if value > 0 {", "    return value", "}", "return 0"] if scenario in ("conditional-block", "early-return") else ["for item := 0; item < value; item++ {", "    value += item", "}", "return value"] if scenario == "loop-block" else ['record := map[string]map[string]int{"outer": {"inner": value}}', "return record[\"outer\"][\"inner\"]"]
        else:
            body = ["if value > 0 {", "    return value;", "}", "0"] if scenario in ("conditional-block", "early-return") else ["for item in 0..value {", "    let _ = item;", "}", "value"] if scenario == "loop-block" else ["let record = [Some(value), None];", "record[0].unwrap_or(0)"]
        ordinary = function(language, name, body)
        if scenario == "early-return":
            ordinary = ordinary.replace("value > 0", "value < 0").replace("return value", "return 0")
            ordinary = ordinary.replace("return 0\n", "return value + 2\n", 1) if language == "python" else ordinary.replace("return 0;", "return value + 2;", 1) if language in ("javascript", "typescript", "rust") else ordinary.replace("return 0\n", "return value + 2\n", 1)
    elif scenario in ("async-or-generic", "multiline-return"):
        if scenario == "async-or-generic":
            headers = {"python": f"async def {name}(value):", "javascript": f"async function {name}(value) {{", "typescript": f"function {name}<T>(value: T): T {{", "go": f"func {name}[T any](value T) T {{", "rust": f"async fn {name}<T>(value: T) -> T {{"}
            ordinary = function(language, name, basic_body(language), headers[language])
        else:
            body = ["return (", "    value + 1", ")"] if language == "python" else ["return (", "  value + 1", ");"] if language in ("javascript", "typescript") else ["return (value +", "    1)"] if language == "go" else ["(", "    value + 1", ")"]
            ordinary = function(language, name, body)

    content = prefix + ordinary + "\n" + sentinel
    if scenario.startswith("range-") or scenario in ("space-path", "nested-path", "crlf-file", "no-final-newline"):
        mode = "range"
        body = [payload_statement(language, i + index, True) for i in range(9)] + basic_body(language)
        content = prefix + function(language, name, body) + "\n" + sentinel
        if scenario == "range-long-later":
            prefix += sentinel + "\n"
            content = prefix + function(language, name, body)
        lines = content.split("\n")
        if scenario == "range-zero-start":
            query = {"lines": "0-7"}
        elif scenario == "range-beyond-eof":
            query = {"lines": f"{len(lines) - 5}-{len(lines) + 30}"}
        elif scenario == "range-cross-boundary":
            query = {"lines": f"{len(lines) - 7}-{len(lines) - 1}"}
        elif scenario == "range-blank-lines":
            content = prefix + ordinary + "\n\n\n" + sentinel
            query = {"lines": f"{len((prefix + ordinary).split(chr(10)))}-{len((prefix + ordinary).split(chr(10))) + 1}"}
        else:
            query = {"lines": f"{len(prefix.split(chr(10)))}-{len(prefix.split(chr(10))) + 11}"}
        if scenario == "crlf-file":
            content = content.replace("\n", "\r\n")
        if scenario == "no-final-newline":
            content = content.rstrip("\n")
            query = {"lines": f"{max(1, len(content.split(chr(10))) - 5)}-{len(content.split(chr(10)))}"}
    return content, mode, query


DEV_SCENARIOS = ("simple-definition", "multiline-signature", "nested-function", "string-braces", "space-path", "outline-adjacent", "empty-file", "missing-file")
HOLDOUT_SCENARIOS = (
    "method-in-type", "decorator-or-attribute", "reference-before-definition", "comment-braces", "block-comment", "trailing-comment", "blank-body", "short-symbol",
    "unicode-string", "escaped-string", "long-symbol", "long-symbol-later", "raw-or-template-string", "multiline-literal", "regex-or-interpolation", "one-line-function",
    "conditional-block", "loop-block", "nested-object", "stopword-symbol", "async-or-generic", "multiline-return", "range-zero-start", "range-beyond-eof",
    "range-cross-boundary", "range-blank-lines", "range-long-first", "range-long-later", "nested-path", "crlf-file", "no-final-newline", "outline-nested",
    "outline-typed", "outline-export", "outline-multiline", "short-entire-file", "plain-text-head", "empty-file", "missing-file", "space-path",
)


def synthetic_tasks(parser: GoldParser, split: str) -> list[dict]:
    result = []
    scenarios = DEV_SCENARIOS if split == "development" else HOLDOUT_SCENARIOS
    for language in SYNTHETIC_LANGUAGES:
        for index, scenario in enumerate(scenarios):
            name = f"{'develop' if split == 'development' else 'frozen'}_{language}_{index:02d}"
            if split == "development" and scenario == "simple-definition":
                name = "read"
            elif scenario == "short-symbol":
                name = "xy"
            elif scenario == "stopword-symbol":
                name = "code"
            content, mode, query = synthetic_content(language, scenario, name, index * 11)
            ext = "txt" if scenario == "plain-text-head" else EXTENSIONS[language]
            file = f"fixtures/{split}/{language}/{scenario}.{ext}"
            if scenario in ("space-path", "method-in-type"):
                file = f"fixtures with spaces/{split}/{language}/source {index}.{ext}"
            elif scenario == "nested-path":
                file = f"fixtures/{split}/{language}/nested/further/deep/source.{ext}"
            lines = content.split("\n")
            definitions = [] if not content or ext == "txt" else parser.definitions(content, language)
            if scenario == "missing-file":
                targets, allowed, expected = ["File not found:"], [], "missing-file"
                forbidden = []
                span = {}
            elif mode == "symbol":
                matches = [x for x in definitions if x.name == name]
                if len(matches) != 1:
                    raise ValueError(f"Non-unique synthetic AST symbol: {split}/{language}/{scenario}: {matches}")
                item = matches[0]
                if not fits_citations(lines, item.start, item.end):
                    raise ValueError(f"Synthetic gold exceeds output caps: {split}/{language}/{scenario}")
                targets = numbered(lines, item.start, item.end)
                allowed = list(range(docs_start(lines, item.start, language), item.end + 1))
                forbidden = boundary_forbidden(lines, allowed, definitions)
                expected, span = "symbol", {"sourceLineRange": [item.start, item.end]}
            elif mode == "range":
                requested_start, requested_end = map(int, query["lines"].split("-"))
                start, end = max(1, requested_start), min(len(lines), requested_end)
                if not fits_citations(lines, start, end):
                    raise ValueError(f"Synthetic range exceeds output caps: {split}/{language}/{scenario}")
                targets, allowed = numbered(lines, start, end), list(range(start, end + 1))
                forbidden = boundary_forbidden(lines, allowed, definitions)
                expected, span = "range", {"sourceLineRange": [start, end]}
            elif mode == "outline":
                top = [x for x in definitions if x.top]
                targets = [f"L{x.header or x.start}: {lines[(x.header or x.start) - 1].strip()}" for x in top]
                if not top or len(top) > 12 or any(len(lines[(x.header or x.start) - 1].strip()) > 80 for x in top):
                    raise ValueError(f"Synthetic outline exceeds output caps: {split}/{language}/{scenario}")
                allowed, forbidden, expected, span = [x.header or x.start for x in top], [], "outline", {}
            else:
                targets, allowed = numbered(lines, 1, len(lines)), list(range(1, len(lines) + 1))
                forbidden, expected, span = [], "empty" if content == "" else "whole", {"sourceLineRange": [1, len(lines)]}
                if not fits_citations(lines, 1, len(lines)):
                    raise ValueError(f"Synthetic whole-file exceeds caps: {split}/{language}/{scenario}")
            natural_question, template_family = question(split, mode, index, file, query)
            result.append({
                "id": f"read-{split}-synthetic-{language}-{scenario}", "family": f"{split}-synthetic-{scenario}",
                "language": language, "file": file, "content": content,
                **({"missingFile": True} if scenario == "missing-file" else {}),
                "query": query, "question": natural_question,
                "gold": {"targetLines": targets, "forbiddenLines": forbidden, "expectedKind": expected,
                         "allowedLineNumbers": allowed, **({"expectedFile": file} if scenario == "missing-file" else {}), **span},
                "provenance": {"origin": "synthetic", "sourceFamily": f"{split}/{language}/{scenario}",
                               "templateFamily": template_family, "contentSha256": sha256(content.encode("utf-8")),
                               "anchorSymbol": name, "goldMethod": "explicit-line-range" if mode in ("range", "whole") else "stdlib-ast" if language == "python" else "tree-sitter-ast"},
                "coverage": {"targetSourceLines": len(targets), "targetChars": sum(len(x) + 1 for x in targets),
                             "modelCallGuaranteedForCorrectSlice": sum(len(x) + 1 for x in targets) > 800},
            })
    return result


def validate(corpora: dict, inventory: dict, cache: Path, parser: GoldParser) -> dict:
    ids, facts = set(), set()
    source_sets, template_sets, content_sets = {}, {}, {}
    report = {}
    inventory_splits = collections.defaultdict(set)
    for row in inventory["declarations"]:
        inventory_splits[row["sourceFamily"]].add(row["split"])
    if any(len(value) > 1 for value in inventory_splits.values()):
        raise ValueError("Inventory has a cross-split source module")
    for split, tasks in corpora.items():
        expected_count = 200 if split == "development" else 1000
        if len(tasks) != expected_count:
            raise ValueError(f"Expected {expected_count} {split} tasks, got {len(tasks)}")
        source_sets[split], template_sets[split], content_sets[split] = set(), set(), set()
        languages = collections.Counter()
        origins, kinds = collections.Counter(), collections.Counter()
        source_symbols = set()
        for task in tasks:
            if task["id"] in ids:
                raise ValueError("Repeated task ID")
            ids.add(task["id"])
            if Path(task["file"]).is_absolute() or ".." in Path(task["file"]).parts:
                raise ValueError("Unsafe materialized task path")
            origin = task["provenance"]["origin"]
            origins[origin] += 1
            languages[task["language"]] += 1
            kinds[task["gold"]["expectedKind"]] += 1
            template_sets[split].add(task["provenance"]["templateFamily"])
            if origin == "real":
                ref = task["sourceRef"]
                data = (cache / ref["source"]).read_bytes()
                if sha256(data) != ref["sha256"] or ref["sha256"] != inventory["files"][ref["source"]]:
                    raise ValueError("Source ref identity mismatch")
                family = task["provenance"]["sourceFamily"]
                if inventory_splits[family] != {split}:
                    raise ValueError("Task source is in another inventory split")
                source_sets[split].add(family)
                source_symbols.add((ref["source"], task["provenance"]["anchorSymbol"]))
            else:
                data = task["content"].encode("utf-8")
            content_sets[split].add(sha256(data))
            lines = data.decode("utf-8").split("\n")
            gold = task["gold"]
            if set(gold["targetLines"]) & set(gold["forbiddenLines"]):
                raise ValueError("Gold target is also forbidden")
            if gold.get("sourceLineRange"):
                start, end = gold["sourceLineRange"]
                if gold["targetLines"] != numbered(lines, start, end):
                    raise ValueError("Gold range does not cover every requested source line")
            elif gold["expectedKind"] == "outline":
                defs = parser.definitions(data.decode("utf-8"), task["language"])
                expected = [f"L{x.header or x.start}: {lines[(x.header or x.start) - 1].strip()}" for x in defs if x.top]
                if gold["targetLines"] != expected:
                    raise ValueError("Gold outline omits an independently parsed top-level definition")
            # Empty source and missing-file tasks deliberately share empty bytes,
            # but remain distinct file-state experiments, not source examples.
            identity = (split, task.get("sourceRef", {}).get("source", task["file"]),
                        json.dumps(task["query"], sort_keys=True), task.get("missingFile", False))
            if identity in facts:
                raise ValueError("Repeated source/query experiment")
            facts.add(identity)
        real_language_counts = collections.Counter(x["language"] for x in tasks if x["provenance"]["origin"] == "real")
        if real_language_counts != {language: COUNTS[split] for language in LANGUAGES}:
            raise ValueError("Real-source language quota mismatch")
        report[split] = {
            "tasks": len(tasks), "origins": dict(origins), "languages": dict(languages), "kinds": dict(kinds),
            "realSourceModules": len(source_sets[split]), "uniqueRealSourceSymbols": len(source_symbols),
            "guaranteedModelCalledTasksForCorrectSlice": sum(x["coverage"]["modelCallGuaranteedForCorrectSlice"] for x in tasks),
            "quotedSpacePathTasks": sum(" " in x["file"] for x in tasks),
            "questionTemplateFamilies": sorted(template_sets[split]),
            "sourceFamilies": sorted(source_sets[split]),
        }
    if source_sets["development"] & source_sets["holdout"]:
        raise ValueError("Development and holdout source-module leakage")
    if template_sets["development"] & template_sets["holdout"]:
        raise ValueError("Development and holdout question-template leakage")
    # Empty bytes are an intentional shared file-state fixture, not training or
    # copied substantive source material. Report it rather than hiding the overlap.
    substantive_overlap = (content_sets["development"] & content_sets["holdout"]) - {sha256(b"")}
    if substantive_overlap:
        raise ValueError("Development and holdout substantive source-content leakage")
    report["crossSplitModuleOverlap"] = 0
    report["crossSplitQuestionTemplateOverlap"] = 0
    report["crossSplitSubstantiveContentOverlap"] = 0
    report["sharedEmptyFixtureHash"] = sha256(b"")
    return report


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--inventory", type=Path, default=ROOT / "evals/suite/source-inventory.json")
    cli.add_argument("--source-root", type=Path)
    cli.add_argument("--parser-path", type=Path, default=Path.home() / ".hydra/quality-parsers")
    cli.add_argument("--output-root", type=Path, default=ROOT / "evals/suite/quality")
    args = cli.parse_args()
    inventory_bytes = args.inventory.read_bytes()
    inventory = json.loads(inventory_bytes)
    if inventory.get("trainingInputsUsed") or inventory.get("sealedInputsUsed"):
        raise ValueError("Inventory is not independent benchmark material")
    cache = args.source_root or Path(inventory["cache"])
    parser = GoldParser(args.parser_path)
    diagnostic = {}
    corpora = {}
    for split in COUNTS:
        tasks = []
        for language in LANGUAGES:
            tasks.extend(real_tasks(inventory, cache, parser, split, language, diagnostic))
            print(f"Independent source gold: {split}/{language} complete", file=sys.stderr, flush=True)
        corpora[split] = tasks + synthetic_tasks(parser, split)
    qa = validate(corpora, inventory, cache, parser)
    files = {}
    for split, tasks in corpora.items():
        output = args.output_root / split / "read.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = encode(tasks)
        output.write_bytes(payload)
        files[split] = {"path": output.relative_to(args.output_root).as_posix(), "sha256": sha256(payload), "bytes": len(payload)}
    manifest = {
        "scope": "Independent gold generation only; no production execution, model calls, model accuracy, or release claim.",
        "trainingInputsUsed": False, "sealedInputsUsed": False,
        "inventorySha256": sha256(inventory_bytes), "builderSha256": sha256(Path(__file__).read_bytes()),
        "sourceArchives": inventory["archives"], "goldParsers": {"python": f"stdlib ast Python {sys.version_info.major}.{sys.version_info.minor}", **parser.versions},
        "seedPolicy": "Stable SHA-256 ranking of original source/module/symbol identities; no failure-conditioned sampling.",
        "files": files, "qa": qa, "candidateCoverage": diagnostic,
        "questionTemplates": QUESTIONS,
        "limits": [
            "Full requested symbol/range gold contains every line, capped at twelve lines and 190 numbered characters per line so it is reachable within the answer's hard twelve-citation/200-character limit.",
            "Longer functions/classes and larger module outlines are excluded and counted. This corpus cannot establish complete long-symbol or whole-large-module accuracy.",
            "Real outlines require complete AST top-level definitions, at most twelve entries and 80-character declaration lines; nested methods are tested as symbols separately.",
            "A correct slice with >800 target characters necessarily calls the answer model. The guaranteed count is a lower bound; actual gather output headers/documentation and gather mistakes can change measured model-called coverage.",
            "Quoted paths with spaces, CRLF, no final newline, clamped ranges, missing/empty files, nested/multiline syntax and TypeScript are synthetic fixtures, not additional real projects.",
            "Missing-symbol fallback semantics and complete non-code file head/large-file rejection behavior are not scored by this corpus.",
            "The development and holdout sets share the intentional empty-file byte hash, but no substantive source content, whole source module or question template family.",
        ],
    }
    manifest_path = args.output_root / "read-manifest.json"
    manifest_path.write_bytes(encode(manifest))
    print(json.dumps({"files": files, "qa": {split: {key: value for key, value in qa[split].items() if key not in ("sourceFamilies", "questionTemplateFamilies")} for split in COUNTS}, "manifest": str(manifest_path)}, indent=2))


if __name__ == "__main__":
    main()
