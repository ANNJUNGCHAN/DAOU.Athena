import math
import unittest

from athena_api.laya.contracts import Contracts, DecisionError


def contract(force=False, labels=("yes", "no", "defer"), reject=("defer",)):
    return Contracts({"tasks": [{"task_id": "fixture", "instructions": "Choose.",
        "choices": [{"label": label, "description": label} for label in labels]}]},
        {"temperature": 1.0, "thresholds": {"fixture": 0.0},
         "reject_labels": list(reject), "force_non_defer": force})


class ForceChoiceTests(unittest.TestCase):
    def test_default_still_rejects_defer(self):
        result = contract().decide("fixture", [0, 1, 2])
        self.assertFalse(result["accepted"])
        self.assertEqual(result["label"], "defer")
        self.assertEqual(result["reason"], "defer")

    def test_forced_choice_uses_best_nonrejected_label_with_original_probability(self):
        result = contract(True).decide("fixture", [0, 1, 2])
        self.assertTrue(result["accepted"])
        self.assertEqual(result["label"], "no")
        self.assertAlmostEqual(result["confidence"], math.exp(1) / (1 + math.exp(1) + math.exp(2)))
        self.assertEqual(result["original_top_label"], "defer")
        self.assertTrue(result["defer_override"])

    def test_normal_non_defer_choice_and_default_contract_are_unchanged(self):
        self.assertEqual(contract(True).decide("fixture", [2, 1, 0]), contract().decide("fixture", [2, 1, 0]))

    def test_forced_choice_respects_all_rejected_labels(self):
        result = contract(True, reject=("defer", "no")).decide("fixture", [0, 1, 2])
        self.assertEqual(result["label"], "yes")
        with self.assertRaisesRegex(DecisionError, "no_eligible_choice"):
            contract(True, reject=("yes", "no", "defer")).decide("fixture", [0, 1, 2])

    def test_invalid_logits_are_not_forced_into_a_choice(self):
        for values in [[0], [0, float("nan"), 2], [0, 1, float("inf")]]:
            with self.assertRaisesRegex(DecisionError, "invalid_logits"):
                contract(True).decide("fixture", values)
