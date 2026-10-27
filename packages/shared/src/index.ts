export type RecordedAction = {
  id: string;
  at: string;
  kind: 'navigation' | 'click' | 'input' | 'key';
  url: string;
  selector?: string;
  inputKind?: 'text' | 'search' | 'checkbox' | 'radio' | 'select';
  checked?: boolean;
  key?: 'Enter';
};

export type Recording = {
  id: string;
  active: boolean;
  tabId: number;
  startedAt: string;
  stoppedAt?: string;
  actions: RecordedAction[];
};

export type SkillParameter = { name: string; type: 'string' | 'boolean' };
export type SkillStep =
  | { kind: 'navigation'; url: string }
  | { kind: 'click'; url: string; selector: string; parameter?: string }
  | { kind: 'input'; url: string; selector: string; inputKind: NonNullable<RecordedAction['inputKind']>; parameter: string }
  | { kind: 'key'; url: string; selector: string; key: 'Enter' };
export type SkillPlan = { schemaVersion: 1; parameters: SkillParameter[]; steps: SkillStep[] };
export type RunLog = { step: number; kind: SkillStep['kind']; status: 'done' | 'blocked' | 'confirmation-required'; at: string; detail: string };
export type RunState = {
  id: string; tabId: number; active: boolean; nextStep: number; totalSteps: number;
  mode?: 'automatic' | 'manual'; pauseReason?: 'user' | 'confirmation' | 'blocked'; skillKey?: string;
  confirmationStep?: number; inFlightStep?: number; awaitingNavigation?: boolean; navigationObserved?: boolean; navigationStartedAt?: number;
  remoteRunId?: string; remoteSyncedLogs?: number; syncError?: string; logs: RunLog[];
  engine?: 'agent' | 'recorded' | 'external'; provider?: 'openai' | 'anthropic' | 'codex-local'; thinking?: boolean;
};

export function appendAction(
  recording: Recording,
  action: Omit<RecordedAction, 'id' | 'at'>,
  id: string,
  at: string,
): Recording {
  if (recording.actions.some(existing => existing.id === id)) return recording;
  const last = recording.actions.at(-1);
  if (action.kind === 'navigation' && last?.kind === 'navigation' && last.url === action.url) {
    const elapsed = Date.parse(at) - Date.parse(last.at);
    if (elapsed >= 0 && elapsed < 1500) return recording;
  }
  return { ...recording, actions: [...recording.actions, { ...action, id, at }] };
}

/** Keep only the origin and path depth. Query, fragment, credentials and path text can carry secrets. */
export function sanitizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const origin = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
    const depth = url.pathname.split('/').filter(Boolean).length;
    return depth ? `${origin}/${Array(depth).fill('…').join('/')}` : origin;
  } catch {
    return null;
  }
}

/** Structural CSS locator: no text, attribute values or form data leave the page. */
export function structuralSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 7) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') break;
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function sanitizedAction(value: unknown): Omit<RecordedAction, 'id' | 'at'> | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.kind !== 'navigation' && input.kind !== 'click' && input.kind !== 'input' && input.kind !== 'key') return null;
  const url = typeof input.url === 'string' ? sanitizeUrl(input.url) : null;
  if (!url) return null;
  const action: Omit<RecordedAction, 'id' | 'at'> = { kind: input.kind, url };
  if (input.kind !== 'navigation') {
    if (typeof input.selector !== 'string' || !/^[a-z0-9:()> -]+$/.test(input.selector) || input.selector.length > 400) return null;
    action.selector = input.selector;
  }
  if (input.kind === 'input') {
    if (input.inputKind !== 'text' && input.inputKind !== 'search' && input.inputKind !== 'checkbox' && input.inputKind !== 'radio' && input.inputKind !== 'select') return null;
    action.inputKind = input.inputKind;
    if ((input.inputKind === 'checkbox' || input.inputKind === 'radio') && typeof input.checked === 'boolean') action.checked = input.checked;
  }
  if (input.kind === 'key') {
    if (input.key !== 'Enter') return null;
    action.key = 'Enter';
  }
  return action;
}

/** Produce an editable skill without using page text, form values, or unredacted URLs. */
export function createSkillMarkdown(recording: Recording, name: string, description: string): string {
  if (recording.active) throw new Error('Stop recording before generating a skill.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Use a lowercase skill name with hyphens.');
  if (!description.trim()) throw new Error('Add a short description.');

  const safeActions = recording.actions.map(action => sanitizedAction(action)).filter(action => action !== null);
  // Repeated focus clicks on a text field do not change the replacement input step.
  const actions = safeActions.filter((action, index) => {
    const next = safeActions[index + 1];
    return !(action.kind === 'click' && action.selector?.split(' > ').at(-1)?.startsWith('input:')
      && next?.kind === 'click' && next.url === action.url && next.selector === action.selector);
  });
  if (actions.length === 0) throw new Error('Record at least one action first.');
  const host = new URL(actions[0]!.url).hostname;
  const hasInput = actions.some(action => action.kind === 'input');
  const parameters: string[] = [];
  const steps: string[] = [];
  const plan: SkillPlan = { schemaVersion: 1, parameters: [], steps: [] };
  let inputNumber = 0;
  let targetNumber = 0;

  for (const [index, action] of actions.entries()) {
    const number = index + 1;
    if (action.kind === 'navigation') {
      steps.push(`${number}. **Navigation checkpoint:** Wait for the current tab to match \`${action.url}\` (same origin and path depth). Stop if it does not.`);
      plan.steps.push({ kind: 'navigation', url: action.url });
    } else if (action.kind === 'input') {
      const parameter = `${action.inputKind}_${++inputNumber}`;
      const type = action.inputKind === 'checkbox' || action.inputKind === 'radio' ? 'boolean' : 'string';
      parameters.push(`- \`${parameter}\` (${type}, required): replacement for the ${action.inputKind} control in step ${number}.`);
      steps.push(`${number}. Find one visible ${action.inputKind} control at \`${action.selector}\`. Set it from \`{{${parameter}}}\`; verify the control accepted it locally without logging the value.`);
      plan.parameters.push({ name: parameter, type });
      plan.steps.push({ kind: 'input', url: action.url, selector: action.selector!, inputKind: action.inputKind!, parameter });
    } else if (action.kind === 'key') {
      steps.push(`${number}. Press Enter in the visible control at \`${action.selector}\` to submit or apply the supplied input. Confirm before any submission with irreversible effects.`);
      plan.steps.push({ kind: 'key', url: action.url, selector: action.selector!, key: 'Enter' });
    } else {
      const selector = `\`${action.selector}\``;
      if (!hasInput) {
        const parameter = `target_${++targetNumber}`;
        parameters.push(`- \`${parameter}\` (string, required): describe the intended target for step ${number}.`);
        steps.push(`${number}. Find the target described by \`{{${parameter}}}\`. Use the recorded structural selector ${selector} only after confirming it points to that target, then click it.`);
        plan.parameters.push({ name: parameter, type: 'string' });
        plan.steps.push({ kind: 'click', url: action.url, selector: action.selector!, parameter });
      } else {
        steps.push(`${number}. Find one visible, enabled control at ${selector}, verify it is the intended target, then click it.`);
        plan.steps.push({ kind: 'click', url: action.url, selector: action.selector! });
      }
    }
  }

  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description.trim())}`,
    '---',
    '',
    '# Instructions',
    `Start in a browser tab on ${host}. Use the supplied parameters for this run. The recorded selectors are hints, not proof that an element is safe to act on.`,
    '',
    '## Parameters',
    ...parameters,
    '',
    '## Steps',
    ...steps,
    '',
    '## Checkpoints and safety',
    '- Before every click or input, confirm the target is unique, visible, enabled, and matches the intended action. Stop and ask the user if it does not.',
    '- After each navigation, confirm the expected origin and path depth before continuing. Stop on an unexpected page.',
    '- Obtain explicit user confirmation before any destructive action, purchase, payment, or submission with irreversible effects.',
    '- Never record passwords, secrets, page text, or parameter values in the skill or run log.',
    '',
    '## Executable plan',
    'The runner reads this block. Keep it aligned with the instructions when editing the skill.',
    '```json show-me-once',
    JSON.stringify(plan, null, 2),
    '```',
    '',
  ].join('\n');
}

/** Validate the editable executable block before it can control a browser tab. */
export function parseSkillPlan(markdown: string): SkillPlan {
  const match = /```json show-me-once\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  if (!match) throw new Error('This skill has no executable plan. Regenerate it from the recording.');
  let value: unknown;
  try { value = JSON.parse(match[1]!); } catch { throw new Error('The executable plan is not valid JSON.'); }
  if (!value || typeof value !== 'object') throw new Error('Invalid executable plan.');
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.parameters) || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 100 || raw.parameters.length > 30) {
    throw new Error('Invalid executable plan.');
  }
  const parameters: SkillParameter[] = raw.parameters.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid skill parameter.');
    const parameter = item as Record<string, unknown>;
    if (typeof parameter.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(parameter.name) || (parameter.type !== 'string' && parameter.type !== 'boolean')) {
      throw new Error('Invalid skill parameter.');
    }
    return { name: parameter.name, type: parameter.type };
  });
  if (new Set(parameters.map(parameter => parameter.name)).size !== parameters.length) throw new Error('Duplicate skill parameter.');
  const steps: SkillStep[] = raw.steps.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid skill step.');
    const step = item as Record<string, unknown>;
    const clean = sanitizedAction(step);
    if (!clean || clean.url !== step.url || Object.keys(step).some(key => !['kind', 'url', 'selector', 'inputKind', 'parameter', 'key'].includes(key))) {
      throw new Error('Unsafe or invalid skill step.');
    }
    if (clean.kind === 'navigation') return { kind: 'navigation', url: clean.url };
    if (clean.kind === 'key') return { kind: 'key', url: clean.url, selector: clean.selector!, key: 'Enter' };
    if (clean.kind === 'click') {
      if (step.parameter !== undefined && (typeof step.parameter !== 'string' || !parameters.some(parameter => parameter.name === step.parameter && parameter.type === 'string'))) {
        throw new Error('Invalid click parameter.');
      }
      return { kind: 'click', url: clean.url, selector: clean.selector!, ...(step.parameter ? { parameter: step.parameter as string } : {}) };
    }
    if (typeof step.parameter !== 'string' || !parameters.some(parameter => parameter.name === step.parameter && parameter.type === (clean.inputKind === 'checkbox' || clean.inputKind === 'radio' ? 'boolean' : 'string'))) {
      throw new Error('Invalid input parameter.');
    }
    return { kind: 'input', url: clean.url, selector: clean.selector!, inputKind: clean.inputKind!, parameter: step.parameter };
  });
  return { schemaVersion: 1, parameters, steps };
}
