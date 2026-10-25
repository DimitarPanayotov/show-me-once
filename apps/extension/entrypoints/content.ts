import { browser } from 'wxt/browser';
import { sanitizeUrl, structuralSelector, type SkillStep } from '@show-me-once/shared';

function isSensitive(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.isContentEditable || element.closest('[contenteditable="true"]')) return true;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
  const attributes = [element.getAttribute('type'), element.getAttribute('name'), element.getAttribute('id'), element.getAttribute('autocomplete')].join(' ').toLowerCase();
  return /password|passwd|secret|token|otp|one.time|auth|credit|card|cvc|cvv|ssn|private|key|pin|hidden|email|tel|phone/.test(attributes);
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    let active = false;
    let lastLocation = location.href;
    let lastPointer: { selector: string; id: string; at: number } | null = null;
    let stateRevision = 0;

    function usable(element: Element): element is HTMLElement {
      if (!(element instanceof HTMLElement) || isSensitive(element)) return false;
      if (element instanceof HTMLInputElement && element.disabled) return false;
      if (element instanceof HTMLButtonElement && element.disabled) return false;
      if (element instanceof HTMLSelectElement && element.disabled) return false;
      if (element instanceof HTMLTextAreaElement && element.disabled) return false;
      if (element.getAttribute('aria-disabled') === 'true') return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    }

    function executeStep(step: SkillStep, value: unknown, confirmed: boolean): { status: 'done' | 'blocked' | 'confirmation-required' } {
      if (sanitizeUrl(location.href) !== step.url || step.kind === 'navigation') return { status: 'blocked' };
      const matches = [...document.querySelectorAll(step.selector)].filter(usable);
      let target: HTMLElement | undefined;
      if (step.kind === 'click' && step.parameter) {
        if (typeof value !== 'string' || !value.trim()) return { status: 'blocked' };
        const wanted = value.trim().toLocaleLowerCase();
        const named = [...document.querySelectorAll('a,button,[role="link"],[role="button"]')]
          .filter(usable)
          .filter(element => (element.getAttribute('aria-label') || element.innerText).trim().toLocaleLowerCase() === wanted);
        if (named.length > 1) return { status: 'blocked' };
        if (named.length === 1) target = named[0];
        else if (named.length === 0) {
          const partial = [...document.querySelectorAll('a,button,[role="link"],[role="button"]')]
            .filter(usable)
            .filter(element => (element.getAttribute('aria-label') || element.innerText).trim().toLocaleLowerCase().includes(wanted));
          if (partial.length > 1) return { status: 'blocked' };
          if (partial.length === 1) target = partial[0];
        }
        if (!target && matches.length === 1) {
          const label = (matches[0]!.getAttribute('aria-label') || matches[0]!.innerText).trim().toLocaleLowerCase();
          if (label.includes(wanted)) target = matches[0];
        }
      } else if (matches.length === 1) {
        target = matches[0];
      }
      if (!target) return { status: 'blocked' };

      if (step.kind === 'click') {
        const label = `${target.getAttribute('aria-label') ?? ''} ${target.getAttribute('title') ?? ''} ${target.innerText ?? ''}`;
        const destination = target instanceof HTMLAnchorElement ? target.href : '';
        const submits = (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) && target.type === 'submit';
        if (!confirmed && (submits || /\b(delete|remove|pay|purchase|buy|checkout|transfer|submit|place order)\b/i.test(`${label} ${destination}`))) {
          return { status: 'confirmation-required' };
        }
        ctx.setTimeout(() => { if (ctx.isValid) target.click(); }, 0);
        return { status: 'done' };
      }

      if (step.inputKind === 'checkbox' || step.inputKind === 'radio') {
        if (!(target instanceof HTMLInputElement) || target.type !== step.inputKind || typeof value !== 'boolean') return { status: 'blocked' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
        setter?.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { status: target.checked === value ? 'done' : 'blocked' };
      }
      if (typeof value !== 'string') return { status: 'blocked' };
      if (step.inputKind === 'select') {
        if (!(target instanceof HTMLSelectElement) || ![...target.options].some(option => option.value === value)) return { status: 'blocked' };
        target.value = value;
      } else {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return { status: 'blocked' };
        const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: target.value === value ? 'done' : 'blocked' };
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.recording) {
        active = !!(changes.recording.newValue as { active?: boolean } | undefined)?.active;
        stateRevision++;
      }
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      if ((message as { type?: string }).type === 'recorder-ping') {
        sendResponse(true);
        return;
      }
      if ((message as { type?: string }).type === 'execute-skill-step') {
        const request = message as { step?: SkillStep; value?: unknown; confirmed?: boolean };
        sendResponse(request.step ? executeStep(request.step, request.value, request.confirmed === true) : { status: 'blocked' });
        return;
      }
      if ((message as { type?: string }).type === 'recording-state') {
        active = !!(message as { active?: boolean }).active;
        stateRevision++;
      }
    });

    function send(action: Record<string, unknown>, eventId?: string) {
      if (!active) return;
      void browser.runtime.sendMessage({ type: 'record-action', eventId, action: { ...action, url: location.href } }).catch(() => undefined);
    }

    function clickSelector(target: EventTarget | null): string | null {
      if (!(target instanceof Element)) return null;
      const interactive = target.closest('a,button,input,select,textarea,[role="button"],[role="link"]');
      if (!interactive || isSensitive(interactive)) return null;
      return structuralSelector(interactive);
    }

    ctx.addEventListener(document, 'pointerdown', (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      const selector = clickSelector(event.target);
      if (!selector) return;
      const id = crypto.randomUUID();
      lastPointer = { selector, id, at: Date.now() };
      send({ kind: 'click', selector }, id);
    }, true);

    ctx.addEventListener(document, 'click', (event) => {
      const selector = clickSelector(event.target);
      if (!selector) return;
      const id = lastPointer?.selector === selector && Date.now() - lastPointer.at < 1500
        ? lastPointer.id : crypto.randomUUID();
      lastPointer = null;
      send({ kind: 'click', selector }, id);
    }, true);

    ctx.addEventListener(document, 'change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
      if (isSensitive(target)) return;
      let inputKind: 'text' | 'search' | 'checkbox' | 'radio' | 'select' = 'text';
      if (target instanceof HTMLSelectElement) inputKind = 'select';
      else if (target instanceof HTMLInputElement) {
        if (target.type === 'checkbox') inputKind = 'checkbox';
        else if (target.type === 'radio') inputKind = 'radio';
        else if (target.type === 'search') inputKind = 'search';
      }
      send({ kind: 'input', selector: structuralSelector(target), inputKind,
        ...((inputKind === 'checkbox' || inputKind === 'radio') ? { checked: (target as HTMLInputElement).checked } : {}) });
    }, true);

    ctx.setInterval(() => {
      if (location.href === lastLocation) return;
      lastLocation = location.href;
      send({ kind: 'navigation' });
    }, 500);

    // Never delay event listeners while a dormant service worker wakes up.
    const revisionAtRequest = stateRevision;
    void browser.runtime.sendMessage({ type: 'get-recording-status' })
      .then((status: { active?: boolean } | null) => {
        if (stateRevision === revisionAtRequest) active = !!status?.active;
      })
      .catch(() => undefined);
  },
});
