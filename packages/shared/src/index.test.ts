import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAction, sanitizeUrl, sanitizedAction, type Recording } from './index.ts';

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
