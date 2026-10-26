"""E0 data integrity tests; all inputs are fictional and no network is used."""

import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from uuid import UUID

import pytest
from pydantic import ValidationError


def case_payload():
    return {
        "decision": {
            "decision_id": "00000000-0000-0000-0000-000000000001",
            "run_id": "fixture-run", "owner": "fixture-owner", "ticker": "EXAMPLE",
            "market": "US", "engine": "agent",
            "decision_at": "2026-10-01T12:00:00Z",
            "information_cutoff_at": "2026-10-01T12:00:00Z",
            "bundle": {
                "rubric_version": "r1", "prompt_version": "p1", "memory_release": "m0",
                "model_id": "fixture-model", "model_config_digest": "a" * 64,
                "tool_schema_digest": "b" * 64, "safety_policy_digest": "c" * 64,
                "evaluator_version": "e0", "code_version": "fixture",
            },
            "evidence": [{
                "evidence_id": "e1", "source": "fixture://earnings", "provider": "fixture",
                "content": "Revenue was 100 units in the fictional example.",
                "published_at": "2026-10-01T10:00:00Z",
                "available_at": "2026-10-01T10:00:00Z",
                "fetched_at": "2026-10-01T11:00:00Z", "quality": "real",
            }],
            "original_rating": "Hold", "final_rating": "Hold", "action": "hold",
            "rationale_summary": "Fictional fixture, not an investment recommendation.",
            "required_rule_ids": ["r1"],
            "forecast_targets": [{
                "label_spec_version": "relative-return-v1", "horizon_trading_days": 5,
                "target_at": "2026-10-08T12:00:00Z", "benchmark": "EXAMPLE-INDEX",
                "currency": "USD", "price_basis": "total-return", "cost_model": "fixture-cost-v1",
            }],
            "executed_rules": [{
                "rule_id": "r1", "rule_version": "1", "result": "passed",
                "required": True, "evidence_ids": ["e1"], "detail": "Checked fixture.",
            }],
            "cited_rule_ids": ["r1"],
        },
        "outcomes": [{
            "outcome_id": "00000000-0000-0000-0000-000000000002",
            "decision_id": "00000000-0000-0000-0000-000000000001",
            "label_spec_version": "relative-return-v1", "horizon_trading_days": 5,
            "target_at": "2026-10-08T12:00:00Z", "observed_at": "2026-10-08T13:00:00Z",
            "status": "matured", "raw_return": 0.02, "benchmark_return": 0.01,
            "source": "fixture://prices", "quality": "real",
        }],
    }


def load_case(payload=None):
    from agent_core.evolution.contracts import ResearchCase
    return ResearchCase.model_validate(payload or case_payload())


def assess(payload=None, at="2026-10-17T00:00:00+00:00"):
    from agent_core.evolution.temporal import assess_case
    return assess_case(load_case(payload), as_of=datetime.fromisoformat(at))


def test_complete_snapshot_and_mature_outcome_are_eligible():
    report = assess()
    assert report.replay_eligible
    assert len(report.eligible_outcome_ids) == 1
    assert report.issues == ()


@pytest.mark.parametrize("field", ["decision_at", "information_cutoff_at"])
def test_naive_decision_times_are_rejected(field):
    payload = case_payload()
    payload["decision"][field] = "2026-10-01T12:00:00"
    with pytest.raises(ValidationError):
        load_case(payload)


def test_decision_cutoff_cannot_be_after_decision():
    payload = case_payload()
    payload["decision"]["information_cutoff_at"] = "2026-10-02T00:00:00Z"
    with pytest.raises(ValidationError):
        load_case(payload)


def test_nested_snapshots_are_frozen_and_unknown_fields_rejected():
    case = load_case()
    assert isinstance(case.decision.evidence, tuple)
    with pytest.raises(ValidationError):
        case.decision.evidence[0].content = "rewritten"
    payload = case_payload()
    payload["decision"]["approve_release"] = True
    with pytest.raises(ValidationError):
        load_case(payload)


@pytest.mark.parametrize("field,code", [
    ("published_at", "future_publication"),
    ("available_at", "future_availability"),
    ("fetched_at", "late_retrieval"),
])
def test_future_evidence_is_never_replay_eligible(field, code):
    payload = case_payload()
    payload["decision"]["evidence"][0][field] = "2026-10-02T00:00:00Z"
    report = assess(payload)
    assert not report.replay_eligible
    assert not report.eligible_outcome_ids
    assert code in {issue.code for issue in report.issues}


@pytest.mark.parametrize("quality", ["synthetic", "placeholder", "missing", "stale"])
def test_non_real_sources_cannot_become_learning_evidence(quality):
    payload = case_payload()
    payload["decision"]["evidence"][0]["quality"] = quality
    assert not assess(payload).replay_eligible


def test_unknown_availability_and_inverted_source_times_are_reported():
    payload = case_payload()
    payload["decision"]["evidence"][0]["available_at"] = None
    assert "unknown_availability" in {i.code for i in assess(payload).issues}
    payload["decision"]["evidence"][0]["available_at"] = "2026-09-30T00:00:00Z"
    assert "invalid_source_order" in {i.code for i in assess(payload).issues}


def test_duplicate_evidence_ids_are_rejected():
    payload = case_payload()
    payload["decision"]["evidence"] *= 2
    with pytest.raises(ValidationError):
        load_case(payload)


@pytest.mark.parametrize("result", ["unknown", "unsupported", "disabled"])
def test_required_rules_without_execution_block_eligibility(result):
    payload = case_payload()
    payload["decision"]["executed_rules"][0]["result"] = result
    assert not assess(payload).replay_eligible


def test_rule_citations_cannot_substitute_for_actual_evidence():
    payload = case_payload()
    payload["decision"]["executed_rules"][0]["evidence_ids"] = ["absent"]
    assert not assess(payload).replay_eligible
    payload["decision"]["executed_rules"][0]["evidence_ids"] = []
    assert not assess(payload).replay_eligible


def test_observed_failed_rule_is_valid_feedback_not_missing_data():
    payload = case_payload()
    payload["decision"]["executed_rules"][0]["result"] = "failed"
    assert assess(payload).replay_eligible


def test_memory_requires_owner_approval_and_historical_validity():
    payload = case_payload()
    valid = {
        "memory_id": "m1", "version": "1", "owner": "fixture-owner",
        "content": "Check units.", "approved": True,
        "approved_at": "2026-09-01T00:00:00Z",
        "available_at": "2026-09-01T00:00:00Z",
        "effective_from": "2026-09-01T00:00:00Z", "expires_at": None,
    }
    payload["decision"]["memories"] = [valid]
    assert assess(payload).replay_eligible
    for field, value in [("owner", "other"), ("approved", False),
                         ("approved_at", "2026-10-02T00:00:00Z"),
                         ("available_at", "2026-10-02T00:00:00Z"),
                         ("effective_from", "2026-10-02T00:00:00Z"),
                         ("expires_at", "2026-10-01T12:00:00Z")]:
        changed = copy.deepcopy(payload)
        changed["decision"]["memories"][0][field] = value
        assert not assess(changed).replay_eligible, field


def test_future_outcome_not_used_even_when_marked_matured():
    report = assess(at="2026-10-02T00:00:00+00:00")
    assert report.replay_eligible
    assert not report.eligible_outcome_ids
    assert "outcome_not_observable" in {i.code for i in report.issues}


def test_pending_outcomes_are_not_zero_return_losses():
    payload = case_payload()
    payload["outcomes"][0].update(status="pending", observed_at=None,
                                   raw_return=None, benchmark_return=None)
    assert not assess(payload).eligible_outcome_ids


@pytest.mark.parametrize("change", [
    {"decision_id": "00000000-0000-0000-0000-000000000009"},
    {"target_at": "2026-09-30T00:00:00Z"},
    {"observed_at": "2026-10-07T00:00:00Z"},
    {"quality": "synthetic"},
])
def test_invalid_or_unrelated_outcome_is_not_eligible(change):
    payload = case_payload()
    payload["outcomes"][0].update(change)
    assert not assess(payload).eligible_outcome_ids


def test_nonfinite_and_incomplete_mature_labels_are_rejected():
    for value in [None, float("nan"), float("inf")]:
        payload = case_payload()
        payload["outcomes"][0]["raw_return"] = value
        with pytest.raises(ValidationError):
            load_case(payload)


@pytest.mark.parametrize("field", ["raw_return", "benchmark_return"])
@pytest.mark.parametrize("value", [True, False])
def test_boolean_is_not_a_numeric_return(field, value):
    payload = case_payload()
    payload["outcomes"][0][field] = value
    with pytest.raises(ValidationError):
        load_case(payload)


def test_duplicate_horizons_cannot_double_count_outcomes():
    payload = case_payload()
    duplicate = copy.deepcopy(payload["outcomes"][0])
    duplicate["outcome_id"] = "00000000-0000-0000-0000-000000000003"
    payload["outcomes"].append(duplicate)
    with pytest.raises(ValidationError):
        load_case(payload)


def test_evaluation_before_decision_is_rejected_as_ineligible():
    assert not assess(at="2026-09-01T00:00:00+00:00").replay_eligible


def test_naive_evaluation_clock_is_rejected():
    from agent_core.evolution.temporal import assess_case
    with pytest.raises(ValueError):
        assess_case(load_case(), as_of=datetime(2026, 10, 17))


def test_journal_roundtrip_idempotence_and_content_conflict(tmp_path):
    from agent_core.evolution.journal import DecisionJournal
    journal = DecisionJournal(tmp_path)
    decision = load_case().decision
    path = journal.save(decision)
    assert journal.save(decision) == path
    assert journal.load(decision.decision_id) == decision
    changed = case_payload()
    changed["decision"]["evidence"][0]["content"] = "Changed source"
    with pytest.raises(ValueError, match="conflict"):
        journal.save(load_case(changed).decision)
    assert journal.load(decision.decision_id) == decision


def test_journal_preserves_same_day_runs_and_rejects_unsafe_id(tmp_path):
    from agent_core.evolution.journal import DecisionJournal
    journal = DecisionJournal(tmp_path)
    first = load_case().decision
    journal.save(first)
    payload = case_payload()
    payload["decision"]["decision_id"] = "00000000-0000-0000-0000-000000000004"
    second = load_case(payload).decision
    journal.save(second)
    assert len(list(tmp_path.glob("*.json"))) == 2
    with pytest.raises(ValueError):
        journal.load("../outside")


def test_journal_detects_corrupt_or_swapped_record(tmp_path):
    from agent_core.evolution.journal import DecisionJournal
    journal = DecisionJournal(tmp_path)
    decision = load_case().decision
    path = journal.save(decision)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["decision_id"] = "00000000-0000-0000-0000-000000000004"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError):
        journal.load(decision.decision_id)
    path.write_text('{"incomplete":', encoding="utf-8")
    with pytest.raises(ValueError):
        journal.load(decision.decision_id)


def test_concurrent_journal_publication_is_idempotent(tmp_path):
    from agent_core.evolution.journal import DecisionJournal
    journal = DecisionJournal(tmp_path)
    decision = load_case().decision
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda _: journal.save(decision), range(8)))
    assert len(set(paths)) == 1
    assert journal.load(decision.decision_id) == decision
    assert len(list(tmp_path.iterdir())) == 1


def test_missing_required_rule_is_not_silently_passed():
    payload = case_payload()
    payload["decision"]["executed_rules"] = []
    assert "missing_required_rule" in {i.code for i in assess(payload).issues}


def test_declared_required_rule_cannot_downgrade_its_required_flag():
    payload = case_payload()
    payload["decision"]["executed_rules"][0].update(result="unsupported", required=False)
    assert not assess(payload).replay_eligible


def test_outcome_must_match_prediction_target_frozen_in_decision():
    payload = case_payload()
    payload["outcomes"][0]["target_at"] = "2026-10-09T00:00:00Z"
    payload["outcomes"][0]["observed_at"] = "2026-10-10T00:00:00Z"
    assert "unregistered_outcome" in {i.code for i in assess(payload).issues}
    payload = case_payload()
    payload["outcomes"][0]["label_spec_version"] = "picked-after-profit"
    assert not assess(payload).eligible_outcome_ids


def test_empty_or_duplicate_forecast_targets_have_explicit_semantics():
    payload = case_payload()
    payload["decision"]["forecast_targets"] = []
    assert assess(payload).replay_eligible
    assert not assess(payload).eligible_outcome_ids
    payload = case_payload()
    payload["decision"]["forecast_targets"] *= 2
    with pytest.raises(ValidationError):
        load_case(payload)


def test_memory_approval_time_must_be_known():
    payload = case_payload()
    payload["decision"]["memories"] = [{
        "memory_id": "m1", "version": "1", "owner": "fixture-owner", "content": "Check units.",
        "approved": True, "approved_at": None, "available_at": "2026-09-01T00:00:00Z",
        "effective_from": "2026-09-01T00:00:00Z", "expires_at": None,
    }]
    assert not assess(payload).replay_eligible


def test_digest_tracks_content_and_normalizes_timezone(tmp_path):
    from agent_core.evolution.journal import decision_digest
    original = load_case().decision
    payload = case_payload()
    payload["decision"]["decision_at"] = "2026-10-01T20:00:00+08:00"
    assert decision_digest(original) == decision_digest(load_case(payload).decision)
    payload["decision"]["evidence"][0]["content"] = "different"
    assert decision_digest(original) != decision_digest(load_case(payload).decision)


def test_raw_evidence_content_is_not_silently_trimmed():
    payload = case_payload()
    payload["decision"]["evidence"][0]["content"] = "  raw evidence\n"
    assert load_case(payload).decision.evidence[0].content == "  raw evidence\n"


def test_concurrent_conflicting_records_do_not_overwrite(tmp_path):
    from agent_core.evolution.journal import DecisionJournal
    journal = DecisionJournal(tmp_path)
    first = load_case().decision
    payload = case_payload()
    payload["decision"]["action"] = "wait"
    second = load_case(payload).decision

    def save(record):
        try:
            journal.save(record)
            return "saved"
        except ValueError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [first, second])) == ["conflict", "saved"]
    assert journal.load(first.decision_id) in [first, second]
