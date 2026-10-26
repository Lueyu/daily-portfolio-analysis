"""Test report evidence must survive pipelines that hide a failing exit code."""
import pytest

from agent_core.coder.general_state import assertions_passed


@pytest.mark.parametrize("report", [
    "# tests 9\n# pass 8\n# fail 1\n# cancelled 0",
    "ℹ tests 9\nℹ pass 8\nℹ fail 0\nℹ cancelled 1",
    "# pass 8\n# canceled 1",
    "# pass 8\n# errors 2",
    "================ 1 failed, 8 passed in 0.22s ================",
    "8 passed, 2 errors in 0.22s",
    "1 error, 8 passed in 0.22s",
    "Test Files  1 failed | 2 passed (3)\nTests  8 passed (8)",
    "Test Files  1 passed (1)\nTests  1 failed | 8 passed (9)",
    "Tests  8 passed (8)\nErrors  1 error",
    "Tests  8 passed (8)\nErrors  2 errors",
    '\x1b[32mTests\x1b[0m  8 passed (8)\n\x1b[31mErrors\x1b[0m  1 error',
    '{"passed":8,"failed":1}',
    '{"passed":8,"cancelled":1}',
    '{"passed":8,"errors":1}',
])
def test_positive_assertions_do_not_hide_failed_report_counts(report):
    assert not assertions_passed(report)


@pytest.mark.parametrize("report", [
    "1 passed; assertions checked",
    "================ 8 passed, 2 skipped in 0.22s ================",
    "Test Files  1 passed (1)\nTests  8 passed | 1 skipped (9)",
    "# pass 8\n# fail 0\n# cancelled 0\n# skipped 2",
    "ℹ pass 8\nℹ fail 0\nℹ cancelled 0",
    "assertions passed: 1",
    "assertion passed = 2",
    '{"passed":8,"failed":0,"errors":0}',
    "logged failed request; retry was expected\n8 passed in 0.22s",
    "request failed: 2; handled by test\n8 passed in 0.22s",
    "error: simulated upstream failure\n# pass 8\n# fail 0",
    'test log: {"errors":2}\n8 passed in 0.22s',
    "8 passed, 1 xfailed in 0.22s",
])
def test_successful_reports_and_expected_failure_logs_remain_valid(report):
    assert assertions_passed(report)


@pytest.mark.parametrize("report", ["", "0 passed", "# pass 0\n# fail 0", "all good"])
def test_no_executed_positive_assertions_is_not_evidence(report):
    assert not assertions_passed(report)
