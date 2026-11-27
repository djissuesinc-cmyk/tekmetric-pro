// v2.5.2: print spooler reset script builder. Run: node test/unit-spooler.js
const assert = require('assert');
const {
  INNER_SCRIPT, encodeUtf16LeBase64, decodeUtf16LeBase64, innerEncodedCommand,
  outerScript, buildSpoolerResetLaunch, parseSpoolerResetOutput, resetPrintSpooler
} = require('../spooler-reset');

const inner = decodeUtf16LeBase64(innerEncodedCommand());
assert.strictEqual(inner, INNER_SCRIPT);
assert(inner.includes('Stop-Service Spooler -Force'), inner);
assert(/Remove-Item\s+"\$env:SystemRoot\\System32\\spool\\PRINTERS\\\*"/.test(inner), inner);
assert(inner.includes('-Force') && inner.includes('-ErrorAction SilentlyContinue'), inner);
assert(inner.includes('Start-Service Spooler'), inner);

const launch = buildSpoolerResetLaunch();
assert.strictEqual(launch.command, 'powershell.exe');
assert.strictEqual(launch.windowsHide, true);
assert(launch.args.includes('-EncodedCommand'));
assert(launch.args.includes('-NoProfile'));
const enc = launch.args[launch.args.indexOf('-EncodedCommand') + 1];
const outer = decodeUtf16LeBase64(enc);
assert(outer.includes('Start-Process') && outer.includes('-Verb RunAs') && outer.includes('-WindowStyle Hidden') && outer.includes('-Wait'), outer);
assert(outer.includes('-EncodedCommand') && outer.includes(innerEncodedCommand()), 'outer must pass the inner encoded script');
assert(outer.includes('(Get-Service Spooler).Status') || outer.includes('Get-Service Spooler'), outer);
assert(encodeUtf16LeBase64(outerScript()) === enc);

const ok = parseSpoolerResetOutput(0, 'OK Running\n', '');
assert(ok.ok && ok.kind === 'ok' && ok.message === 'Print spooler reset, printing is ready');
const cancelled = parseSpoolerResetOutput(2, 'CANCELLED', '');
assert(!cancelled.ok && cancelled.kind === 'cancelled' && /cancelled/i.test(cancelled.message));
const cancelledMsg = parseSpoolerResetOutput(1, 'The operation was canceled by the user.', '');
assert(cancelledMsg.kind === 'cancelled');
const fail = parseSpoolerResetOutput(1, 'FAIL status=Stopped', '');
assert(!fail.ok && fail.kind === 'error' && /Could not reset the print spooler/.test(fail.message));

(async () => {
  let spawned = 0;
  const r = await resetPrintSpooler({
    platform: 'linux',
    spawn: () => { spawned++; throw new Error('must not spawn'); },
    log: () => {}
  });
  assert.strictEqual(spawned, 0);
  assert(!r.ok && r.kind === 'unsupported');

  const darwin = await resetPrintSpooler({ platform: 'darwin', spawn: () => { spawned++; }, log: () => {} });
  assert.strictEqual(spawned, 0);
  assert(darwin.kind === 'unsupported');

  // Windows path uses the builder and spawn; do not actually launch PowerShell here.
  const { EventEmitter } = require('events');
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    setImmediate(() => { child.stdout.emit('data', Buffer.from('OK Running\n')); child.emit('close', 0); });
    return child;
  };
  const win = await resetPrintSpooler({ platform: 'win32', spawn: fakeSpawn, log: () => {} });
  assert(win.ok && win.kind === 'ok');
  assert.strictEqual(calls[0].cmd, 'powershell.exe');
  assert.strictEqual(calls[0].opts.windowsHide, true);
  assert(calls[0].args.includes('-EncodedCommand'));

  console.log('SPOOLER UNIT OK');
})().catch((e) => { console.error('SPOOLER UNIT FAIL:', e && e.stack || e); process.exit(1); });
