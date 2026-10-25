import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAction, createSkillMarkdown, parseSkillPlan, sanitizeUrl, sanitizedAction, type Recording } from './index.ts';

test('URL sanitization removes credentials, path values, query and fragment', () => {
  assert.equal(sanitizeUrl('https://user:secret@example.com/invoice/abc123?token=secret#private'), 'https://example.com/…/…');
  assert.equal(sanitizeUrl('chrome://settings'), null);
});

test('action boundary drops unknown fields including raw input values', () => {
  assert.deepEqual(sanitizedAction({ kind: 'input', url: 'https://example.com/search?q=secret', selector: 'input:nth-of-type(1)', inputKind: 'search', value: 'secret' }), {
    kind: 'input', url: 'https://example.com/…', selector: 'input:nth-of-type(1)', inputKind: 'search'
  });
  assert.equal(sanitizedAction({ kind: 'input', url: 'https://example.com', selector: '#password', inputKind: 'password' }), null);
});

test('two reports of one physical click create one timeline action', () => {
  const recording: Recording = { id: 'recording', active: true, tabId: 1, startedAt: '2026-10-25T00:00:00Z', actions: [] };
  const click = { kind: 'click' as const, url: 'https://example.com', selector: 'a:nth-of-type(1)' };
  const once = appendAction(recording, click, 'same-event-id', '2026-10-25T00:00:01Z');
  const twice = appendAction(once, click, 'same-event-id', '2026-10-25T00:00:01Z');
  assert.equal(twice.actions.length, 1);
  assert.equal(twice, once);
});

test('adjacent duplicate navigation is collapsed, but navigation after a click is retained', () => {
  const recording: Recording = { id: 'recording', active: true, tabId: 1, startedAt: '2026-10-25T00:00:00Z', actions: [] };
  const navigation = { kind: 'navigation' as const, url: 'https://example.com/…/…' };
  const first = appendAction(recording, navigation, 'nav-1', '2026-10-25T00:00:01.000Z');
  const duplicate = appendAction(first, navigation, 'nav-2', '2026-10-25T00:00:01.500Z');
  assert.equal(duplicate, first);
  const clicked = appendAction(duplicate, { kind: 'click', url: navigation.url, selector: 'a:nth-of-type(1)' }, 'click-1', '2026-10-25T00:00:02.000Z');
  const second = appendAction(clicked, navigation, 'nav-3', '2026-10-25T00:00:02.200Z');
  assert.deepEqual(second.actions.map(action => action.kind), ['navigation', 'click', 'navigation']);
});

test('skill generation uses placeholders and excludes recorded values and URL details', () => {
  const recording: Recording = {
    id: 'recording', active: false, tabId: 1, startedAt: '2026-10-25T00:00:00Z',
    actions: [
      { id: 'nav', at: '2026-10-25T00:00:01Z', kind: 'navigation', url: 'https://user:private@example.com/search/secret-page?token=private' },
      { id: 'input', at: '2026-10-25T00:00:02Z', kind: 'input', url: 'https://example.com/search/secret-page', selector: 'input:nth-of-type(1)', inputKind: 'search', value: 'private' } as unknown as Recording['actions'][number],
    ],
  };
  const markdown = createSkillMarkdown(recording, 'example-search', 'Search with a new term');
  assert.match(markdown, /^---\nname: example-search\ndescription: "Search with a new term"\n---/);
  assert.match(markdown, /\{\{search_1\}\}/);
  assert.match(markdown, /## Checkpoints and safety/);
  assert.doesNotMatch(markdown, /private|secret-page|token=/);
  assert.deepEqual(parseSkillPlan(markdown).parameters, [{ name: 'search_1', type: 'string' }]);
});

test('a click-only skill asks for target descriptions instead of freezing a link choice', () => {
  const recording: Recording = {
    id: 'recording', active: false, tabId: 1, startedAt: '2026-10-25T00:00:00Z',
    actions: [{ id: 'click', at: '2026-10-25T00:00:01Z', kind: 'click', url: 'https://example.com', selector: 'a:nth-of-type(1)' }],
  };
  assert.match(createSkillMarkdown(recording, 'follow-link', 'Follow a link'), /\{\{target_1\}\}/);
});

test('runner rejects a skill plan containing an unredacted URL or raw field value', () => {
  const wrap = (step: object) => `# Skill\n\n\`\`\`json show-me-once\n${JSON.stringify({ schemaVersion: 1, parameters: [], steps: [step] })}\n\`\`\``;
  assert.throws(() => parseSkillPlan(wrap({ kind: 'navigation', url: 'https://example.com/private?token=secret' })), /Unsafe/);
  assert.throws(() => parseSkillPlan(wrap({ kind: 'input', url: 'https://example.com', selector: 'input:nth-of-type(1)', inputKind: 'search', parameter: 'search_1', value: 'secret' })), /Unsafe/);
});
