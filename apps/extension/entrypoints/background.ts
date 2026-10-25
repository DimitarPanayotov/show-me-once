import { browser } from 'wxt/browser';
import { appendAction, parseSkillPlan, sanitizeUrl, sanitizedAction, type RecordedAction, type Recording, type RunState, type SkillPlan } from '@show-me-once/shared';

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

async function readRun(): Promise<RunState | null> {
  const stored = await browser.storage.local.get('runState');
  return (stored.runState as RunState | undefined) ?? null;
}

async function saveRun(run: RunState): Promise<RunState> {
  await browser.storage.local.set({ runState: run });
  return run;
}

function append(recording: Recording, action: Omit<RecordedAction, 'id' | 'at'>): Recording {
  return appendAction(recording, action, crypto.randomUUID(), new Date().toISOString());
}

async function ensureRecorder(tabId: number): Promise<void> {
  try {
    if (await browser.tabs.sendMessage(tabId, { type: 'recorder-ping' }) === true) return;
  } catch {
    // A tab opened before this extension version was loaded has no content script yet.
  }
  await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
  if (await browser.tabs.sendMessage(tabId, { type: 'recorder-ping' }) !== true) {
    throw new Error('Could not start recording on this page. Check its extension access.');
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!message || typeof message !== 'object') return;
    const request = message as Record<string, unknown>;

    if (request.type === 'get-recording') return read();
    if (request.type === 'get-run') return readRun();
    if (request.type === 'get-recording-status') {
      return read().then(recording => ({ active: !!recording?.active, tabId: recording?.tabId ?? null }));
    }
    if (request.type === 'start-recording') {
      return serial(async () => {
        if ((await readRun())?.active) throw new Error('Stop the current run before recording.');
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        const url = tab?.url ? sanitizeUrl(tab.url) : null;
        if (tabId === undefined || !url) throw new Error('Open an http(s) page before recording.');
        await ensureRecorder(tabId);
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
    if (request.type === 'run-navigation') {
      return serial(async () => {
        const run = await readRun();
        if (!run?.active || sender.tab?.id !== run.tabId || !run.awaitingNavigation || run.navigationObserved) return false;
        await saveRun({ ...run, navigationObserved: true });
        return true;
      });
    }
    if (request.type === 'start-run') {
      return serial(async () => {
        if ((await read())?.active) throw new Error('Stop recording before running a skill.');
        if ((await readRun())?.active) throw new Error('Stop the current run first.');
        if (typeof request.markdown !== 'string') throw new Error('Generate a skill first.');
        const plan = parseSkillPlan(request.markdown);
        const provided = request.parameters && typeof request.parameters === 'object' ? request.parameters as Record<string, unknown> : {};
        const parameters: Record<string, string | boolean> = {};
        for (const parameter of plan.parameters) {
          const value = provided[parameter.name];
          if (parameter.type === 'string' && (typeof value !== 'string' || !value.trim())) throw new Error(`Enter ${parameter.name}.`);
          if (parameter.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Select ${parameter.name}.`);
          parameters[parameter.name] = value as string | boolean;
        }
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url || !sanitizeUrl(tab.url)) throw new Error('Open an http(s) page before running.');
        await ensureRecorder(tab.id);
        const run: RunState = { id: crypto.randomUUID(), tabId: tab.id, active: true, nextStep: 0, totalSteps: plan.steps.length, logs: [] };
        await browser.storage.local.set({ runPlan: plan });
        await browser.storage.session.set({ runParameters: parameters });
        return saveRun(run);
      });
    }
    if (request.type === 'run-next-step') {
      return serial(async () => {
        const run = await readRun();
        if (!run?.active) throw new Error('No active run.');
        const { runPlan } = await browser.storage.local.get('runPlan') as { runPlan?: SkillPlan };
        const step = runPlan?.steps[run.nextStep];
        if (!step) throw new Error('Run plan is unavailable.');
        const tab = await browser.tabs.get(run.tabId);
        const currentUrl = tab.url ? sanitizeUrl(tab.url) : null;
        let status: 'done' | 'blocked' | 'confirmation-required' = 'blocked';
        let detail = 'The page does not match the recorded checkpoint.';
        if (currentUrl === step.url && step.kind === 'navigation' && run.awaitingNavigation && !run.navigationObserved) {
          detail = 'Waiting for navigation after the previous action.';
        }
        if (currentUrl === step.url && (step.kind !== 'navigation' || !run.awaitingNavigation || run.navigationObserved)) {
          if (step.kind === 'navigation') {
            status = 'done';
            detail = 'Navigation checkpoint matched.';
          } else {
            const { runParameters } = await browser.storage.session.get('runParameters') as { runParameters?: Record<string, string | boolean> };
            if (!runParameters) throw new Error('Run inputs expired. Stop and start the run again.');
            await ensureRecorder(run.tabId);
            const response = await browser.tabs.sendMessage(run.tabId, {
              type: 'execute-skill-step', step,
              value: 'parameter' in step && step.parameter ? runParameters[step.parameter] : undefined,
              confirmed: run.confirmationStep === run.nextStep && request.confirm === true,
            }) as { status?: string } | undefined;
            if (response?.status === 'done') {
              status = 'done'; detail = `${step.kind} dispatched.`;
            } else if (response?.status === 'confirmation-required') {
              status = 'confirmation-required'; detail = 'Explicit confirmation required before this action.';
            } else {
              detail = 'The target was unavailable or ambiguous.';
            }
          }
        }
        const nextStep = status === 'done' ? run.nextStep + 1 : run.nextStep;
        const awaitingNavigation = status === 'done' && (step.kind === 'click' || step.kind === 'key') && runPlan?.steps[nextStep]?.kind === 'navigation'
          ? true : status === 'done' && step.kind === 'navigation' ? false : run.awaitingNavigation;
        const navigationObserved = awaitingNavigation && status === 'done' && (step.kind === 'click' || step.kind === 'key')
          ? false : status === 'done' && step.kind === 'navigation' ? false : run.navigationObserved;
        const updated: RunState = {
          ...run,
          active: status === 'done' && nextStep === run.totalSteps ? false : true,
          nextStep,
          awaitingNavigation,
          navigationObserved,
          ...(status === 'confirmation-required' ? { confirmationStep: run.nextStep } : { confirmationStep: undefined }),
          logs: [...run.logs, { step: run.nextStep + 1, kind: step.kind, status, at: new Date().toISOString(), detail }],
        };
        if (!updated.active) await browser.storage.session.remove('runParameters');
        return saveRun(updated);
      });
    }
    if (request.type === 'stop-run') {
      return serial(async () => {
        const run = await readRun();
        await browser.storage.session.remove('runParameters');
        return run ? saveRun({ ...run, active: false, confirmationStep: undefined }) : null;
      });
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void serial(async () => {
      const run = await readRun();
      if (run?.active && run.tabId === tabId && run.awaitingNavigation && !run.navigationObserved) {
        await saveRun({ ...run, navigationObserved: true });
      }
      const recording = await read();
      if (!recording?.active || recording.tabId !== tabId) return;
      const url = sanitizeUrl(tab.url!);
      if (!url) return;
      const updated = append(recording, { kind: 'navigation', url });
      if (updated !== recording) await save(updated);
    });
  });
});
