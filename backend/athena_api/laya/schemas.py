"""Bounded decision inputs and a proposal-only response contract."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

ABSTAIN = "abstain"
TaskName = Literal["operation_selection"]


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$")
    label: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=500)


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    task: TaskName
    text: str = Field(min_length=1, max_length=6000)
    candidates: list[Candidate] = Field(min_length=2, max_length=9)

    @model_validator(mode="after")
    def validate_task(self) -> Self:
        ids = [candidate.id for candidate in self.candidates]
        if len(ids) != len(set(ids)) or ABSTAIN in ids:
            raise ValueError("Candidate IDs must be unique and cannot be abstain")
        return self


class DecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["accepted", "fallback"]
    task: TaskName
    choice: str | None = None
    confidence: float | None = None
    probabilities: dict[str, float] = Field(default_factory=dict)
    reason: str
