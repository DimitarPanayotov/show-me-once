/** Only known, value-free diagnostics may enter persistent run logs. */
export function agentFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'The agent needs you to identify the intended control. Check the page, then retry or stop.')
    return 'The agent could not identify one matching control. Check the task inputs and results, then retry or stop.';
  if (['The local agent timed out. Retry this step.', 'The subscription helper timed out. Check Codex sign-in and retry.'].includes(message))
    return 'The agent decision timed out before a browser action was sent. Retry this step.';
  if (['Run inputs expired. Stop and start the run again.', 'Agent session expired. Stop and start the run again.'].includes(message))
    return 'Run inputs expired. Stop and start this saved skill again; recording again is unnecessary.';
  if (['Unsafe page observation.', 'Invalid page observation.', 'Duplicate page controls.'].includes(message))
    return 'The page description failed a safety check. Reload the page, then retry.';
  if (message === 'Supply this parameter explicitly; the agent could not extract it safely from your request.')
    return 'A required input is missing from your request. Stop and run the saved skill with that input included.';
  if (['The agent selected an unknown page control.', 'The agent action does not match the skill step.', 'The agent selected the wrong control type.'].includes(message))
    return 'The agent returned an action that did not match the current step or page. No action was sent; retry this step.';
  if (message === 'Codex could not complete the decision. Check its sign-in and usage limits.') return message;
  return 'Could not continue safely. Check the page and agent connection, then retry or stop.';
}
