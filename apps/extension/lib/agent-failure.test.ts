import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFailure } from './agent-failure.ts';

test('run failures distinguish missing targets, expired inputs and transport timeouts without leaking context', () => {
  assert.match(agentFailure(new Error('The agent needs you to identify the intended control. Check the page, then retry or stop.')), /matching control/);
  assert.match(agentFailure(new Error('Run inputs expired. Stop and start the run again.')), /saved skill/);
  assert.match(agentFailure(new Error('The local agent timed out. Retry this step.')), /timed out/);
  const unknown = agentFailure(new Error('password=private-value user@example.test https://example.com/private'));
  assert.doesNotMatch(unknown, /private-value|user@example|https:/);
});
