import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedStartUrl } from './start-page.ts';
import { checkedExternalCommand } from './mcp.ts';
import { readSkillStartUrl, writeSkillStartUrl, writeSkillMetadata } from './metadata.ts';

test('starting addresses are public fixed routes matching the first checkpoint', () => {
  assert.equal(checkedStartUrl('https://github.com/search/advanced', 'https://github.com/…/…'), 'https://github.com/search/advanced');
  for (const url of ['javascript:alert(1)', 'https://name:pass@example.org', 'https://example.org/?q=private', 'https://example.org/#private', 'https://example.org/…',
    'https://example.org/delete', 'https://example.org/%2564elete', 'https://example.org/logout', 'https://example.org/a@b.com', 'https://example.org/' + 'a'.repeat(40), 'https://example.org/' + '%61'.repeat(40), 'https://example.org/%0a', 'https://example.org/checkout', 'https://example.org/reset'])
    assert.throws(() => checkedStartUrl(url), undefined, url);
  assert.throws(() => checkedStartUrl('https://evil.example/search/advanced', 'https://github.com/…/…'));
  assert.throws(() => checkedStartUrl('https://github.com/search', 'https://github.com/…/…'));
});

test('start by catalog identity validates provisional parameters and rejects unrelated action fields', () => {
  assert.deepEqual(checkedExternalCommand({ kind: 'start', skillId: 'example:test', parameters: { topic: 'terminal' } }), { kind: 'start', skillId: 'example:test', parameters: { topic: 'terminal' } });
  for (const fields of [{ parameters: { topic: 1 } }, { parameters: { topic: 'password=private' } }, { startUrl: 'https://example.org/pay' }, { approved: true }])
    assert.throws(() => checkedExternalCommand({ kind: 'start', skillId: 'example:test', parameters: {}, ...fields }));
  assert.throws(() => checkedExternalCommand({ kind: 'start', parameters: {} }));
});

test('optional start_url survives metadata edits without changing instructions or plan', () => {
  const body = '\n# Instructions\nKeep this exact body.\n';
  const original = '---\nname: a-task\ndescription: My task\n---\n' + body;
  const updated = writeSkillStartUrl(original, 'https://github.com/search/advanced');
  assert.equal(readSkillStartUrl(updated), 'https://github.com/search/advanced');
  assert.ok(updated.endsWith(body));
  assert.equal(readSkillStartUrl(writeSkillMetadata(updated, { name: 'renamed-task', description: 'New task' })), 'https://github.com/search/advanced');
});
