"""Immutable, versioned exports; no credentials or business DB connections."""

from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, FiniteFloat,
    StringConstraints, model_validator,
)

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
RawText = Annotated[str, StringConstraints(min_length=1)]
Digest = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
def _as_utc(value: datetime) -> datetime:
    try:
        return value.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        raise ValueError("timestamp cannot be represented in UTC") from None


Timestamp = Annotated[AwareDatetime, AfterValidator(_as_utc)]
ReturnValue = Annotated[FiniteFloat, Field(strict=True)]
Quality = Literal["real", "synthetic", "placeholder", "missing", "stale"]


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class VersionBundle(FrozenModel):
    rubric_version: Text
    prompt_version: Text
    memory_release: Text
    model_id: Text
    model_config_digest: Digest
    tool_schema_digest: Digest
    safety_policy_digest: Digest
    evaluator_version: Text
    code_version: Text


class EvidenceSnapshot(FrozenModel):
    evidence_id: Text
    source: Text
    provider: Text
    content: RawText
    published_at: Timestamp | None = None
    available_at: Timestamp | None = None
    fetched_at: Timestamp
    quality: Quality


class MemoryReference(FrozenModel):
    memory_id: Text
    version: Text
    owner: Text
    content: RawText
    approved: bool
    approved_at: Timestamp | None = None
    available_at: Timestamp
    effective_from: Timestamp
    expires_at: Timestamp | None = None


class RuleExecution(FrozenModel):
    rule_id: Text
    rule_version: Text
    result: Literal["passed", "failed", "unknown", "unsupported", "disabled"]
    required: bool
    evidence_ids: tuple[Text, ...] = ()
    detail: Text


class ForecastTarget(FrozenModel):
    label_spec_version: Text
    horizon_trading_days: int = Field(gt=0, strict=True)
    target_at: Timestamp
    benchmark: Text
    currency: Text
    price_basis: Text
    cost_model: Text


class DecisionRecord(FrozenModel):
    schema_version: Literal[1] = 1
    decision_id: UUID
    run_id: Text
    owner: Text
    ticker: Text
    market: Text
    engine: Literal["agent", "workflow", "import"]
    decision_at: Timestamp
    information_cutoff_at: Timestamp
    bundle: VersionBundle
    evidence: tuple[EvidenceSnapshot, ...] = Field(min_length=1)
    original_rating: Text
    final_rating: Text
    action: Text
    rationale_summary: Text
    required_rule_ids: tuple[Text, ...]
    forecast_targets: tuple[ForecastTarget, ...]
    executed_rules: tuple[RuleExecution, ...] = ()
    cited_rule_ids: tuple[Text, ...] = ()
    memories: tuple[MemoryReference, ...] = ()

    @model_validator(mode="after")
    def consistent_snapshot(self):
        if self.information_cutoff_at > self.decision_at:
            raise ValueError("information cutoff must not follow decision")
        for label, ids in (
            ("evidence", [e.evidence_id for e in self.evidence]),
            ("executed rule", [r.rule_id for r in self.executed_rules]),
            ("memory", [m.memory_id for m in self.memories]),
            ("required rule", list(self.required_rule_ids)),
            ("forecast target", [(t.label_spec_version, t.horizon_trading_days)
                                 for t in self.forecast_targets]),
        ):
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {label} ids")
        if any(target.target_at <= self.decision_at for target in self.forecast_targets):
            raise ValueError("forecast target must follow decision")
        return self


class OutcomeRecord(FrozenModel):
    outcome_id: UUID
    decision_id: UUID
    label_spec_version: Text
    horizon_trading_days: int = Field(gt=0, strict=True)
    target_at: Timestamp
    observed_at: Timestamp | None = None
    status: Literal["pending", "matured", "unavailable", "invalid"]
    raw_return: ReturnValue | None = None
    benchmark_return: ReturnValue | None = None
    source: Text
    quality: Quality

    @model_validator(mode="after")
    def complete_mature_label(self):
        if self.status == "matured" and (
            self.observed_at is None or self.raw_return is None or self.benchmark_return is None
        ):
            raise ValueError("matured outcome requires observation time and both returns")
        return self


class ResearchCase(FrozenModel):
    decision: DecisionRecord
    outcomes: tuple[OutcomeRecord, ...] = ()

    @model_validator(mode="after")
    def unique_labels(self):
        ids = [o.outcome_id for o in self.outcomes]
        labels = [(o.label_spec_version, o.horizon_trading_days) for o in self.outcomes]
        if len(ids) != len(set(ids)) or len(labels) != len(set(labels)):
            raise ValueError("duplicate outcomes; supply one as-of revision per label/horizon")
        return self


class EligibilityIssue(FrozenModel):
    code: str
    subject: str
    detail: str


class EligibilityReport(FrozenModel):
    decision_id: UUID
    as_of: Timestamp
    replay_eligible: bool
    eligible_outcome_ids: tuple[UUID, ...]
    issues: tuple[EligibilityIssue, ...]
    limitation: str = (
        "Checks supplied metadata only; does not authenticate provenance, resolve "
        "model-training leakage, prove investment performance or authorize publication."
    )
