export type RecordedAction = {
  id: string;
  at: string;
  kind: 'navigation' | 'click' | 'input';
  url: string;
  selector?: string;
  inputKind?: 'text' | 'search' | 'checkbox' | 'radio' | 'select';
  checked?: boolean;
};

export type Recording = {
  id: string;
  active: boolean;
  tabId: number;
  startedAt: string;
  stoppedAt?: string;
  actions: RecordedAction[];
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
  if (input.kind !== 'navigation' && input.kind !== 'click' && input.kind !== 'input') return null;
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
  return action;
}

/** Produce an editable skill without using page text, form values, or unredacted URLs. */
export function createSkillMarkdown(recording: Recording, name: string, description: string): string {
  if (recording.active) throw new Error('Stop recording before generating a skill.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Use a lowercase skill name with hyphens.');
  if (!description.trim()) throw new Error('Add a short description.');

  const actions = recording.actions.map(action => sanitizedAction(action)).filter(action => action !== null);
  if (actions.length === 0) throw new Error('Record at least one action first.');
  const host = new URL(actions[0]!.url).hostname;
  const hasInput = actions.some(action => action.kind === 'input');
  const parameters: string[] = [];
  const steps: string[] = [];
  let inputNumber = 0;
  let targetNumber = 0;

  for (const [index, action] of actions.entries()) {
    const number = index + 1;
    if (action.kind === 'navigation') {
      steps.push(`${number}. **Navigation checkpoint:** Wait for the current tab to match \`${action.url}\` (same origin and path depth). Stop if it does not.`);
    } else if (action.kind === 'input') {
      const parameter = `${action.inputKind}_${++inputNumber}`;
      const type = action.inputKind === 'checkbox' || action.inputKind === 'radio' ? 'boolean' : 'string';
      parameters.push(`- \`${parameter}\` (${type}, required): replacement for the ${action.inputKind} control in step ${number}.`);
      steps.push(`${number}. Find one visible ${action.inputKind} control at \`${action.selector}\`. Set it from \`{{${parameter}}}\`; verify the control accepted it locally without logging the value.`);
    } else {
      const selector = `\`${action.selector}\``;
      if (!hasInput) {
        const parameter = `target_${++targetNumber}`;
        parameters.push(`- \`${parameter}\` (string, required): describe the intended target for step ${number}.`);
        steps.push(`${number}. Find the target described by \`{{${parameter}}}\`. Use the recorded structural selector ${selector} only after confirming it points to that target, then click it.`);
      } else {
        steps.push(`${number}. Find one visible, enabled control at ${selector}, verify it is the intended target, then click it.`);
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
  ].join('\n');
}
