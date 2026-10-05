"""Turn-scoped semantic context. A turn ticket is not execution permission."""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
import asyncio
import secrets
import time


class TurnExpired(ValueError):
    pass


class SemanticService:
    def __init__(self, client, *, clock=time.monotonic, ttl=600, capacity=128):
        self.client, self.clock, self.ttl, self.capacity = client, clock, ttl, capacity
        self.turns = OrderedDict()
        self.dispatch_locks = {}

    def register(self, *, lease_id, generation_id, conversation_id, turn_id, utterance,
                 context, origin, protected_fields=None):
        # Starting a new turn in one conversation retires that conversation's old
        # ticket. Other conversations/briefings have independent immutable contexts.
        self._prune()
        for ticket, turn in list(self.turns.items()):
            if (turn["lease_id"] == lease_id or
                    (turn["conversation_id"] == conversation_id and turn["origin"] == origin)):
                del self.turns[ticket]
                self.dispatch_locks.pop(ticket, None)
        ticket = secrets.token_urlsafe(32)
        self.turns[ticket] = {"conversation_id": conversation_id, "turn_id": turn_id,
                              "lease_id": lease_id, "generation_id": generation_id,
                              "utterance": utterance, "context": deepcopy(context), "origin": origin,
                              "protected_fields": deepcopy(protected_fields or {}),
                              "decisions": {},
                              "expires_at": self.clock() + self.ttl}
        while len(self.turns) > self.capacity:
            oldest, _ = self.turns.popitem(last=False)
            self.dispatch_locks.pop(oldest, None)
        return ticket

    def _prune(self):
        for ticket, turn in list(self.turns.items()):
            if turn["expires_at"] <= self.clock():
                del self.turns[ticket]
                self.dispatch_locks.pop(ticket, None)

    def context(self, ticket, *, lease_id=None, generation_id=None):
        self._prune()
        turn = self.turns.get(ticket)
        if turn is None:
            raise TurnExpired("turn_expired")
        if (lease_id is not None and not secrets.compare_digest(turn["lease_id"], lease_id)
                or generation_id is not None and not secrets.compare_digest(turn["generation_id"], generation_id)):
            raise TurnExpired("turn_binding_mismatch")
        return deepcopy(turn)

    def retire(self, ticket):
        self.turns.pop(ticket, None)
        self.dispatch_locks.pop(ticket, None)

    async def decide(self, ticket, decisions, *, lease_id=None, generation_id=None):
        turn = self.context(ticket, lease_id=lease_id, generation_id=generation_id)
        if turn["origin"] == "backtest":
            return [{"task_id": item["task_id"], "accepted": False, "reason": "excluded_scope"}
                    for item in decisions]
        keys = [(item["task_id"], item.get("candidate_id")) for item in decisions]
        missing = [item for item, key in zip(decisions, keys, strict=True) if key not in turn["decisions"]]
        requests = [{"task_id": item["task_id"], "utterance": turn["utterance"],
                     "context": turn["context"], **({"candidate_id": item["candidate_id"]}
                     if item.get("candidate_id") else {})} for item in missing]
        result = await self.client.decide(requests) if requests else []
        # Awaiting inference never makes a superseded turn current again.
        current = self.context(ticket)
        if current["turn_id"] != turn["turn_id"]:
            raise TurnExpired("turn_expired")
        for item, row in zip(missing, result, strict=True):
            self.turns[ticket]["decisions"][(item["task_id"], item.get("candidate_id"))] = deepcopy(row)
        return [deepcopy(self.turns[ticket]["decisions"][key]) for key in keys]

    async def direct_dispatch(self, ticket, dispatch):
        from athena_api.laya.native import plan_native
        lock = self.dispatch_locks.setdefault(ticket, asyncio.Lock())
        async with lock:
            turn = self.context(ticket)
            if "dispatch_result" in turn:
                return turn["dispatch_result"]
            plan = await plan_native(self, ticket)
            if not plan["complete"]:
                return {**plan, "applied": False}
            self.turns[ticket]["dispatch_result"] = {
                **plan, "applied": False, "reason": "dispatch_outcome_unknown"}
            try:
                result = await dispatch(plan["tool_name"], plan["arguments"])
            except Exception:
                result = {"isError": True, "content": [{"type": "text", "text": "Native handler failed."}]}
            self.context(ticket)
            response = {**plan, "applied": not result.get("isError", False), "result": result}
            self.turns[ticket]["dispatch_result"] = deepcopy(response)
            self.turns[ticket]["route_consumed"] = True
            return response
