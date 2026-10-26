"""A returned source page must reach the model intact in either protocol."""
import json
from types import SimpleNamespace

import pytest

from agent_core.coder.react_loop import ReactLoop, _Pending
from agent_core.coder.scratchpad import Scratchpad
from agent_core.coder.tools import ControlledTools


@pytest.mark.parametrize("native", [True, False])
def test_large_source_page_keeps_all_lines_through_loop_and_scratchpad(tmp_path, native):
    # Valid JavaScript string literals exercise JSON escaping in the harness
    # envelope, not just a large unstructured blob or a mirrored size constant.
    lines = [f'const escaped_{number:03d} = "' + "\\\\" * 18 + '";'
             for number in range(1, 181)]
    (tmp_path / "escaped-paths.js").write_text("\n".join(lines), encoding="utf-8")
    page = ControlledTools(tmp_path).read_file_page("escaped-paths.js", max_lines=200)
    assert page.endswith("EOF")
    assert len(page) > 6000
    observation = json.dumps({"output": page, "target": "escaped-paths.js"}, ensure_ascii=False)
    assert len(observation) > 14000  # Escaping must not trigger a second, lossy clip.

    pad = Scratchpad("system", "task")
    call = _Pending("read-1" if native else None, "read_file", {"path": "escaped-paths.js"})
    if native:
        pad.assistant_tool_calls("", [{"id": "read-1", "type": "function", "function": {
            "name": "read_file", "arguments": '{"path":"escaped-paths.js","max_lines":200}'}}])
    else:
        pad.assistant_text('{"action":"read_file","params":{"path":"escaped-paths.js","max_lines":200}}')
    ReactLoop._feedback(SimpleNamespace(supports_tools=native), pad, call, observation)
    pad.compact()
    delivered = pad.messages[-1]["content"]
    assert delivered == page
    assert "...[output truncated]..." not in delivered
    for number, line in enumerate(lines, 1):
        assert f"{number}: {line}" in delivered


@pytest.mark.parametrize("native", [True, False])
def test_other_tool_results_keep_the_original_small_budget(native):
    pad = Scratchpad("system", "task")
    call = _Pending("terminal-1" if native else None, "terminal_poll", {})
    ReactLoop._feedback(SimpleNamespace(supports_tools=native), pad, call, "log line\n" * 1500)
    assert len(pad.messages[-1]["content"]) <= 6000
    assert "...[output truncated]..." in pad.messages[-1]["content"]
