// v2.5.2: Windows print spooler reset (Shop > Print Settings > Reset Print Spooler...).
// Inner script runs elevated. Outer script starts it with -Verb RunAs, waits, then reads Spooler status.

const INNER_SCRIPT = 'Stop-Service Spooler -Force; Remove-Item "$env:SystemRoot\\System32\\spool\\PRINTERS\\*" -Force -ErrorAction SilentlyContinue; Start-Service Spooler';

function encodeUtf16LeBase64(str) {
    return Buffer.from(String(str), 'utf16le').toString('base64');
}

function decodeUtf16LeBase64(b64) {
    return Buffer.from(String(b64), 'base64').toString('utf16le');
}

function innerEncodedCommand() {
    return encodeUtf16LeBase64(INNER_SCRIPT);
}

function outerScript() {
    const enc = innerEncodedCommand();
    return [
        '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
        '$ErrorActionPreference = \'Stop\'',
        'try {',
        '  $p = Start-Process -FilePath powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(\'-NoProfile\',\'-ExecutionPolicy\',\'Bypass\',\'-EncodedCommand\',\'' + enc + '\')',
        '  if ($null -eq $p) { Write-Output \'CANCELLED\'; exit 2 }',
        '  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne $null) { Write-Output (\'FAIL exit=\' + $p.ExitCode); exit 1 }',
        '} catch {',
        '  $msg = [string]$_.Exception.Message',
        '  if ($msg -match \'cancel(l)?ed\') { Write-Output \'CANCELLED\'; exit 2 }',
        '  Write-Output (\'FAIL \' + $msg)',
        '  exit 1',
        '}',
        '$st = [string](Get-Service Spooler).Status',
        'if ($st -eq \'Running\') { Write-Output \'OK Running\'; exit 0 }',
        'Write-Output (\'FAIL status=\' + $st)',
        'exit 1'
    ].join('\n');
}

function buildSpoolerResetLaunch() {
    return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeUtf16LeBase64(outerScript())],
        windowsHide: true
    };
}

function parseSpoolerResetOutput(code, stdout, stderr) {
    const out = String(stdout || '').trim();
    const err = String(stderr || '').trim();
    const blob = out + '\n' + err;
    if (code === 2 || /^CANCELLED/im.test(out) || /cancel+ed by the user/i.test(blob) || /operation was cancel+ed/i.test(blob)) {
        return { ok: false, kind: 'cancelled', message: 'The reset was cancelled.', out, err, code };
    }
    if (code === 0 && /\bOK\b/i.test(out)) {
        return { ok: true, kind: 'ok', message: 'Print spooler reset, printing is ready', out, err, code };
    }
    const detail = out || err;
    return {
        ok: false,
        kind: 'error',
        message: detail ? ('Could not reset the print spooler. ' + detail) : 'Could not reset the print spooler.',
        out, err, code
    };
}

function resetPrintSpooler({ platform, spawn, log } = {}) {
    const plat = platform || process.platform;
    const say = typeof log === 'function' ? log : function () {};
    if (plat !== 'win32') {
        say('print spooler reset skipped: not Windows');
        return Promise.resolve({
            ok: false,
            kind: 'unsupported',
            message: 'Print spooler reset is only available on Windows.'
        });
    }
    const launch = buildSpoolerResetLaunch();
    const spawnFn = spawn;
    if (typeof spawnFn !== 'function') {
        return Promise.resolve({ ok: false, kind: 'error', message: 'Could not reset the print spooler.' });
    }
    return new Promise((resolve) => {
        let settled = false;
        const done = (result) => { if (settled) return; settled = true; resolve(result); };
        try {
            const child = spawnFn(launch.command, launch.args, { windowsHide: true });
            const outChunks = [];
            const errChunks = [];
            if (child.stdout) child.stdout.on('data', (d) => outChunks.push(d));
            if (child.stderr) child.stderr.on('data', (d) => errChunks.push(d));
            child.on('error', (e) => {
                done({ ok: false, kind: 'error', message: 'Could not reset the print spooler. ' + (e && e.message ? e.message : String(e)) });
            });
            child.on('close', (code) => {
                const out = Buffer.concat(outChunks.map((d) => Buffer.from(d))).toString('utf8');
                const err = Buffer.concat(errChunks.map((d) => Buffer.from(d))).toString('utf8');
                done(parseSpoolerResetOutput(code, out, err));
            });
        } catch (e) {
            done({ ok: false, kind: 'error', message: 'Could not reset the print spooler. ' + (e && e.message ? e.message : String(e)) });
        }
    });
}

module.exports = {
    INNER_SCRIPT,
    encodeUtf16LeBase64,
    decodeUtf16LeBase64,
    innerEncodedCommand,
    outerScript,
    buildSpoolerResetLaunch,
    parseSpoolerResetOutput,
    resetPrintSpooler
};
