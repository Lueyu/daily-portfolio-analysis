"""Match exact text while keeping source line endings independent of the host OS.

Only line terminators are adapted. Spaces, tabs and all other context bytes must
still match; git apply remains responsible for validating and applying hunks.
"""
from __future__ import annotations

import re
from pathlib import Path

from .checkpoints import UnsafePathError
from .general_state import source_path


def replace_text(original: bytes, old_text: str, new_text: str) -> bytes:
    raw = original.decode('utf-8')
    normalized, boundaries = [], [0]
    index = 0
    while index < len(raw):
        if raw[index:index + 2] == '\r\n':
            normalized.append('\n')
            index += 2
        else:
            normalized.append(raw[index])
            index += 1
        boundaries.append(index)
    observed = ''.join(normalized)
    target = old_text.replace('\r\n', '\n')
    if not target or observed.count(target) != 1:
        raise ValueError('old_text must match exactly once; read the current file again')
    start = observed.index(target)
    begin, end = boundaries[start], boundaries[start + len(target)]
    ending = re.search(r'\r\n|\n', raw[begin:end]) or re.search(r'\r\n|\n', raw[begin:])
    ending = ending or re.search(r'\r\n|\n', raw)
    eol = ending.group() if ending else '\n'
    replacement = new_text.replace('\r\n', '\n').replace('\n', eol)
    return (raw[:begin] + replacement + raw[end:]).encode('utf-8')


def _lines(text: str) -> list[str]:
    parts = text.split('\n')
    return [value + '\n' for value in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def _path(workspace: Path, header: str) -> Path | None:
    value = header[4:].rstrip('\r\n').split('\t', 1)[0]
    if value.startswith('"'):
        # Git quotes non-ASCII path bytes using three-digit octal escapes.
        if not value.endswith('"'):
            raise ValueError('Invalid quoted patch path')
        data = bytearray()
        content, index = value[1:-1], 0
        escapes = {'a': 7, 'b': 8, 't': 9, 'n': 10, 'v': 11, 'f': 12, 'r': 13, '"': 34, '\\': 92}
        while index < len(content):
            if content[index] != '\\':
                data.extend(content[index].encode('utf-8'))
                index += 1
                continue
            escaped = content[index + 1:index + 4]
            if re.fullmatch(r'[0-7]{3}', escaped):
                data.append(int(escaped, 8))
                index += 4
            elif len(escaped) and escaped[0] in escapes:
                data.append(escapes[escaped[0]])
                index += 2
            else:
                raise ValueError('Invalid quoted patch path escape')
        value = data.decode('utf-8')
    if value == '/dev/null':
        return None
    if not value.startswith(('a/', 'b/')):
        raise ValueError('Text patch paths must use a/ and b/ prefixes')
    try:
        return source_path(workspace, value[2:])
    except UnsafePathError as exc:
        raise ValueError(f'Unsafe patch path: {value}') from exc


def prepare_patch(workspace: Path, diff: str) -> str:
    """Adapt LF hunk payloads to each existing source's CRLF where necessary.

    File headers and hunk metadata always use LF. New files keep the supplied
    payload endings. Mixed-EOL sources use exact hunk positions for EOL choice;
    an offset/ambiguous mixed-EOL patch is rejected instead of guessed.
    """
    lines, output = _lines(diff), []
    source = []
    endings = set()
    default_eol = '\n'
    addition_eol = '\n'
    old_left = new_left = old_cursor = 0
    headers = hunks = 0
    ready = False
    for index, line in enumerate(lines):
        if old_left or new_left:
            prefix = line[:1]
            if prefix == '\\' and line.rstrip('\r\n') == '\\ No newline at end of file':
                output.append(line.rstrip('\r\n') + '\n')
                continue
            if prefix not in (' ', '-', '+'):
                raise ValueError('Invalid text patch hunk payload')
            payload = line[1:]
            chosen = default_eol
            if len(endings) > 1 and prefix in (' ', '-'):
                if old_cursor >= len(source) or source[old_cursor].rstrip('\r\n') != payload.rstrip('\r\n'):
                    raise ValueError('Mixed-line-ending patch context must match its exact source position')
                chosen = '\r\n' if source[old_cursor].endswith('\r\n') else '\n'
            elif len(endings) > 1:
                chosen = addition_eol
            no_final_newline = (index + 1 < len(lines)
                                and lines[index + 1].rstrip('\r\n') == '\\ No newline at end of file')
            if chosen == '\r\n' and line.endswith('\n') and not line.endswith('\r\n') and not no_final_newline:
                line = line[:-1] + '\r\n'
            output.append(line)
            if prefix in (' ', '-'):
                addition_eol = chosen
                old_left -= 1
                old_cursor += 1
            if prefix in (' ', '+'):
                new_left -= 1
            if old_left < 0 or new_left < 0:
                raise ValueError('Invalid text patch hunk counts')
            continue
        clean = line.rstrip('\r\n')
        if clean.startswith('diff --git '):
            ready = False
        elif clean.startswith(('GIT binary patch', 'Binary files ')):
            raise ValueError('Only text unified patches are supported; binary patches are not accepted')
        elif re.match(r'(?:old|new|new file|deleted file) mode ', clean):
            if clean.rsplit(' ', 1)[-1] not in ('100644', '100755'):
                raise ValueError('Text patches may only modify regular file modes')
        elif clean.startswith('--- '):
            path = _path(workspace, line)
            source = _lines(path.read_bytes().decode('utf-8')) if path is not None else []
            endings = {'\r\n' if value.endswith('\r\n') else '\n' for value in source if value.endswith('\n')}
            default_eol = '\r\n' if endings == {'\r\n'} else '\n'
            ready = False
        elif clean.startswith('+++ '):
            _path(workspace, line)
            ready = True
            headers += 1
        elif clean.startswith('@@'):
            match = re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*', clean)
            if not ready or not match:
                raise ValueError('Invalid text patch file or hunk header')
            old_left = int(match[2]) if match[2] is not None else 1
            new_left = int(match[4]) if match[4] is not None else 1
            old_cursor = int(match[1]) - (1 if old_left else 0)
            nearby = source[min(max(old_cursor, 0), len(source) - 1)] if source else ''
            addition_eol = '\r\n' if nearby.endswith('\r\n') else '\n'
            hunks += 1
        output.append(clean + ('\n' if line.endswith('\n') else ''))
    if old_left or new_left or not headers or not hunks:
        raise ValueError('A complete text unified patch with file headers and hunks is required')
    return ''.join(output)
