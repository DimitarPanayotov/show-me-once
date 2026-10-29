import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedExternalCommand } from './mcp.ts';
import { checkedConnectorCommand } from './approval.ts';

test('approval messages stay private to the connector and cannot be supplied as ordinary MCP commands', () => {
  const preview = { kind: 'approval_preview', runId: 'run-one' };
  const decide = { kind: 'approval_decide', runId: 'run-one', reviewId: '07118f12-a190-4ddd-9dd9-d7ee5e69f98b', approved: true };
  assert.deepEqual(checkedConnectorCommand(preview), preview);
  assert.deepEqual(checkedConnectorCommand(decide), decide);
  assert.throws(() => checkedExternalCommand(preview)); assert.throws(() => checkedExternalCommand(decide));
  for (const bad of [{ ...decide, approved: 'yes' }, { ...decide, reviewId: 'guess' }, { ...decide, token: 'secret' }]) assert.throws(() => checkedConnectorCommand(bad));
});
