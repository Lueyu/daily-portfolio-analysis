"""Tests for the append-only JSONL checkpoint store (no network needed)."""

from agent_core.runtime.checkpoint import CheckpointStore, replay


def test_append_numbers_events_sequentially(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    cp = store.create("run-1")

    e0 = store.append(cp, "run_started", {"symbol": "AAPL"})
    e1 = store.append(cp, "tool_called", {"tool": "get_quote"})
    e2 = store.append(cp, "finished", {"rating": "Buy"})

    events = store.load(cp)
    assert [e["seq"] for e in events] == [0, 1, 2]
    assert events[0]["type"] == "run_started"
    assert events[1]["payload"] == {"tool": "get_quote"}
    assert events[2]["payload"]["rating"] == "Buy"
    assert e0["ts"] <= e1["ts"] <= e2["ts"]


def test_log_is_persisted_as_one_json_object_per_line(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    cp = store.create("run-2")
    store.append(cp, "a")
    store.append(cp, "b")

    lines = cp.path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert lines[0].startswith('{"seq": 0, "type": "a"')


def test_load_missing_run_returns_empty(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    assert store.load(store.create("absent")) == []


def test_replay_rebuilds_final_state(tmp_path) -> None:
    store = CheckpointStore(tmp_path)
    cp = store.create("run-3")
    store.append(cp, "set_steps", {"steps": []})
    store.append(cp, "step_done", {"name": "quote"})
    store.append(cp, "step_done", {"name": "holdings"})
    store.append(cp, "set_rating", {"rating": "Buy"})

    def reducer(state: dict, event: dict) -> dict:
        if event["type"] == "set_steps":
            state["steps"] = list(event["payload"]["steps"])
        elif event["type"] == "step_done":
            state["steps"].append(event["payload"]["name"])
        elif event["type"] == "set_rating":
            state["rating"] = event["payload"]["rating"]
        return state

    final = replay(store.load(cp), {"steps": [], "rating": None}, reducer)
    assert final == {"steps": ["quote", "holdings"], "rating": "Buy"}


def test_replay_then_append_continues_seq_after_restart(tmp_path) -> None:
    """Simulate a restart: a second store instance over the same log must keep
    appending with the correct next sequence number."""
    store = CheckpointStore(tmp_path)
    cp = store.create("run-4")
    store.append(cp, "one")

    store2 = CheckpointStore(tmp_path)
    event = store2.append(cp, "two")
    assert event["seq"] == 1
    assert [e["seq"] for e in store2.load(cp)] == [0, 1]
