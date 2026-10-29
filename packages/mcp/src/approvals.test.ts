import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import type { ConnectorCommand } from '@show-me-once/shared/approval';
import { ActionApprovals } from './approvals.ts';
const data = (value: unknown) => (value as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};

function fixture(supported = true) {
  const commands: ConnectorCommand[] = [];
  const reviewId = randomUUID();
  const approvals = new ActionApprovals('controller-one', async command => {
    commands.push(command);
    return command.kind === 'approval_preview'
      ? { status: 'needs_approval', runId: 'run-one', approval: { reviewId, runId: 'run-one', stepIndex: 5, expiresAt: Date.now() + 120000,
          title: 'Submit search on github.com', target: 'Click the “Search” button.', effect: 'This submits the search fields currently filled on the page.', destination: '' } }
      : { status: command.kind === 'approval_decide' && command.approved ? 'done' : 'needs_approval', runId: 'run-one', approvalInAgent: supported };
  });
  const context = (state?: unknown, inputResponses?: Record<string, unknown>, signal = new AbortController().signal) => ({
    mcpReq: { id: 'one', method: 'tools/call', signal, inputResponses, requestState: () => state },
  }) as unknown as ServerContext;
  const caps = { elicitation: { form: {} } };
  const prompt = async () => await approvals.review('run-one', context(), caps) as InputRequiredResult;
  return { approvals, commands, context, caps, prompt, reviewId };
}

test('native confirmation shows the action and needs an explicit checked response; opaque state is one-use and no browser token reaches tool results', async () => {
  const f = fixture(), prompt = await f.prompt();
  assert.equal(prompt.resultType, 'input_required');
  assert.match(JSON.stringify(prompt.inputRequests), /Submit search on github.com/);
  assert.match(JSON.stringify(prompt.inputRequests), /Approve this action only/);
  assert.doesNotMatch(JSON.stringify(prompt), new RegExp(f.reviewId));
  const state = await f.approvals.verifyState(prompt.requestState!, f.context());
  const approved = await f.approvals.review('run-one', f.context(state, { confirm_action: { action: 'accept', content: { approve: true } } }), f.caps);
  assert.equal(data(approved).status, 'done');
  assert.equal(f.commands.filter(c => c.kind === 'approval_decide' && c.approved).length, 1);
  const replay = await f.approvals.review('run-one', f.context(state, { confirm_action: { action: 'accept', content: { approve: true } } }), f.caps);
  assert.equal(data(replay).status, 'blocked');
  assert.equal(f.commands.filter(c => c.kind === 'approval_decide').length, 1);
});

test('declined, cancelled, unchecked, empty and malformed native responses never approve', async () => {
  for (const answer of [{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { approve: false } },
    { action: 'accept', content: {} }, { action: 'accept', content: { approve: 'yes' } }, { action: 'accept', content: { approve: true, other: true } }]) {
    const f = fixture(), prompt = await f.prompt(), state = await f.approvals.verifyState(prompt.requestState!, f.context());
    const result = await f.approvals.review('run-one', f.context(state, { confirm_action: answer }), f.caps);
    assert.equal(data(result).status, 'needs_approval');
    assert.equal(f.commands.some(c => c.kind === 'approval_decide' && c.approved), false);
  }
});

test('forged, cross-run and cross-client approval state or a cancelled request cannot dispatch', async () => {
  const f = fixture(), prompt = await f.prompt();
  await assert.rejects(f.approvals.verifyState(prompt.requestState! + 'tampered', f.context()));
  const other = fixture(); await assert.rejects(other.approvals.verifyState(prompt.requestState!, other.context()));
  const forged = await f.approvals.review('run-one', f.context(undefined, { confirm_action: { action: 'accept', content: { approve: true } } }), f.caps);
  assert.equal(data(forged).status, 'blocked');
  const state = await f.approvals.verifyState(prompt.requestState!, f.context());
  const wrongRun = await f.approvals.review('different-run', f.context(state, { confirm_action: { action: 'accept', content: { approve: true } } }), f.caps);
  assert.equal(data(wrongRun).status, 'blocked');
  const fresh = await f.prompt(), freshState = await f.approvals.verifyState(fresh.requestState!, f.context());
  const abort = new AbortController(); abort.abort();
  await f.approvals.review('run-one', f.context(freshState, { confirm_action: { action: 'accept', content: { approve: true } } }, abort.signal), f.caps);
  assert.equal(f.commands.some(c => c.kind === 'approval_decide' && c.approved), false);
});

test('clients without forms and older extensions retain browser approval without receiving private connector commands', async () => {
  for (const extensionSupported of [false, true]) {
    const f = fixture(extensionSupported);
    const result = await f.approvals.review('run-one', f.context(), extensionSupported ? undefined : f.caps);
    assert.equal(data(result).status, 'needs_approval');
    assert.match(data(result).message as string, /in Show Me Once/);
    assert.deepEqual(f.commands.map(c => c.kind), ['status']);
  }
});

test('native approval state expires before an old human response can execute', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture(), prompt = await f.prompt();
  t.mock.timers.tick(121000);
  await assert.rejects(f.approvals.verifyState(prompt.requestState!, f.context()));
  assert.equal(f.commands.some(c => c.kind === 'approval_decide'), false);
});
