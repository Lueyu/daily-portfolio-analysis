"""Pure time/provenance gates, separate from research quality and market returns."""

from datetime import datetime

from .contracts import EligibilityIssue, EligibilityReport, ResearchCase


def assess_case(case: ResearchCase, *, as_of: datetime) -> EligibilityReport:
    """Check an exported snapshot, using an explicit clock (never wall time).

    A real, observed rule failure remains useful feedback. Unknown execution
    cannot be counted as a pass. No causal attribution is inferred from rule IDs.
    Outcomes are individual labels, not independent portfolio return samples.
    """
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must include a timezone")
    decision = case.decision
    issues: list[EligibilityIssue] = []

    def add(code: str, subject: str, detail: str) -> None:
        issues.append(EligibilityIssue(code=code, subject=subject, detail=detail))

    if decision.decision_at > as_of:
        add("future_decision", str(decision.decision_id), "Decision is after evaluation time.")

    cutoff = decision.information_cutoff_at
    for evidence in decision.evidence:
        key = evidence.evidence_id
        if evidence.quality != "real":
            add("non_real_evidence", key, "Only usable real evidence qualifies for replay.")
        if evidence.available_at is None:
            add("unknown_availability", key, "Historical availability must be explicit.")
        elif evidence.available_at > cutoff:
            add("future_availability", key, "Evidence became available after cutoff.")
        if evidence.published_at is not None and evidence.published_at > cutoff:
            add("future_publication", key, "Source was published after cutoff.")
        if evidence.fetched_at > decision.decision_at:
            add("late_retrieval", key, "Evidence was fetched after this decision.")
        if evidence.available_at is not None and (
            evidence.available_at > evidence.fetched_at
            or (evidence.published_at is not None and evidence.published_at > evidence.available_at)
        ):
            add("invalid_source_order", key, "Publication, availability and retrieval are inconsistent.")

    evidence_ids = {e.evidence_id for e in decision.evidence}
    required_rules = set(decision.required_rule_ids)
    for missing in sorted(required_rules - {r.rule_id for r in decision.executed_rules}):
        add("missing_required_rule", missing, "Required rule has no execution record.")
    for rule in decision.executed_rules:
        if (rule.required or rule.rule_id in required_rules) and rule.result in {"unknown", "unsupported", "disabled"}:
            add("unexecuted_required_rule", rule.rule_id, "Required rule was not evaluated.")
        if rule.result in {"passed", "failed"} and (
            not rule.evidence_ids or not set(rule.evidence_ids).issubset(evidence_ids)
        ):
            add("ungrounded_rule", rule.rule_id, "Execution must reference captured evidence.")

    for memory in decision.memories:
        if memory.owner != decision.owner or not memory.approved or memory.approved_at is None:
            add("unapproved_memory", memory.memory_id, "Memory owner/approval is incompatible.")
        if memory.available_at > cutoff or memory.effective_from > decision.decision_at:
            add("future_memory", memory.memory_id, "Memory was not usable at decision time.")
        if memory.approved_at is not None and memory.approved_at > cutoff:
            add("future_memory_approval", memory.memory_id, "Approval occurred after cutoff.")
        if memory.expires_at is not None and memory.expires_at <= decision.decision_at:
            add("expired_memory", memory.memory_id, "Memory had expired at decision time.")

    replay_eligible = not issues
    eligible = []
    targets = {(t.label_spec_version, t.horizon_trading_days): t for t in decision.forecast_targets}
    for outcome in case.outcomes:
        before = len(issues)
        key = str(outcome.outcome_id)
        if outcome.decision_id != decision.decision_id:
            add("wrong_decision", key, "Outcome belongs to another decision.")
        target = targets.get((outcome.label_spec_version, outcome.horizon_trading_days))
        if target is None or outcome.target_at != target.target_at:
            add("unregistered_outcome", key, "Label and horizon must match the frozen prediction target.")
        if outcome.status != "matured":
            add("outcome_not_matured", key, "Pending/unavailable/invalid is not a return label.")
        if outcome.quality != "real":
            add("non_real_outcome", key, "Outcome must use real observed data.")
        if outcome.target_at <= decision.decision_at:
            add("invalid_target", key, "Prediction target must follow decision.")
        if outcome.observed_at is not None and outcome.observed_at < outcome.target_at:
            add("premature_observation", key, "Outcome observed before its target time.")
        if outcome.target_at > as_of or outcome.observed_at is None or outcome.observed_at > as_of:
            add("outcome_not_observable", key, "Outcome was not available at evaluation time.")
        if replay_eligible and len(issues) == before:
            eligible.append(outcome.outcome_id)

    return EligibilityReport(
        decision_id=decision.decision_id, as_of=as_of, replay_eligible=replay_eligible,
        eligible_outcome_ids=tuple(eligible), issues=tuple(issues),
    )
