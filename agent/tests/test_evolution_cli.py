import json

import pytest
from typer.testing import CliRunner

from agent_core.cli import app
from test_evolution import case_payload

runner = CliRunner()
AS_OF = "2026-10-17T00:00:00Z"


def write_case(tmp_path, quality="real"):
    payload = case_payload()
    payload["decision"]["evidence"][0]["quality"] = quality
    path = tmp_path / "case.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_validate_returns_json_without_loading_credentials_or_using_network(tmp_path, monkeypatch):
    import socket
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: pytest.fail("network access"))
    path = write_case(tmp_path)
    result = runner.invoke(app, ["evolution", "validate", str(path), "--as-of", AS_OF])
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout)["replay_eligible"] is True


def test_synthetic_fixture_is_blocked_but_has_machine_readable_diagnostics(tmp_path):
    path = write_case(tmp_path, "synthetic")
    result = runner.invoke(app, ["evolution", "validate", str(path), "--as-of", AS_OF])
    assert result.exit_code == 1
    report = json.loads(result.stdout)
    assert not report["replay_eligible"]
    assert report["eligible_outcome_ids"] == []


def test_record_preserves_failed_case_without_claiming_learning_eligibility(tmp_path):
    path = write_case(tmp_path, "synthetic")
    directory = tmp_path / "journal"
    args = ["evolution", "record", str(path), "--directory", str(directory), "--as-of", AS_OF]
    first = runner.invoke(app, args)
    second = runner.invoke(app, args)
    assert first.exit_code == second.exit_code == 0, first.output
    response = json.loads(first.stdout)
    assert response["offline_only"] is True
    assert response["eligibility"]["replay_eligible"] is False
    assert len(response["decision_digest"]) == 64
    assert len(list(directory.glob("*.json"))) == 1


@pytest.mark.parametrize("content", ["{broken", '{"secret_value":"DO_NOT_ECHO"}', "[]"])
def test_invalid_input_does_not_echo_values_or_traceback(tmp_path, content):
    path = tmp_path / "bad.json"
    path.write_text(content, encoding="utf-8")
    result = runner.invoke(app, ["evolution", "validate", str(path), "--as-of", AS_OF])
    assert result.exit_code == 2
    assert "Invalid case" in result.output
    assert "DO_NOT_ECHO" not in result.output
    assert "Traceback" not in result.output


@pytest.mark.parametrize("clock", ["yesterday", "2026-10-17T00:00:00", "0001-01-01T00:00:00+01:00"])
def test_invalid_clock_is_concise_failure(tmp_path, clock):
    result = runner.invoke(app, ["evolution", "validate", str(write_case(tmp_path)), "--as-of", clock])
    assert result.exit_code == 2
    assert "timezone" in result.output


def test_missing_input_file_is_concise_failure(tmp_path):
    result = runner.invoke(app, ["evolution", "validate", str(tmp_path / "absent.json"), "--as-of", AS_OF])
    assert result.exit_code == 2
    assert "Cannot read case" in result.output
    assert "Traceback" not in result.output


def test_record_conflict_has_nonzero_exit(tmp_path):
    path = write_case(tmp_path)
    args = ["evolution", "record", str(path), "--directory", str(tmp_path / "journal"), "--as-of", AS_OF]
    assert runner.invoke(app, args).exit_code == 0
    payload = json.loads(path.read_text())
    payload["decision"]["action"] = "changed"
    path.write_text(json.dumps(payload))
    result = runner.invoke(app, args)
    assert result.exit_code == 2
    assert "conflict" in result.output


def test_out_of_range_utc_conversion_does_not_leak_input(tmp_path):
    path = write_case(tmp_path)
    payload = json.loads(path.read_text())
    payload["decision"]["decision_at"] = "0001-01-01T00:00:00+01:00"
    payload["decision"]["rationale_summary"] = "DO_NOT_ECHO"
    path.write_text(json.dumps(payload))
    result = runner.invoke(app, ["evolution", "validate", str(path), "--as-of", AS_OF])
    assert result.exit_code == 2
    assert "Invalid case" in result.output
    assert "DO_NOT_ECHO" not in result.output
    assert "Traceback" not in result.output
