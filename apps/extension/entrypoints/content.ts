import { browser } from 'wxt/browser';
import { structuralSelector } from '@show-me-once/shared';

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

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.recording) {
        active = !!(changes.recording.newValue as { active?: boolean } | undefined)?.active;
        stateRevision++;
      }
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      if ((message as { type?: string }).type === 'recorder-ping') return true;
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
