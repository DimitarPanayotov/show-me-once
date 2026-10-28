import test from 'node:test';
import assert from 'node:assert/strict';
import { externalCommandFailure } from './external-errors.ts';
test('known MCP start blockers become actionable messages; arbitrary exception data never reaches the agent', () => {
  const active = externalCommandFailure(new Error('Stop the current recording or run first.'), 'start');
  assert.equal(active.errorCode, 'ACTIVE_TASK'); assert.match(active.message!, /Stop the current/);
  const draft = externalCommandFailure(new Error('Save your current draft before starting a different external skill.'), 'start');
  assert.equal(draft.errorCode, 'UNSAVED_LIBRARY_DRAFT'); assert.match(draft.message!, /library skill/);
  const unknown = externalCommandFailure(new Error('Unexpected page text password=private-value https://example.com/private?token=secret'), 'start');
  assert.equal(unknown.status, 'unknown_outcome');
  assert.doesNotMatch(JSON.stringify(unknown), /private-value|example.com|token=secret/);
});
