const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, 'start-db.ps1');

// Regression for the Windows PowerShell 5.1 encoding failure: the script was
// saved as UTF-8 without a BOM, so powershell.exe decoded it with the system
// ANSI code page (GBK/CP936 on the affected host). Chinese characters inside
// `#` comments then consumed the following newline as part of a multi-byte
// sequence, swallowing the next code line into the comment. The observed
// symptom was `$lockFilePath` being null and `pg_ctl start` never running.
test('start-db.ps1 is pure ASCII so every single-byte ANSI code page parses it identically', () => {
  const bytes = fs.readFileSync(scriptPath);

  const nonAscii = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] >= 0x80) nonAscii.push(i);
  }
  assert.deepEqual(
    nonAscii,
    [],
    `non-ASCII bytes at offsets: ${nonAscii.slice(0, 20).join(', ')} (would be GBK-misparsed without a BOM)`,
  );

  // Pure ASCII also means there is no UTF-8 BOM to rely on, so the file must be
  // parseable under the default ANSI code page of PowerShell 5.1.
  assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'script must not depend on a BOM');
});

test('start-db.ps1 keeps the stale-lock and start statements on their own lines', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  // These two statements were previously swallowed into the Chinese comments
  // and never executed. Each must remain a complete, uncommented statement.
  assert.ok(
    lines.includes('$lockFilePath = Join-Path $pgData "postmaster.pid"'),
    'lockFilePath assignment must stay its own line (was swallowed by the Chinese comment)',
  );
  assert.ok(
    lines.some((line) => line.startsWith('$pgCtl = Start-Process -FilePath "$pgBin\\pg_ctl.exe"')),
    'pg_ctl start must stay its own statement (was swallowed by the Chinese comment)',
  );
});

test('pg_ctl start uses an independent hidden console and waits only on the direct process', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  const startLine = text.split(/\r?\n/).find((line) => line.includes('Start-Process -FilePath "$pgBin\\pg_ctl.exe"'));
  const argsLine = text.split(/\r?\n/).find((line) => line.trim().startsWith('$pgCtlArgs = @('));

  assert.ok(startLine, 'pg_ctl must be launched via Start-Process');
  assert.ok(startLine.includes('-WindowStyle Hidden'), 'must launch in an independent hidden console');
  assert.ok(startLine.includes('-PassThru'), 'must keep the returned direct pg_ctl process handle');
  assert.ok(!startLine.includes('| Out-Null'), 'must not pipe pg_ctl start to Out-Null');
  assert.ok(!text.includes('-Wait'), 'must not wait on the whole process tree');
  assert.ok(!text.includes('-NoNewWindow'), 'must not reuse the inherited console');
  assert.ok(!text.includes('RedirectStandardOutput') && !text.includes('RedirectStandardError'),
    'must not redirect output into an inherited pipe');

  // argv is built as a list of separately-quoted tokens so a trailing backslash
  // in PGDATA cannot escape the closing quote and absorb -l or the log path.
  assert.ok(argsLine, 'pg_ctl args must be built as a list, not one hand-spliced string');
  assert.ok(
    argsLine.includes("'start'") && argsLine.includes("'-D'") && argsLine.includes('$pgData')
      && argsLine.includes("'-l'") && argsLine.includes('$logFile')
      && argsLine.includes("'-w'") && argsLine.includes("'-t'") && argsLine.includes("'120'"),
    'must preserve -D $pgData -l $logFile -w -t 120 as separate argv tokens',
  );

  // The only thing waited on is the direct pg_ctl process, with a finite bound,
  // and its ExitCode is handled for the final diagnostics.
  assert.ok(text.includes('.WaitForExit('), 'must wait only on the returned direct pg_ctl process');
  assert.match(text, /\$pgCtl\.WaitForExit\(\d+\)/, 'WaitForExit must have a finite millisecond bound');
  assert.ok(text.includes('$pgCtl.ExitCode'), 'must read the direct pg_ctl ExitCode');
});

test('start-db.ps1 quotes every argv token through ConvertTo-CmdArg, never one hand-spliced string', () => {
  const text = fs.readFileSync(scriptPath, 'utf8');

  // These structural guards stay cross-platform so the sandbox still catches a
  // naive removal of the quoting helper. The authoritative round-trip below
  // executes the real PS1 function on Windows; the Linux sandbox has no
  // powershell.exe, so only the structural contract is asserted here.
  assert.ok(text.includes('function ConvertTo-CmdArg'), 'must quote tokens with a dedicated helper');
  assert.ok(text.includes('$numBackSlash * 2'), 'must double a trailing backslash run before the closing quote');
  assert.ok(!/TrimEnd\(/.test(text), 'must not TrimEnd a trailing separator into a relative path');
  assert.ok(
    text.includes('$pgCtlArgs | ForEach-Object { ConvertTo-CmdArg $_ }'),
    'must quote every argv token through the helper, never splice a single quoted string',
  );
});

test('Windows command-line quoting round-trips through the real PS1 ConvertTo-CmdArg', { skip: process.platform !== 'win32' }, () => {
  const text = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(text.includes('function ConvertTo-CmdArg'), 'script must still contain the helper');

  // Execute ONLY the ConvertTo-CmdArg function extracted from the parsed AST;
  // never dot-source the whole startup script (that would start the database).
  // The escaped command line is then split by the native CommandLineToArgvW,
  // the same splitter the CRT behind pg_ctl.exe uses. This proves the real PS1
  // implementation - not a JS mirror - emits correct argv for spaces, trailing
  // separators, drive roots and embedded quotes.
  const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$scriptPath = $env:START_DB_PS1_PATH
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors -and $parseErrors.Count -gt 0) {
  throw ('start-db.ps1 parse errors: ' + $parseErrors[0].Message)
}
$func = $ast.FindAll({
  param($node)
  ($node -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and ($node.Name -eq 'ConvertTo-CmdArg')
}, $true) | Select-Object -First 1
if ($null -eq $func) {
  throw 'ConvertTo-CmdArg function not found in start-db.ps1 AST'
}
. ([scriptblock]::Create($func.Extent.Text))

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class Win32Cmd {
    [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CommandLineToArgvW(
        [MarshalAs(UnmanagedType.LPWStr)] string lpCmdLine,
        out int pNumArgs);

    public static string[] Split(string commandLine) {
        int argc;
        IntPtr argv = CommandLineToArgvW(commandLine, out argc);
        if (argv == IntPtr.Zero) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        try {
            string[] result = new string[argc];
            for (int i = 0; i < argc; i++) {
                IntPtr p = Marshal.ReadIntPtr(argv, i * IntPtr.Size);
                result[i] = Marshal.PtrToStringUni(p);
            }
            return result;
        } finally {
            Marshal.FreeHGlobal(argv);
        }
    }
}
'@

$cases = @(
  @('start', '-D', 'C:\data', '-l', 'C:\data\pg.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\data\', '-l', 'C:\data\pg.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\', '-l', 'C:\pg.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\Program Files\pgdata', '-l', 'C:\Program Files\pgdata\pg-server.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\Program Files\pgdata\', '-l', 'C:\Program Files\pgdata\pg-server.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\Program Files\', '-l', 'C:\Program Files\pg-server.log', '-w', '-t', '120'),
  @('start', '-D', 'C:\data"quote', '-l', 'C:\data\pg.log', '-w', '-t', '120'),
  @('')
)

$results = @()
foreach ($argv in $cases) {
  $cmdline = (($argv | ForEach-Object { ConvertTo-CmdArg $_ }) -join ' ')
  $parsed = [Win32Cmd]::Split($cmdline)
  $ok = ($parsed.Count -eq $argv.Count)
  if ($ok) {
    for ($i = 0; $i -lt $argv.Count; $i++) {
      if ($parsed[$i] -cne $argv[$i]) {
        $ok = $false
        break
      }
    }
  }
  $results += [pscustomobject]@{
    argv = $argv
    cmdline = $cmdline
    parsed = $parsed
    ok = $ok
  }
}

$allOk = (@($results | Where-Object { -not $_.ok }).Count -eq 0)
[pscustomobject]@{ allOk = $allOk; cases = $results } | ConvertTo-Json -Depth 6 -Compress
`;

  const b64 = Buffer.from(powershell, 'utf16le').toString('base64');

  let stdout;
  try {
    stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { encoding: 'utf8', env: { ...process.env, START_DB_PS1_PATH: path.resolve(scriptPath) } },
    );
  } catch (err) {
    throw new Error(`powershell.exe invocation failed:\n${err.message}\nstderr: ${err.stderr || ''}\nstdout: ${err.stdout || ''}`);
  }

  const result = JSON.parse(stdout);
  const failed = result.cases.filter((c) => !c.ok);
  assert.deepEqual(
    failed,
    [],
    'real ConvertTo-CmdArg output must round-trip through CommandLineToArgvW: '
      + JSON.stringify(failed.map((c) => ({ cmdline: c.cmdline, argv: c.argv, parsed: c.parsed }))),
  );
});
