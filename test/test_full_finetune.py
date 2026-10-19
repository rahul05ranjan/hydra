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
    def test_host_memory_reads_linux_proc_and_is_empty_elsewhere(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            proc = Path(folder)
            self.assertEqual(module.host_memory(proc), {})
            (proc / 'self').mkdir()
            (proc / 'self' / 'status').write_text('Name:\tpython\nVmRSS:\t  13631488 kB\nThreads:\t9\n')
            (proc / 'meminfo').write_text('MemTotal:       32873496 kB\nMemAvailable:    2097152 kB\n')
            self.assertEqual(module.host_memory(proc), {'hostRssBytes': 13631488 * 1024, 'hostAvailableBytes': 2097152 * 1024})

    def test_release_host_memory_trims_glibc_and_is_false_elsewhere(self):
        calls = []

        class Libc:
            def malloc_trim(self, pad):
                calls.append(pad)
                return 1

        def missing(name):
            raise OSError(name)
        self.assertTrue(module.release_host_memory(lambda name: Libc()))
        self.assertEqual(calls, [0])
        self.assertFalse(module.release_host_memory(missing))

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


TOOLS = [{'type': 'function', 'function': {'name': 'get_weather', 'parameters': {
    'type': 'object', 'properties': {'city': {'type': 'string'}, 'unit': {'type': 'string'}}}}}]


def call(name='get_weather', **arguments):
    return {'head': 'toolcall', 'tools': TOOLS, 'messages': [
        {'role': 'user', 'content': 'weather in Pune?'},
        {'role': 'assistant', 'content': '', 'tool_calls': [{'type': 'function', 'function': {'name': name, 'arguments': arguments or {'city': 'Pune'}}}]}]}


def decline(text='None of these functions can tell you that.'):
    return {'head': 'toolcall', 'tools': TOOLS, 'messages': [
        {'role': 'user', 'content': 'who won the 2019 final?'}, {'role': 'assistant', 'content': text}]}


class ToolCallContract(unittest.TestCase):
    def test_a_call_must_name_an_offered_function(self):
        module.validate_row(call())
        with self.assertRaisesRegex(ValueError, 'offered function'):
            module.validate_row(call('delete_everything'))

    def test_a_call_may_pass_only_declared_parameters(self):
        with self.assertRaisesRegex(ValueError, 'declared parameters'):
            module.validate_row(call(city='Pune', command='rm -rf /'))

    def test_a_decline_is_plain_text_without_a_call(self):
        module.validate_row(decline())
        for text in ('', '<tool_call>\n<function=get_weather>\n</function>\n</tool_call>'):
            with self.assertRaisesRegex(ValueError, 'plain text'):
                module.validate_row(decline(text))

    def test_tool_rows_reach_the_chat_template_with_their_tools(self):
        seen = []

        class Recording(ChatTokenizer):
            def apply_chat_template(self, messages, **kwargs):
                seen.append(kwargs.get('tools'))
                return [1, 2, 3] if len(messages) == 1 else [1, 2, 3, 4, 9]
        row = decline()
        self.assertEqual(module.encode_example(Recording(), row['messages'], 5, row['tools'])['labels'], [-100, -100, -100, 4, 9])
        self.assertEqual(seen, [TOOLS, TOOLS])

    def test_hydra_rows_keep_their_fixed_json_contract(self):
        module.validate_row({'head': 'git', 'messages': MESSAGES})
        with self.assertRaises(ValueError):
            module.validate_row({'head': 'git', 'messages': decline()['messages']})


def chat(text='Rivers carry water to the sea.', **extra):
    return {'head': 'chat', 'messages': [{'role': 'user', 'content': 'why do rivers matter?'},
                                         {'role': 'assistant', 'content': text}], **extra}


class ChatReplayContract(unittest.TestCase):
    def test_a_chat_row_is_one_plain_text_reply_without_tools(self):
        module.validate_row(chat())
        for bad in (chat(''), chat('<tool_call>\n<function=x>\n</function>\n</tool_call>'), chat(tools=TOOLS)):
            with self.assertRaises(ValueError):
                module.validate_row(bad)

    def test_chat_rows_encode_without_the_hydra_json_contract(self):
        seen = []

        class Recording(ChatTokenizer):
            def apply_chat_template(self, messages, **kwargs):
                seen.append(kwargs.get('tools'))
                return [1, 2, 3] if len(messages) == 1 else [1, 2, 3, 4, 9]
        row = chat()
        self.assertEqual(module.encode_example(Recording(), row['messages'], 5, None, 'chat')['labels'], [-100, -100, -100, 4, 9])
        self.assertEqual(seen, [None, None])
        with self.assertRaises(ValueError):
            module.encode_example(Recording(), row['messages'], 5)


if __name__ == '__main__':
    unittest.main()
