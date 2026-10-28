import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillMarkdown, writeSkillStartUrl } from '@show-me-once/shared';
import { exampleDraft, EXAMPLE_START_URL } from './example-skill.ts';
import { resolveStartPage } from './mcp-start.ts';

test('start page resolves the builtin, origin checkpoints, explicit headers and user-supplied legacy routes', () => {
  assert.equal(resolveStartPage(exampleDraft.markdown), EXAMPLE_START_URL);
  const create = (url: string) => createSkillMarkdown({ id: 'test', tabId: 1, active: false, startedAt: '', actions: [{ id: '1', at: '', kind: 'navigation', url }] }, 'my-task', 'My task.');
  assert.equal(resolveStartPage(create('https://www.wikipedia.org')), 'https://www.wikipedia.org/');
  const legacy = create('https://example.org/…/…');
  assert.throws(() => resolveStartPage(legacy), /in chat/);
  assert.equal(resolveStartPage(legacy, 'https://example.org/search/advanced'), 'https://example.org/search/advanced');
  assert.equal(resolveStartPage(writeSkillStartUrl(legacy, 'https://example.org/search/advanced')), 'https://example.org/search/advanced');
  assert.throws(() => resolveStartPage(legacy, 'https://wrong.example/search/advanced'));
  assert.throws(() => resolveStartPage(writeSkillStartUrl(legacy, 'https://example.org/delete/item')));
});
