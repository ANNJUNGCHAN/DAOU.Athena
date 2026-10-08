"""The inference contract is the same choice/state format used for training."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def bound_json(path: Path, expected: str) -> dict:
    content = path.read_bytes()
    if not isinstance(expected, str) or hashlib.sha256(content).hexdigest() != expected:
        raise ValueError("artifact_hash_mismatch")
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError("artifact_not_object")
    return value


class DecisionError(ValueError):
    """A fixed reason code, never source text or a provider exception."""


class Contracts:
    def __init__(self, catalog: dict, policy: dict):
        self.tasks = {task["task_id"]: task for task in catalog["tasks"]}
        if len(self.tasks) != len(catalog["tasks"]):
            raise ValueError("duplicate_task")
        self.banks = {
            task["candidate_bank"]: {c["candidate_id"]: c for c in catalog[task["candidate_bank"]]}
            for task in self.tasks.values() if task.get("candidate_bank")
        }
        self.temperature = float(policy["temperature"])
        if not math.isfinite(self.temperature) or not 0.5 <= self.temperature <= 5:
            raise ValueError("invalid_temperature")
        self.thresholds = policy["thresholds"]
        if any(not isinstance(v, (float, int)) or isinstance(v, bool)
               or not math.isfinite(v) or not 0 <= v <= 1.000001
               for v in self.thresholds.values()):
            raise ValueError("invalid_threshold")
        self.reject_labels = frozenset(policy.get("reject_labels", ["defer"])) | {"defer"}
        self.force_non_defer = policy.get("force_non_defer") is True
        for task in self.tasks.values():
            labels = [choice["label"] for choice in task["choices"]]
            if len(labels) < 2 or len(set(labels)) != len(labels):
                raise ValueError("invalid_choices")

    def encode(self, request: dict) -> tuple[str, dict]:
        task = self.tasks.get(request.get("task_id"))
        if task is None:
            raise DecisionError("unknown_task")
        utterance, context = request.get("utterance"), request.get("context", {})
        if not isinstance(utterance, str) or not utterance.strip():
            raise DecisionError("missing_utterance")
        if not isinstance(context, (dict, str)):
            raise DecisionError("invalid_context")
        if len(utterance) > 4000 or len(canonical(context)) > 10000:
            raise DecisionError("oversized_input")
        if task["task_id"].startswith("memory.") and not context:
            raise DecisionError("memory_target_required")
        state = {"utterance": utterance, "context": context}
        bank = task.get("candidate_bank")
        if bank:
            candidate = self.banks[bank].get(request.get("candidate_id"))
            if candidate is None:
                raise DecisionError("unknown_candidate")
            if isinstance(context, dict) and any(k in context for k in ("candidate", "candidate_contract")):
                raise DecisionError("candidate_override")
            state["candidate"] = {
                key: candidate[key] for key in
                ("description", "name", "kind", "domain", "field", "value", "field_description")
                if key in candidate
            }
        question = {"t": "choice", "ins": task["instructions"],
                    "crit": {c["label"]: c["description"] for c in task["choices"]}}
        return canonical(state), question

    def decide(self, task_id: str, logits: list[float]) -> dict:
        labels = [choice["label"] for choice in self.tasks[task_id]["choices"]]
        if len(logits) != len(labels) or not all(math.isfinite(v) for v in logits):
            raise DecisionError("invalid_logits")
        # Raw logits, one temperature application. SDK's rounded entropy/confidence
        # fields are not the probability used to select evaluation thresholds.
        scaled = [value / self.temperature for value in logits]
        weights = [math.exp(value - max(scaled)) for value in scaled]
        probabilities = [weight / sum(weights) for weight in weights]
        index = max(range(len(labels)), key=probabilities.__getitem__)
        original_index = index
        if self.force_non_defer:
            eligible = [i for i, label in enumerate(labels) if label not in self.reject_labels]
            if not eligible:
                raise DecisionError("no_eligible_choice")
            index = max(eligible, key=probabilities.__getitem__)
        label, confidence = labels[index], probabilities[index]
        threshold = self.thresholds.get(task_id, 1.000001)
        reason = ("reject_all" if threshold > 1 else "defer" if label in self.reject_labels
                  else "below_threshold" if confidence < threshold else "accepted")
        return {"task_id": task_id, "label": label, "confidence": confidence,
                "threshold": threshold, "accepted": reason == "accepted", "reason": reason,
                **({"original_top_label": labels[original_index], "defer_override": True}
                   if index != original_index else {})}


class Deployment:
    """An explicit local artifact binding; never downloads or selects a model."""
    def __init__(self, path: Path):
        path = path.resolve()
        self.manifest_sha256 = sha256(path)
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schema_version") != 1 or not value.get("model_id"):
            raise ValueError("invalid_deployment")
        resolve = lambda key: (path.parent / value[key]).resolve()
        self.checkpoint = resolve("checkpoint_path")
        self.catalog_path, self.policy_path = resolve("catalog_path"), resolve("policy_path")
        catalog = bound_json(self.catalog_path, value["catalog_sha256"])
        policy = bound_json(self.policy_path, value["policy_sha256"])
        self.contracts = Contracts(catalog, policy)
        self.files = value["checkpoint_sha256"]
        required = {"model.safetensors", "rl_agent_config.json", "encoder/config.json",
                    "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"}
        if not required.issubset(self.files):
            raise ValueError("incomplete_checkpoint_binding")
        self.verify_checkpoint()
        cfg = json.loads((self.checkpoint / "rl_agent_config.json").read_text(encoding="utf-8"))
        self.max_len, self.head_max_len = int(cfg["max_len"]), int(cfg["head_max_len"])
        if not 0 < self.head_max_len < self.max_len <= 32768:
            raise ValueError("invalid_sequence_limits")
        if (abs(float(cfg.get("temperature", [1])[0]) - self.contracts.temperature) > 1e-12
                or cfg.get("temperature_by_options") or cfg.get("lang_temperatures")):
            raise ValueError("checkpoint_policy_temperature_mismatch")
        tokenizer_cfg = json.loads((self.checkpoint / "tokenizer/tokenizer_config.json").read_text(encoding="utf-8"))
        if (tokenizer_cfg.get("tokenizer_class") in (None, "TokenizersBackend")
                or isinstance(tokenizer_cfg.get("extra_special_tokens"), list)):
            raise ValueError("mutable_tokenizer_config")
        self.identity = {"model_id": value["model_id"], "deployment_sha256": self.manifest_sha256,
                         "catalog_sha256": value["catalog_sha256"], "policy_sha256": value["policy_sha256"],
                         "weights_sha256": self.files["model.safetensors"]}

    def verify_checkpoint(self):
        for name, digest in self.files.items():
            file = (self.checkpoint / name).resolve()
            if not file.is_relative_to(self.checkpoint) or sha256(file) != digest:
                raise ValueError("checkpoint_hash_mismatch")
