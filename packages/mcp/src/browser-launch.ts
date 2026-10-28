import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** Fixed application paths only. Never execute a model-supplied command or URL. */
export async function launchChrome(options: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => Promise<boolean>;
  launch?: (path: string, args: string[]) => Promise<void>;
} = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? (async path => { try { await access(path); return true; } catch { return false; } });
  const candidates: [string, string[]][] = platform === 'win32'
    ? [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((p): p is string => !!p)
      .map(p => [join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'), ['--no-first-run', '--new-window', 'about:blank']])
    : platform === 'darwin' ? [['/usr/bin/open', ['-a', 'Google Chrome', '--args', '--new-window', 'about:blank']]]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'].map(p => [p, ['--no-first-run', '--new-window', 'about:blank']]);
  const launch = options.launch ?? ((path, args) => new Promise<void>((resolve, reject) => {
    const child = spawn(path, args, { detached: true, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  }));
  for (const [path, args] of candidates) if (await exists(path)) { await launch(path, args); return; }
  throw new Error('Google Chrome could not be started.');
}
