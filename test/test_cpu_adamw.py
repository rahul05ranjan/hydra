"""Two real model updates compare local CPU optimizer state with normal AdamW."""
import importlib.util
from itertools import product
from pathlib import Path
import unittest

import torch

from test_assistant_loss import tiny_model

spec = importlib.util.spec_from_file_location('full_finetune', Path(__file__).resolve().parents[1] / 'train/full_finetune.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


class CpuAdamWTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def test_two_full_updates_match_adamw_with_grad_scaling_and_clipping(self):
        for tied, initial_scale in product((False, True), (512, 128)):
            with self.subTest(tied=tied, initial_scale=initial_scale):
                torch.manual_seed(42)
                reference = tiny_model(tied)
                candidate = tiny_model(tied)
                candidate.load_state_dict(reference.state_dict())
                standard = torch.optim.AdamW(reference.parameters(), lr=1e-5,
                    weight_decay=0.01, foreach=False)
                offloaded = trainer.CpuAdamW(candidate.parameters(), lr=1e-5,
                    weight_decay=0.01)
                regular_scaler = torch.amp.GradScaler('cpu', init_scale=initial_scale)
                offload_scaler = torch.amp.GradScaler('cpu', init_scale=initial_scale)
                for step in range(2):
                    torch.manual_seed(100 + step)
                    ids = torch.randint(0, 41, (1, 19))
                    labels = ids.clone()
                    labels[:, :12] = -100
                    for model, optimizer, scaler, is_offloaded in (
                            (reference, standard, regular_scaler, False),
                            (candidate, offloaded, offload_scaler, True)):
                        optimizer.zero_grad(set_to_none=True)
                        loss = trainer.assistant_loss(model, ids, labels)
                        scaler.scale(loss).backward()
                        scaler.unscale_(optimizer.gradient_optimizer if is_offloaded else optimizer)
                        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                        self.assertTrue(torch.isfinite(norm))
                        if is_offloaded:
                            optimizer.step()
                        else:
                            scaler.step(optimizer)
                        scaler.update()
                        optimizer.zero_grad(set_to_none=True)
                    for (name, expected), (actual_name, actual) in zip(
                            reference.named_parameters(), candidate.named_parameters()):
                        self.assertEqual(name, actual_name)
                        torch.testing.assert_close(actual, expected, rtol=1e-6, atol=1e-7)
                    self.assertEqual(regular_scaler.get_scale(), offload_scaler.get_scale())
                self.assertFalse(offloaded.gradient_optimizer.state)
                self.assertTrue(offloaded.optimizer.state)
                for state in offloaded.optimizer.state.values():
                    self.assertTrue(all(not torch.is_tensor(v) or v.device.type == 'cpu'
                        for v in state.values()))

    def test_cpu_gradient_buffers_are_allocated_once_and_reused(self):
        # A fresh ~3 GB of CPU gradient copies per update fragments host memory over a long run.
        torch.manual_seed(5)
        model = tiny_model()
        offloaded = trainer.CpuAdamW(model.parameters(), lr=1e-5, weight_decay=0.01)
        ids = torch.randint(0, 41, (1, 19))
        labels = ids.clone()
        labels[:, :12] = -100
        addresses = []
        for _ in range(3):
            offloaded.zero_grad(set_to_none=True)
            trainer.assistant_loss(model, ids, labels).backward()
            offloaded.step()
            addresses.append([buffer.data_ptr() for buffer in offloaded.gradient_buffers])
        self.assertEqual(len(offloaded.gradient_buffers), len(list(model.parameters())))
        self.assertEqual(addresses[0], addresses[1])
        self.assertEqual(addresses[1], addresses[2])

    def test_overflow_retry_does_not_update_weights_or_cpu_moments(self):
        torch.manual_seed(9)
        model = tiny_model()
        offloaded = trainer.CpuAdamW(model.parameters(), lr=1e-5, weight_decay=0.01)
        scaler = torch.amp.GradScaler('cpu', init_scale=65536)
        before = [p.detach().clone() for p in model.parameters()]
        ids = torch.randint(0, 41, (1, 19))
        labels = ids.clone()
        labels[:, :12] = -100
        offloaded.zero_grad(set_to_none=True)
        scaler.scale(trainer.assistant_loss(model, ids, labels)).backward()
        first = next(p for p in model.parameters() if p.grad is not None)
        first.grad.view(-1)[0] = float('inf')
        scaler.unscale_(offloaded.gradient_optimizer)
        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        self.assertFalse(torch.isfinite(norm))
        scaler.update(new_scale=scaler.get_scale() * scaler.get_backoff_factor())
        self.assertFalse(offloaded.optimizer.state)
        for actual, expected in zip(model.parameters(), before):
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        offloaded.zero_grad(set_to_none=True)
        scaler.scale(trainer.assistant_loss(model, ids, labels)).backward()
        scaler.unscale_(offloaded.gradient_optimizer)
        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        self.assertTrue(torch.isfinite(norm))
        offloaded.step()
        scaler.update()
        self.assertTrue(offloaded.optimizer.state)
        self.assertTrue(any(not torch.equal(actual, expected)
            for actual, expected in zip(model.parameters(), before)))


if __name__ == '__main__':
    unittest.main()
