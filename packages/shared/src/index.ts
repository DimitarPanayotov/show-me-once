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
