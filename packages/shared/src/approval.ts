import { checkedExternalCommand, type ExternalCommand, type ExternalResult } from './mcp.ts';

/** Private connector messages. None of these are accepted as ordinary MCP tool arguments. */
export type ConnectorCommand = ExternalCommand
  | { kind: 'approval_preview'; runId: string }
  | { kind: 'approval_decide'; runId: string; reviewId: string; approved: boolean };
export type ActionReview = {
  reviewId: string;
  runId: string;
  stepIndex: number;
  expiresAt: number;
  title: string;
  target: string;
  effect: string;
  destination: string;
};
export type ConnectorResult = ExternalResult & { approval?: ActionReview };

export function checkedConnectorCommand(raw: unknown): ConnectorCommand {
  const c = raw as Record<string, unknown> | null;
  if (!c || (c.kind !== 'approval_preview' && c.kind !== 'approval_decide')) return checkedExternalCommand(raw);
  const allowed = c.kind === 'approval_preview' ? ['kind', 'runId'] : ['kind', 'runId', 'reviewId', 'approved'];
  if (Object.keys(c).some(k => !allowed.includes(k)) || typeof c.runId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(c.runId))
    throw new Error('Invalid action review.');
  if (c.kind === 'approval_preview') return { kind: c.kind, runId: c.runId };
  if (typeof c.reviewId !== 'string' || !/^[0-9a-f-]{36}$/i.test(c.reviewId) || typeof c.approved !== 'boolean')
    throw new Error('Invalid action review.');
  return { kind: c.kind, runId: c.runId, reviewId: c.reviewId, approved: c.approved };
}
