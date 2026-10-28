import { sanitizeUrl } from '@show-me-once/shared';

export type McpTab = { id?: number; url?: string; status?: string; incognito?: boolean };
export class McpTargetError extends Error {
  readonly errorCode: 'START_PAGE_REQUIRED' | 'START_TAB_AMBIGUOUS' | 'START_TAB_CLOSED' | 'START_PAGE_LOADING';
  readonly expected: string;
  readonly actual?: string | null;
  constructor(errorCode: McpTargetError['errorCode'], expected: string, actual?: string | null) {
    super(errorCode === 'START_TAB_AMBIGUOUS'
      ? 'More than one starting tab is open. Open Show Me Once on the intended page and click Use this tab for the agent.'
      : errorCode === 'START_TAB_CLOSED'
        ? 'The chosen agent tab was closed. Open the task page and click Use this tab for the agent again.'
        : errorCode === 'START_PAGE_LOADING'
          ? 'The starting page is still loading. Wait for it to finish, then retry Start.'
          : 'Open Show Me Once on the skill’s starting page, click Use this tab for the agent, then retry Start.');
    this.errorCode = errorCode; this.expected = expected; this.actual = actual;
  }
}

/** Full URLs stay local. Only user-bound tabs or a unique known public start page may be used. */
export function chooseMcpStartTab({ expected, exactStart, focused, candidates = [], pinned, pinnedRequested = false }: {
  expected: string; exactStart?: string; focused?: McpTab; candidates?: McpTab[]; pinned?: McpTab; pinnedRequested?: boolean;
}): McpTab & { id: number; url: string } {
  const actual = focused?.url ? sanitizeUrl(focused.url) : null;
  const safeActual = actual && new URL(actual).origin === new URL(expected).origin ? actual : null;
  const matches = (tab?: McpTab): tab is McpTab & { id: number; url: string } => {
    if (tab?.id === undefined || !tab.url || tab.incognito || sanitizeUrl(tab.url) !== expected) return false;
    if (!exactStart) return true;
    const url = new URL(tab.url), known = new URL(exactStart);
    return url.origin === known.origin && url.pathname.replace(/\/$/, '') === known.pathname.replace(/\/$/, '');
  };
  const ready = (tab: McpTab & { id: number; url: string }) => {
    if (tab.status === 'loading') throw new McpTargetError('START_PAGE_LOADING', expected, safeActual);
    return tab;
  };
  if (pinnedRequested) {
    if (!pinned) throw new McpTargetError('START_TAB_CLOSED', expected);
    if (!matches(pinned)) throw new McpTargetError('START_PAGE_REQUIRED', expected);
    return ready(pinned);
  }
  if (matches(focused)) return ready(focused);
  // Recordings retain only origin/path depth. Never guess another tab from that alone.
  const known = exactStart ? candidates.filter(matches) : [];
  if (known.length === 1) return ready(known[0]!);
  throw new McpTargetError(known.length > 1 ? 'START_TAB_AMBIGUOUS' : 'START_PAGE_REQUIRED', expected, safeActual);
}
