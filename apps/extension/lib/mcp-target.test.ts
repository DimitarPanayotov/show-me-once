import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMcpStartTab, McpTargetError } from './mcp-target.ts';
const expected = 'https://github.com/…/…';
const exactStart = 'https://github.com/search/advanced';
const task = { id: 7, url: exactStart, status: 'complete' };

test('a terminal-focused MCP request finds the unique exact example page across Chrome windows', () => {
  const repo = { id: 2, url: 'https://github.com/owner/repo' };
  assert.equal(chooseMcpStartTab({ expected, exactStart, focused: repo, candidates: [repo, task] }).id, 7);
  assert.equal(chooseMcpStartTab({ expected, exactStart, focused: task, candidates: [task, { ...task, id: 8 }] }).id, 7);
});
test('ambiguous starting pages require an explicit choice; recorded URL shapes never select a different tab automatically', () => {
  assert.throws(() => chooseMcpStartTab({ expected, exactStart, candidates: [task, { ...task, id: 8 }] }), error => error instanceof McpTargetError && error.errorCode === 'START_TAB_AMBIGUOUS');
  assert.throws(() => chooseMcpStartTab({ expected, candidates: [task] }), /Use this tab/);
});
test('an explicit user-bound tab wins over window focus and is revalidated before every run', () => {
  assert.equal(chooseMcpStartTab({ expected, exactStart, focused: { id: 2, url: 'https://example.org' }, pinnedRequested: true, pinned: task }).id, 7);
  assert.throws(() => chooseMcpStartTab({ expected, exactStart, pinnedRequested: true }), error => error instanceof McpTargetError && error.errorCode === 'START_TAB_CLOSED');
  for (const pinned of [{ ...task, url: 'https://github.com/owner/repo' }, { ...task, incognito: true }])
    assert.throws(() => chooseMcpStartTab({ expected, exactStart, pinnedRequested: true, pinned }), /Use this tab/);
  assert.throws(() => chooseMcpStartTab({ expected, exactStart, pinnedRequested: true, pinned: { ...task, status: 'loading' } }), /still loading/);
});
test('mismatch diagnostics omit unrelated origins and all private URL values', () => {
  try { chooseMcpStartTab({ expected, focused: { id: 1, url: 'https://private.example/secret?token=private' } }); }
  catch (error) {
    assert.ok(error instanceof McpTargetError);
    assert.equal(error.actual, null); assert.equal(error.expected, expected);
    assert.doesNotMatch(JSON.stringify(error), /private.example|token=|secret/);
  }
});
