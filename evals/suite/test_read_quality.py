"""Focused independent-gold QA; no production imports or model calls."""

import importlib.util
from pathlib import Path
import sys
import unittest


SPEC = importlib.util.spec_from_file_location("read_quality_builder", Path(__file__).with_name("build_read_quality.py"))
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


class IndependentSpanGoldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = BUILDER.GoldParser(Path.home() / ".hydra/quality-parsers")

    def named(self, content, language, name):
        matches = [item for item in self.parser.definitions(content, language) if item.name == name]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_python_decorator_and_multiline_signature_have_distinct_header(self):
        content = "@staticmethod\ndef sample(\n    value,\n):\n    return value\n\ndef adjacent(value):\n    return 0\n"
        item = self.named(content, "python", "sample")
        self.assertEqual((item.start, item.header, item.end, item.top), (1, 2, 5, True))

    def test_javascript_regex_template_and_nested_function_do_not_end_outer_span(self):
        content = "function outer(value) {\n  const raw = `{\n  }`;\n  const pattern = /[{}]/;\n  function inner() { return raw; }\n  return pattern.test(raw);\n}\nfunction adjacent() {}\n"
        item = self.named(content, "javascript", "outer")
        inner = self.named(content, "javascript", "inner")
        self.assertEqual((item.start, item.end, item.top), (1, 7, True))
        self.assertEqual((inner.start, inner.end, inner.top), (5, 5, False))

    def test_go_raw_literal_braces_do_not_end_span(self):
        content = "package fixture\nfunc sample(value int) int {\n text := `{\n }`\n _ = text\n return value\n}\nfunc adjacent() {}\n"
        item = self.named(content, "go", "sample")
        self.assertEqual((item.start, item.end, item.top), (2, 7, True))

    def test_rust_raw_literal_comment_markers_and_nested_blocks_do_not_end_span(self):
        content = 'fn sample(value: i32) -> i32 {\n    let text = r###"{\n    } /* marker */"###;\n    let _ = text;\n    if value > 0 { return value; }\n    0\n}\nfn adjacent() {}\n'
        item = self.named(content, "rust", "sample")
        self.assertEqual((item.start, item.end, item.top), (1, 7, True))

    def test_typescript_generic_function_and_nested_method_are_ast_distinct(self):
        content = "export function sample<T>(\n value: T\n): T { return value; }\nclass Holder {\n  method(value: number) { return value; }\n}\n"
        item = self.named(content, "typescript", "sample")
        method = self.named(content, "typescript", "method")
        self.assertEqual((item.start, item.end, item.top), (1, 3, True))
        self.assertEqual((method.start, method.end, method.top), (5, 5, False))

    def test_all_synthetic_cases_have_complete_capped_independent_gold(self):
        for split, count in (("development", 40), ("holdout", 200)):
            tasks = BUILDER.synthetic_tasks(self.parser, split)
            self.assertEqual(len(tasks), count)
            self.assertEqual(len({item["id"] for item in tasks}), count)
            for task in tasks:
                gold = task["gold"]
                self.assertTrue(gold["targetLines"], task["id"])
                self.assertLessEqual(len(gold["targetLines"]), 12, task["id"])
                if "sourceLineRange" in gold:
                    start, end = gold["sourceLineRange"]
                    self.assertEqual(gold["targetLines"], BUILDER.numbered(task["content"].split("\n"), start, end), task["id"])


if __name__ == "__main__":
    unittest.main()
