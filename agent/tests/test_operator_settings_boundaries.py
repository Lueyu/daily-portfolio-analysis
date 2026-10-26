"""Operator credentials must stay outside every actual task, not only defaults."""
import json
import pytest
from typer.testing import CliRunner

from agent_core.config import Settings
from agent_core.coder.cli import app
from agent_core.coder.general_harness import GeneralHarness
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask
from agent_core.coder.task_store import TaskStore


@pytest.mark.parametrize("protected_field", ["coder_settings_path", "coder_mcp_config"])
@pytest.mark.parametrize("exists", [True, False])
def test_actual_task_root_cannot_contain_operator_config_before_any_seeding(tmp_path, protected_field, exists):
    source = tmp_path / "custom-task-root"
    source.mkdir()
    protected = source / "operator" / "settings.json"
    if exists:
        protected.parent.mkdir()
        protected.write_text('{"apiKey":"PRIVATE_OPERATOR_SECRET"}', encoding="utf-8")
    settings = Settings(_env_file=None, webapp_workdir=str(tmp_path / "different-default-root"),
                        **{protected_field: str(protected)})
    task = DevTask(id="dev_boundary", title="boundary", problem="inspect source",
                   workdir=str(source), runtime_version=2,
                   acceptance=[AcceptanceCriterion(id="a", description="works", check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / "tasks")
    with pytest.raises(ValueError, match="operator configuration") as error:
        GeneralHarness(task, None, store, settings=settings)
    assert "PRIVATE_OPERATOR_SECRET" not in str(error.value)
    assert not (store.root / task.id / "runtime").exists()
    if exists:
        assert "PRIVATE_OPERATOR_SECRET" in protected.read_text(encoding="utf-8")


@pytest.mark.parametrize("command", [["settings"], ["settings-save"],
                                      ["settings-test", "--target", "primary"]])
def test_cli_settings_never_echoes_pydantic_input_values(tmp_path, command):
    result = CliRunner().invoke(app, [*command, "--json"], input="{}", env={
        "CODER_MODEL_TIER": "MISPLACED_PRIVATE_TOKEN",
        "CODER_SETTINGS_PATH": str(tmp_path / "operator.json"),
        "WEBAPP_WORKDIR": str(tmp_path / "project"),
    })
    assert result.exit_code == 0
    assert "MISPLACED_PRIVATE_TOKEN" not in result.output
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload["ok"] is False and payload["message"]
