import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeUrl, sanitizedAction } from './index.ts';

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
