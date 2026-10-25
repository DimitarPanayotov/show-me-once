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
  async main(ctx) {
    let active = false;
    let lastLocation = location.href;
    const status = await browser.runtime.sendMessage({ type: 'get-recording-status' }).catch(() => null) as { active?: boolean; tabId?: number } | null;
    active = !!status?.active;

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.recording) active = !!(changes.recording.newValue as { active?: boolean } | undefined)?.active;
    });

    function send(action: Record<string, unknown>) {
      if (!active) return;
      void browser.runtime.sendMessage({ type: 'record-action', action: { ...action, url: location.href } }).catch(() => undefined);
    }

    ctx.addEventListener(document, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const interactive = target.closest('a,button,input,select,textarea,[role="button"],[role="link"]');
      if (!interactive || isSensitive(interactive)) return;
      send({ kind: 'click', selector: structuralSelector(interactive) });
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
  },
});
