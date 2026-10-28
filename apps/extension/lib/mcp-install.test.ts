import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpInstallation } from './mcp-install.ts';
test('client-specific registration uses one versioned package without extension IDs, secrets or local paths', () => {
  const base = 'https://show-me-once-dimitar.vercel.app';
  const codex = mcpInstallation('codex', base);
  const claude = mcpInstallation('claude-code', base);
  assert.match(codex.command!, /^codex mcp add show_me_once -- npx -y /);
  assert.match(claude.command!, /^claude mcp add --scope user --transport stdio show_me_once -- npx -y /);
  const cursor = new URL(mcpInstallation('cursor', base).link!);
  const cursorConfig = JSON.parse(atob(cursor.searchParams.get('config')!));
  const vscode = mcpInstallation('vscode', base).link!;
  const codeConfig = JSON.parse(decodeURIComponent(vscode.slice(vscode.indexOf('?') + 1)));
  for (const config of [cursorConfig, codeConfig]) {
    assert.equal(config.command, 'npx');
    assert.deepEqual(config.args, ['-y', `${base}/downloads/show-me-once-mcp-0.7.0.tgz`]);
    assert.equal(config.env, undefined);
  }
  assert.equal(codeConfig.type, 'stdio');
  assert.equal(JSON.parse(mcpInstallation('other', base).command!).mcpServers.show_me_once.command, 'npx');
});
