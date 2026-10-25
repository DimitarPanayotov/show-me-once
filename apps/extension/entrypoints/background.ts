import { browser } from 'wxt/browser';
import { sanitizeUrl, sanitizedAction, type RecordedAction, type Recording } from '@show-me-once/shared';

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
  return {
    ...recording,
    actions: [...recording.actions, { ...action, id: crypto.randomUUID(), at: new Date().toISOString() }],
  };
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
        return read();
      });
    }
    if (request.type === 'stop-recording') {
      return serial(async () => {
        const recording = await read();
        if (!recording) return null;
        const stopped = { ...recording, active: false, stoppedAt: new Date().toISOString() };
        await save(stopped);
        return stopped;
      });
    }
    if (request.type === 'record-action') {
      return serial(async () => {
        const recording = await read();
        if (!recording?.active || sender.tab?.id !== recording.tabId) return false;
        const action = sanitizedAction(request.action);
        if (!action) return false;
        await save(append(recording, action));
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
      const last = recording.actions.at(-1);
      if (last?.kind === 'navigation' && last.url === url && Date.now() - Date.parse(last.at) < 1500) return;
      await save(append(recording, { kind: 'navigation', url }));
    });
  });
});
