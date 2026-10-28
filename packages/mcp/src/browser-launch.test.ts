import test from 'node:test';
import assert from 'node:assert/strict';
import { launchChrome } from './browser-launch.ts';

test('Chrome wake uses a fixed executable and arguments, with no shell, URL or profile inspection', async () => {
  const calls: unknown[] = [];
  await launchChrome({ platform: 'win32', env: { ProgramFiles: 'C:/Programs', LOCALAPPDATA: 'C:/Local' }, exists: async path => path.includes('Local'), launch: async (path, args) => { calls.push([path, args]); } });
  assert.equal(calls.length, 1);
  assert.match((calls[0] as [string, string[]])[0], /Local.*Google.*Chrome.*chrome.exe/);
  assert.deepEqual((calls[0] as unknown[])[1], ['--no-first-run', '--new-window', 'about:blank']);
  await assert.rejects(launchChrome({ platform: 'win32', env: {}, exists: async () => false, launch: async () => { assert.fail('No executable exists'); } }), /could not be started/);
  await launchChrome({ platform: 'darwin', exists: async () => true, launch: async (path, args) => { assert.equal(path, '/usr/bin/open'); assert.deepEqual(args, ['-a', 'Google Chrome', '--args', '--new-window', 'about:blank']); } });
});
