"""Host-side text tools and Linux git apply must agree on LF/CRLF bytes."""
import importlib.util
import subprocess

import pytest


def helpers():
    assert importlib.util.find_spec('agent_core.coder.patch_text'), 'newline-safe text helpers missing'
    from agent_core.coder import patch_text
    return patch_text


def git_apply(root, diff):
    return subprocess.run(['git', '-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', '-'], cwd=root,
                          input=diff.encode('utf-8'), capture_output=True)


def test_exact_edit_preserves_crlf_and_unaffected_mixed_line_endings():
    original = b'first\r\n  old\r\nlast\n'
    result = helpers().replace_text(original, '  old\n', '  new\n  inserted\n')
    assert result == b'first\r\n  new\r\n  inserted\r\nlast\n'
    assert helpers().replace_text(b'first\nold\n', 'old\n', 'new\r\n') == b'first\nnew\n'
    with pytest.raises(ValueError, match='exactly once'):
        helpers().replace_text(original, '\n old\n', '\nnew\n')
    with pytest.raises(ValueError, match='exactly once'):
        helpers().replace_text(b'old\r\nold\r\n', 'old\n', 'new\n')


def test_patch_applies_to_crlf_lf_and_new_files_without_rewriting_other_lines(tmp_path):
    (tmp_path / 'windows.txt').write_bytes(b'first\r\nold\r\nlast\r\n')
    (tmp_path / 'linux.txt').write_bytes(b'first\nold\nlast\n')
    diff = ('diff --git a/windows.txt b/windows.txt\n--- a/windows.txt\n+++ b/windows.txt\n'
            '@@ -1,3 +1,3 @@\n first\n-old\n+new\n last\n'
            'diff --git a/linux.txt b/linux.txt\n--- a/linux.txt\n+++ b/linux.txt\n'
            '@@ -1,3 +1,3 @@\n first\n-old\n+new\n last\n'
            'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n'
            '@@ -0,0 +1,2 @@\n+hello\n+world\n')
    result = git_apply(tmp_path, helpers().prepare_patch(tmp_path, diff))
    assert result.returncode == 0, result.stderr
    assert (tmp_path / 'windows.txt').read_bytes() == b'first\r\nnew\r\nlast\r\n'
    assert (tmp_path / 'linux.txt').read_bytes() == b'first\nnew\nlast\n'
    assert (tmp_path / 'new.txt').read_bytes() == b'hello\nworld\n'


def test_patch_preserves_no_final_newline_and_handles_hunk_header_like_content(tmp_path):
    (tmp_path / 'source.txt').write_bytes(b'first\r\n-- source\r\nlast')
    diff = ('--- a/source.txt\n+++ b/source.txt\n@@ -1,3 +1,3 @@\n first\n'
            '--- source\n+++ target\n last\n\\ No newline at end of file\n')
    result = git_apply(tmp_path, helpers().prepare_patch(tmp_path, diff))
    assert result.returncode == 0, result.stderr
    assert (tmp_path / 'source.txt').read_bytes() == b'first\r\n++ target\r\nlast'


def test_patch_keeps_exact_indentation_matching(tmp_path):
    original = b'first\r\n  old\r\nlast\r\n'
    (tmp_path / 'source.txt').write_bytes(original)
    diff = '--- a/source.txt\n+++ b/source.txt\n@@ -1,3 +1,3 @@\n first\n- old\n+ new\n last\n'
    result = git_apply(tmp_path, helpers().prepare_patch(tmp_path, diff))
    assert result.returncode != 0
    assert (tmp_path / 'source.txt').read_bytes() == original


@pytest.mark.parametrize('name', ['../../outside.txt', '/outside.txt', '.git/config', '.env', 'node_modules/x'])
def test_patch_preparation_rejects_unmanaged_paths(tmp_path, name):
    diff = f'--- /dev/null\n+++ b/{name}\n@@ -0,0 +1 @@\n+data\n'
    with pytest.raises(ValueError):
        helpers().prepare_patch(tmp_path, diff)


def test_patch_rejects_binary_and_link_changes(tmp_path):
    with pytest.raises(ValueError, match='text|binary'):
        helpers().prepare_patch(tmp_path, 'diff --git a/a b/a\nGIT binary patch\nliteral 1\n')
    with pytest.raises(ValueError, match='mode|regular'):
        helpers().prepare_patch(tmp_path, 'diff --git a/a b/a\nnew file mode 120000\n'
                              '--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+outside\n')


def test_harness_write_file_and_edit_file_preserve_their_documented_bytes(tmp_path):
    from agent_core.coder.general_harness import GeneralHarness
    from agent_core.coder.general_tools import EditFile, WriteFile
    from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask
    from agent_core.coder.task_store import TaskStore
    task = DevTask(id='dev_newlines', title='text', problem='text', workdir=str(tmp_path),
                   acceptance=[AcceptanceCriterion(id='a', description='text', check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / 'tasks')
    store.create(task)
    harness = GeneralHarness(task, None, store)
    try:
        revision = harness.journal.snapshot()
        harness.state = {'baseline': revision, 'revision': revision, 'verification': [], 'pending': None}
        harness._edit(WriteFile(path='source.txt', content='first\nold\n', reason='write'))
        assert (harness.workspace / 'source.txt').read_bytes() == b'first\nold\n'
        (harness.workspace / 'source.txt').write_bytes(b'first\r\nold\r\n')
        harness._edit(EditFile(path='source.txt', old_text='old\n', new_text='new\n', reason='edit'))
        assert (harness.workspace / 'source.txt').read_bytes() == b'first\r\nnew\r\n'
    finally:
        harness.journal.close()


def test_edit_schema_preserves_indentation_and_line_terminators():
    from agent_core.coder.general_tools import EditFile
    step = EditFile(path='source.txt', old_text='  old\r\n', new_text='  new\n', reason='edit')
    assert step.old_text == '  old\r\n'


def test_patch_handles_mixed_endings_and_quoted_paths(tmp_path):
    (tmp_path / 'space name.txt').write_bytes(b'first\r\nold\r\nlast\n')
    diff = ('--- "a/space name.txt"\n+++ "b/space name.txt"\n@@ -1,3 +1,3 @@\n'
            ' first\n-old\n+new\n last\n')
    result = git_apply(tmp_path, helpers().prepare_patch(tmp_path, diff))
    assert result.returncode == 0, result.stderr
    assert (tmp_path / 'space name.txt').read_bytes() == b'first\r\nnew\r\nlast\n'


def test_patch_handles_git_octal_utf8_path_and_crlf_deletion(tmp_path):
    name = '文.txt'
    (tmp_path / name).write_bytes(b'old\r\n')
    quoted = ''.join(f'\\{byte:03o}' for byte in name.encode('utf-8'))
    diff = (f'--- "a/{quoted}"\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n')
    result = git_apply(tmp_path, helpers().prepare_patch(tmp_path, diff))
    assert result.returncode == 0, result.stderr
    assert not (tmp_path / name).exists()
