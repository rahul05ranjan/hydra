"""Numerical loss/gradient and projection-size checks; no optimizer or trained weights."""
import importlib.util
from pathlib import Path
import unittest

import torch
from transformers import Qwen3_5ForCausalLM, Qwen3_5TextConfig

spec = importlib.util.spec_from_file_location('full_finetune', Path(__file__).resolve().parents[1] / 'train/full_finetune.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def tiny_model(tied=False):
    config = Qwen3_5TextConfig(vocab_size=41, hidden_size=16, intermediate_size=32,
        num_hidden_layers=2, num_attention_heads=2, num_key_value_heads=1, head_dim=8,
        layer_types=['linear_attention', 'full_attention'], linear_num_key_heads=1,
        linear_num_value_heads=2, linear_key_head_dim=8, linear_value_head_dim=8,
        linear_conv_kernel_dim=4, tie_word_embeddings=tied, attention_dropout=0.0,
        rope_parameters={'rope_type': 'default', 'rope_theta': 10000.0,
            'partial_rotary_factor': 1.0, 'mrope_section': [1, 1, 2]})
    config._attn_implementation = 'eager'
    model = Qwen3_5ForCausalLM(config).train()
    model.gradient_checkpointing_enable()
    return model


class AssistantLossTests(unittest.TestCase):
    measurements = []

    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def compare(self, tied, mixed, dtype=torch.bfloat16):
        torch.manual_seed(1729)
        model = tiny_model(tied)
        ids = torch.randint(0, 41, (1, 19))
        labels = ids.clone()
        # Includes an interior ignored label as well as an ignored prompt.
        labels[:, :12] = -100
        labels[:, 15] = -100
        with torch.autocast('cpu', dtype=dtype, enabled=mixed):
            baseline = model(input_ids=ids, labels=labels, use_cache=False).loss
        baseline.backward()
        grads = {name: p.grad.clone() for name, p in model.named_parameters() if p.grad is not None}
        model.zero_grad(set_to_none=True)
        projected = []
        hook = model.lm_head.register_forward_pre_hook(lambda _, args: projected.append(args[0].shape[1]))
        with torch.autocast('cpu', dtype=dtype, enabled=mixed):
            actual = trainer.assistant_loss(model, ids, labels)
        actual.backward()
        hook.remove()
        self.assertEqual(projected, [6])
        torch.testing.assert_close(actual, baseline, rtol=2e-3 if mixed else 1e-6, atol=1e-6)
        for name, p in model.named_parameters():
            self.assertIn(name, grads)
            torch.testing.assert_close(p.grad, grads[name], rtol=2e-2 if mixed else 1e-4,
                atol=2e-4 if mixed else 1e-7, msg=lambda msg: name + ': ' + msg)
        self.measurements.append({'dtype': str(dtype) if mixed else 'torch.float32',
            'tiedEmbeddings': tied, 'lossAbsoluteError': abs(float(actual.detach() - baseline.detach())),
            'maximumGradientAbsoluteError': max(float((p.grad - grads[name]).abs().max())
                for name, p in model.named_parameters()), 'parametersCompared': len(grads),
            'fullProjectionPositions': ids.shape[1], 'selectedProjectionPositions': projected[0]})

    def test_loss_and_all_parameter_gradients_match(self):
        self.compare(tied=False, mixed=False)

    def test_tied_embeddings_and_autocast_match(self):
        self.compare(tied=True, mixed=True)

    def test_fp16_autocast_matches(self):
        self.compare(tied=False, mixed=True, dtype=torch.float16)

    def test_long_prompt_projects_only_shifted_targets(self):
        torch.manual_seed(3)
        model = tiny_model()
        ids = torch.randint(0, 41, (1, 128))
        labels = ids.clone()
        labels[:, :124] = -100
        projected = []
        hook = model.lm_head.register_forward_pre_hook(lambda _, args: projected.append(args[0].shape[1]))
        loss = trainer.assistant_loss(model, ids, labels)
        loss.backward()
        hook.remove()
        self.assertEqual(projected, [4])
        self.assertTrue(torch.isfinite(loss))

    def test_empty_supervision_and_multibatch_fail_closed(self):
        model = tiny_model()
        ids = torch.ones((1, 4), dtype=torch.long)
        with self.assertRaisesRegex(ValueError, 'supervised'):
            trainer.assistant_loss(model, ids, torch.full_like(ids, -100))
        with self.assertRaisesRegex(ValueError, 'single'):
            trainer.assistant_loss(model, ids.expand(2, -1), ids.expand(2, -1))


if __name__ == '__main__':
    unittest.main()
