from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from athena_api.laya.runtime import SdkPredictor


class CpuThreadTests(unittest.TestCase):
    def test_cpu_threads_respect_available_processors_and_cuda_stays_two(self):
        for device, available, expected in [('cpu', 12, 4), ('cpu', 2, 2),
                                             ('cpu', 1, 1), ('cpu', None, 1),
                                             ('cuda', 12, 2)]:
            with self.subTest(device=device, available=available):
                torch = SimpleNamespace(set_num_threads=Mock(),
                    cuda=SimpleNamespace(is_available=lambda: True))
                load = Mock(return_value=SimpleNamespace(device=device))
                deployment = SimpleNamespace(checkpoint='checkpoint', verify_checkpoint=Mock())
                with patch.dict('sys.modules', {'torch':torch, 'laya':SimpleNamespace(load=load)}), \
                     patch('athena_api.laya.runtime.os.cpu_count', return_value=available), \
                     patch.dict('os.environ'):
                    SdkPredictor(deployment, device)
                torch.set_num_threads.assert_called_once_with(expected)
                load.assert_called_once_with('checkpoint', device=device, fast=False, compile=False)
                deployment.verify_checkpoint.assert_called_once_with()
