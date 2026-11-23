"""LoRA in full_finetune.py: adapters start as a no-op, only they train, and merging gives back the
starting tensor layout with the adapted behaviour, so the evaluation converts it like any checkpoint."""
import importlib.util
from pathlib import Path
import unittest

import torch

from test_assistant_loss import tiny_model

spec = importlib.util.spec_from_file_location('full_finetune', Path(__file__).resolve().parents[1] / 'train/full_finetune.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


def batch(seed):
    torch.manual_seed(seed)
    ids = torch.randint(0, 41, (1, 19))
    labels = ids.clone()
    labels[:, :12] = -100
    return ids, labels


def lora_model(tied=False):
    model = tiny_model(tied)
    # The trainer turns on non-reentrant checkpointing for LoRA: the frozen base gives the
    # reentrant kind no input that needs a gradient, and the adapters would get none.
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    return model


class LoraTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def test_wraps_every_target_projection_and_nothing_else(self):
        torch.manual_seed(3)
        model = lora_model()
        wrapped = trainer.apply_lora(model, trainer.LORA_TARGETS, rank=4, alpha=8)
        names = {name.rsplit('.', 1)[-1] for name in wrapped}
        self.assertEqual(names, set(trainer.LORA_TARGETS))
        for name, module in model.named_modules():
            if isinstance(module, trainer.LoraLinear):
                self.assertIn(name, wrapped)
        trainable = [name for name, p in model.named_parameters() if p.requires_grad]
        self.assertTrue(trainable)
        self.assertTrue(all(name.endswith(('.lora_a', '.lora_b')) for name in trainable))

    def test_a_target_that_matches_no_layer_is_refused(self):
        model = lora_model()
        with self.assertRaises(ValueError):
            trainer.apply_lora(model, trainer.LORA_TARGETS + ['no_such_proj'], rank=4, alpha=8)

    def test_fresh_adapters_leave_the_loss_unchanged(self):
        torch.manual_seed(5)
        model = lora_model()
        ids, labels = batch(11)
        before = trainer.assistant_loss(model, ids, labels).detach()
        trainer.apply_lora(model, trainer.LORA_TARGETS, rank=4, alpha=8)
        after = trainer.assistant_loss(model, ids, labels).detach()
        torch.testing.assert_close(after, before, rtol=0, atol=0)

    def test_only_adapters_get_gradients_and_change(self):
        torch.manual_seed(7)
        model = lora_model()
        trainer.apply_lora(model, trainer.LORA_TARGETS, rank=4, alpha=8)
        base = {name: p.detach().clone() for name, p in model.named_parameters() if not p.requires_grad}
        adapters = [p for p in model.parameters() if p.requires_grad]
        optimizer = torch.optim.AdamW(adapters, lr=1e-2, weight_decay=0.0)
        for step in range(2):
            ids, labels = batch(20 + step)
            optimizer.zero_grad(set_to_none=True)
            trainer.assistant_loss(model, ids, labels).backward()
            self.assertTrue(all(p.grad is not None for p in adapters))
            optimizer.step()
        for name, p in model.named_parameters():
            if not p.requires_grad:
                self.assertIsNone(p.grad)
                torch.testing.assert_close(p, base[name], rtol=0, atol=0)
        self.assertTrue(any(module.lora_b.abs().sum() > 0 for module in model.modules()
                            if isinstance(module, trainer.LoraLinear)))

    def test_merge_restores_the_layout_and_keeps_the_trained_behaviour(self):
        for tied in (False, True):
            with self.subTest(tied=tied):
                torch.manual_seed(13)
                model = lora_model(tied)
                layout = trainer.tensor_shapes(model)
                wrapped = trainer.apply_lora(model, trainer.LORA_TARGETS, rank=4, alpha=8)
                optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-2)
                for step in range(3):
                    ids, labels = batch(40 + step)
                    optimizer.zero_grad(set_to_none=True)
                    trainer.assistant_loss(model, ids, labels).backward()
                    optimizer.step()
                ids, labels = batch(99)
                model.eval()
                with torch.no_grad():
                    adapted = model(input_ids=ids).logits
                merged = trainer.merge_lora(model)
                self.assertEqual(merged, len(wrapped))
                self.assertFalse(any(isinstance(m, trainer.LoraLinear) for m in model.modules()))
                self.assertEqual(trainer.tensor_shapes(model), layout)
                with torch.no_grad():
                    torch.testing.assert_close(model(input_ids=ids).logits, adapted, rtol=1e-5, atol=1e-5)


if __name__ == '__main__':
    unittest.main()
