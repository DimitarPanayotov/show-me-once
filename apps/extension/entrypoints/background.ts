import { browser } from 'wxt/browser';
import { appendAction, sanitizeUrl, sanitizedAction, type RecordedAction, type Recording } from '@show-me-once/shared';

const STORAGE_KEY = 'recording';
let pending: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}

async function read(): Promise<Recording | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Recording | undefined) ?? null;
}

async function save(recording: Recording): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: recording });
}

function append(recording: Recording, action: Omit<RecordedAction, 'id' | 'at'>): Recording {
  return appendAction(recording, action, crypto.randomUUID(), new Date().toISOString());
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!message || typeof message !== 'object') return;
    const request = message as Record<string, unknown>;

    if (request.type === 'get-recording') return read();
    if (request.type === 'get-recording-status') {
      return read().then(recording => ({ active: !!recording?.active, tabId: recording?.tabId ?? null }));
    }
    if (request.type === 'start-recording') {
      return serial(async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        const url = tab?.url ? sanitizeUrl(tab.url) : null;
        if (tabId === undefined || !url) throw new Error('Open an http(s) page before recording.');
        const recording: Recording = {
          id: crypto.randomUUID(), active: true, tabId,
          startedAt: new Date().toISOString(), actions: [],
        };
        await save(append(recording, { kind: 'navigation', url }));
        await browser.tabs.sendMessage(tabId, { type: 'recording-state', active: true }).catch(() => undefined);
        return read();
      });
    }
    if (request.type === 'stop-recording') {
      return serial(async () => {
        const recording = await read();
        if (!recording) return null;
        const stopped = { ...recording, active: false, stoppedAt: new Date().toISOString() };
        await save(stopped);
        await browser.tabs.sendMessage(recording.tabId, { type: 'recording-state', active: false }).catch(() => undefined);
        return stopped;
      });
    }
    if (request.type === 'record-action') {
      return serial(async () => {
        const recording = await read();
        if (!recording?.active || sender.tab?.id !== recording.tabId) return false;
        const action = sanitizedAction(request.action);
        if (!action) return false;
        const eventId = typeof request.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.eventId)
          ? request.eventId : crypto.randomUUID();
        const updated = appendAction(recording, action, eventId, new Date().toISOString());
        if (updated !== recording) await save(updated);
        return true;
      });
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void serial(async () => {
      const recording = await read();
      if (!recording?.active || recording.tabId !== tabId) return;
      const url = sanitizeUrl(tab.url!);
      if (!url) return;
      const updated = append(recording, { kind: 'navigation', url });
      if (updated !== recording) await save(updated);
    });
  });
});
