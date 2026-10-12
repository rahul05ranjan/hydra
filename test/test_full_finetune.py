"""Data/prompt invariants only: no torch, GPU, model loading or training."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('full_finetune', Path(__file__).resolve().parents[1] / 'train/full_finetune.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ChatTokenizer:
    eos_token_id = 9

    def apply_chat_template(self, messages, **kwargs):
        return [1, 2, 3] if len(messages) == 2 else [1, 2, 3, 4, 9]


MESSAGES = [{'role': 'system', 'content': 'menu'}, {'role': 'user', 'content': 'question'},
            {'role': 'assistant', 'content': '{"probes":[{"probe":"status"}]}'}]


class FullTrainingInvariants(unittest.TestCase):
    def test_only_assistant_and_chat_eos_are_supervised(self):
        self.assertEqual(module.encode_example(ChatTokenizer(), MESSAGES, 5)['labels'], [-100, -100, -100, 4, 9])

    def test_no_silent_prompt_or_target_truncation(self):
        with self.assertRaisesRegex(ValueError, 'truncation'):
            module.encode_example(ChatTokenizer(), MESSAGES, 4)

    def test_training_and_inference_prefix_must_match(self):
        class BadPrefix(ChatTokenizer):
            def apply_chat_template(self, messages, **kwargs):
                return [1, 2, 3] if len(messages) == 2 else [1, 7, 3, 4, 9]
        with self.assertRaisesRegex(ValueError, 'prefix'):
            module.encode_example(BadPrefix(), MESSAGES, 5)

    def test_shell_commands_are_not_a_training_contract(self):
        unsafe = [*MESSAGES[:-1], {'role': 'assistant', 'content': json.dumps({'probes': [{'probe': 'log', 'command': 'arbitrary shell'}]})}]
        with self.assertRaisesRegex(ValueError, 'arbitrary command'):
            module.validate_target('git', unsafe)
        with self.assertRaises(ValueError):
            module.validate_target('os', MESSAGES)


if __name__ == '__main__':
    unittest.main()
