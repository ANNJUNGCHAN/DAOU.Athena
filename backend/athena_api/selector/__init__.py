"""Deterministic, allowlisted operation selection for LLM clients."""

from importlib import import_module
from typing import TYPE_CHECKING, Any

from .catalog import OperationCatalog, OperationDocument, build_operation_catalog

if TYPE_CHECKING:
    from .instrument_identity import InstrumentIdentityIndex, TargetResolution
    from .plans import PlanSigner
    from .primitive_evidence import TargetResolver
    from .service import SelectorService

__all__ = [
    "OperationCatalog",
    "OperationDocument",
    "InstrumentIdentityIndex",
    "PlanSigner",
    "SelectorService",
    "TargetResolution",
    "TargetResolver",
    "build_operation_catalog",
]

_LAZY_EXPORTS = {
    "InstrumentIdentityIndex": (".instrument_identity", "InstrumentIdentityIndex"),
    "PlanSigner": (".plans", "PlanSigner"),
    "SelectorService": (".service", "SelectorService"),
    "TargetResolution": (".instrument_identity", "TargetResolution"),
    "TargetResolver": (".primitive_evidence", "TargetResolver"),
}


def __getattr__(name: str) -> Any:
    """Keep execution-capable selector imports lazy for metadata-only consumers."""
    target = _LAZY_EXPORTS.get(name)
    if target is not None:
        module_name, attribute = target
        value = getattr(import_module(module_name, __name__), attribute)
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
