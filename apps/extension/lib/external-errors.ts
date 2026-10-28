import type { ExternalResult } from '@show-me-once/shared/mcp';

// Only known application messages may cross the MCP boundary. Browser/library
// exceptions can contain URLs, page text or input values and stay private.
const reasons = new Map<string, [string, string]>([
  ['Stop the current recording or run first.', ['ACTIVE_TASK', 'Stop the current recording or run in Show Me Once, then ask your agent to start again.']],
  ['Stop the current run first.', ['ACTIVE_TASK', 'Stop the current run in Show Me Once before starting another.']],
  ['Open the skill starting page in the active Chrome tab.', ['START_PAGE_REQUIRED', 'Select the skill’s starting page in Chrome, then ask your agent to start again. For the built-in GitHub example, use https://github.com/search/advanced.']],
  ['Could not connect to this page. Check its extension access.', ['PAGE_ACCESS_REQUIRED', 'Show Me Once could not connect to the selected page. Check its site access in Chrome, reload that page and try again.']],
  ['Save your current draft before starting a different external skill.', ['UNSAVED_LIBRARY_DRAFT', 'Save the current edited library skill before switching to a different skill. Sign in to the library to save those edits.']],
  ['Sign in to the library first.', ['LIBRARY_SIGN_IN_REQUIRED', 'Sign in to Show Me Once to access library skills. The built-in example and locally recorded skills work without sign-in.']],
  ['Skill not found. Refresh the skills list.', ['SKILL_NOT_FOUND', 'Ask the agent to list skills again and use an available skill.']],
  ['The selected tab is not ready for this checkpoint.', ['PAGE_NOT_READY', 'Wait for the selected Chrome tab to finish loading the expected page, then ask the agent to observe again.']],
  ['The page needs human attention.', ['PAGE_NEEDS_ATTENTION', 'Check the selected page for a connection error or human-verification step, complete it yourself and retry.']],
  ['Connection changed. Resume in the extension before continuing.', ['CONNECTION_CHANGED', 'The connection changed. Inspect the page and resume the existing run in Show Me Once before continuing.']],
  ['This controller does not own that run.', ['RUN_NOT_OWNED', 'This agent session does not own that run. Use the original session, or stop the run in Show Me Once before starting a new one.']],
  ['Stale observation. Observe this run again.', ['STALE_OBSERVATION', 'Ask the agent to obtain a fresh observation before acting.']],
  ['The skill header is invalid. Read the original skill again.', ['INVALID_SKILL', 'The skill header is invalid. Ask the agent to read the original skill again before starting.']],
]);

export function externalCommandFailure(cause: unknown, operation: string): ExternalResult & { errorCode: string } {
  const message = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '';
  const known = reasons.get(message);
  const [errorCode, explanation] = known ?? ['COMMAND_FAILED', operation === 'start'
    ? 'Check Show Me Once for an active recording/run, unsaved library edits, or blocked site access. Inspect activity before retrying; do not assume a run needs Resume.'
    : 'The command could not complete. Inspect Show Me Once and the page before continuing; do not repeat an uncertain action.'];
  return { status: known ? 'blocked' : 'unknown_outcome', errorCode, message: `${operation === 'start' ? known ? 'Run not started' : 'Start could not complete' : 'Command blocked'}: ${explanation}` };
}
