import unittest
import torch
from train.normalize_mlx import normalize


class NormalizationTests(unittest.TestCase):
    def test_preserves_norm_multiplier_and_convolution_values(self):
        multiplier = torch.tensor([0.8, 1.2], dtype=torch.bfloat16)
        convolution = torch.arange(8).reshape(2, 4, 1).float()
        gate = torch.tensor([2., 3.])
        result = normalize({
            'language_model.model.layers.0.input_layernorm.weight': multiplier,
            'language_model.model.layers.0.linear_attn.conv1d.weight': convolution,
            'language_model.model.layers.0.linear_attn.norm.weight': gate,
        })
        torch.testing.assert_close(result['model.layers.0.input_layernorm.weight'] + 1, multiplier.float())
        torch.testing.assert_close(result['model.layers.0.linear_attn.conv1d.weight'].transpose(1, 2), convolution)
        torch.testing.assert_close(result['model.layers.0.linear_attn.norm.weight'], gate)

    def test_rejects_hf_layout_to_prevent_double_normalization(self):
        with self.assertRaises(ValueError):
            normalize({'model.layers.0.linear_attn.conv1d.weight': torch.zeros(2, 1, 4)})


if __name__ == '__main__':
    unittest.main()
