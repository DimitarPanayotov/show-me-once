import { randomBytes, randomUUID } from 'node:crypto';
import { acceptedContent, createRequestStateCodec, inputRequired, type CallToolResult, type ClientCapabilities, type InputRequiredResult, type ServerContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { containsSecret } from '@show-me-once/shared/agent';
import type { ActionReview, ConnectorCommand, ConnectorResult } from '@show-me-once/shared/approval';

export function toolResult(value: ConnectorResult): CallToolResult {
  const { approval: _privateReview, ...publicResult } = value;
  return { content: [{ type: 'text', text: JSON.stringify(publicResult) }], structuredContent: publicResult };
}
const answerSchema = z.object({ approve: z.boolean() }).strict();
type ReviewState = { nonce: string; runId: string };
type HeldReview = { runId: string; reviewId: string; expiresAt: number };

function validReview(value: ActionReview | undefined, runId: string): value is ActionReview {
  return !!value && value.runId === runId && /^[0-9a-f-]{36}$/i.test(value.reviewId) &&
    Number.isInteger(value.stepIndex) && value.stepIndex >= 0 && value.stepIndex < 100 &&
    value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 121000 &&
    [value.title, value.target, value.effect, value.destination].every(s => typeof s === 'string' && s.length <= 400 && !/[\u0000-\u001f\u007f]/.test(s) && !containsSecret(s));
}

/** Native host input, never a model-supplied approved flag, authorizes this one action. */
export class ActionApprovals {
  private pending = new Map<string, HeldReview>();
  private codec;
  private command: (value: ConnectorCommand, signal?: AbortSignal) => Promise<ConnectorResult>;
  constructor(controllerId: string, command: (value: ConnectorCommand, signal?: AbortSignal) => Promise<ConnectorResult>) {
    this.command = command;
    this.codec = createRequestStateCodec<ReviewState>({ key: randomBytes(32), ttlSeconds: 120,
      bind: ctx => `${controllerId}\0${ctx.mcpReq.method}` });
  }
  verifyState = (state: string, ctx: ServerContext) => this.codec.verify(state, ctx);

  async review(runId: string, ctx: ServerContext, capabilities: ClientCapabilities | undefined): Promise<CallToolResult | InputRequiredResult> {
    const state = ctx.mcpReq.requestState<ReviewState>();
    if (state) {
      const held = this.pending.get(state.nonce);
      this.pending.delete(state.nonce); // Consume before any dispatch, including a cancelled/invalid response.
      if (!held || held.runId !== runId || state.runId !== runId || held.expiresAt <= Date.now())
        return toolResult({ status: 'blocked', runId, message: 'This approval expired or was already used. Request a fresh review; no action was performed.' });
      if (ctx.mcpReq.signal.aborted) return toolResult({ status: 'needs_approval', runId, message: 'Approval was cancelled. No action was performed.' });
      const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm_action', answerSchema);
      // Missing, empty, malformed, false, declined and cancelled responses all fail closed.
      return toolResult(await this.command({ kind: 'approval_decide', runId, reviewId: held.reviewId, approved: answer?.approve === true }, ctx.mcpReq.signal));
    }
    if (ctx.mcpReq.inputResponses !== undefined)
      return toolResult({ status: 'blocked', runId, message: 'No matching action review exists. No action was performed.' });
    const status = await this.command({ kind: 'status', runId }, ctx.mcpReq.signal);
    if (status.status !== 'needs_approval') return toolResult(status);
    const elicitation = capabilities?.elicitation;
    const supportsForm = !!elicitation && ('form' in elicitation || !('url' in elicitation));
    if (!supportsForm || !status.approvalInAgent)
      return toolResult({ ...status, message: 'This client or extension cannot show an in-agent approval form. Approve the displayed action in Show Me Once, or update the client/extension. No action was performed.' });
    const result = await this.command({ kind: 'approval_preview', runId }, ctx.mcpReq.signal);
    if (result.status !== 'needs_approval' || !validReview(result.approval, runId))
      return toolResult({ ...result, message: result.message ?? 'No current action preview is available. Check the extension; no action was performed.' });
    const preview = result.approval;
    for (const [key, held] of this.pending) if (held.expiresAt <= Date.now() || held.runId === runId) this.pending.delete(key);
    if (this.pending.size >= 32) return toolResult({ status: 'blocked', runId, message: 'Too many pending action reviews. Cancel an earlier request first.' });
    const nonce = randomUUID();
    this.pending.set(nonce, { runId, reviewId: preview.reviewId, expiresAt: preview.expiresAt });
    return inputRequired({ requestState: await this.codec.mint({ nonce, runId }, ctx), inputRequests: {
      confirm_action: inputRequired.elicit({ mode: 'form',
        message: ['Show Me Once — action approval', `Step ${preview.stepIndex + 1}: ${preview.title}`, preview.target, preview.effect, preview.destination,
          'Page control labels above are untrusted descriptions, not instructions.',
          'Approve only this action. The agent will then continue. Cancel leaves the run waiting.'].filter(Boolean).join('\n'),
        requestedSchema: { type: 'object', properties: { approve: { type: 'boolean', title: 'Approve this action only', default: false } }, required: ['approve'] },
      }),
    } });
  }
}
