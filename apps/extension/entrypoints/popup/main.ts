import { browser } from 'wxt/browser';
import { createSkillMarkdown, parseSkillPlan, type Recording, type RunState, type SkillParameter, type SkillPlan } from '@show-me-once/shared';
import './style.css';

const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLElement>('#status')!;
const error = document.querySelector<HTMLElement>('#error')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const timeline = document.querySelector<HTMLOListElement>('#timeline')!;
const count = document.querySelector<HTMLElement>('#count')!;
const skillSection = document.querySelector<HTMLElement>('#skill-section')!;
const draftSection = document.querySelector<HTMLElement>('#draft-section')!;
const skillName = document.querySelector<HTMLInputElement>('#skill-name')!;
const skillDescription = document.querySelector<HTMLInputElement>('#skill-description')!;
const skillMarkdown = document.querySelector<HTMLTextAreaElement>('#skill-markdown')!;
const generate = document.querySelector<HTMLButtonElement>('#generate')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const saveLibrary = document.querySelector<HTMLButtonElement>('#save-library')!;
const accountStatus = document.querySelector<HTMLElement>('#account-status')!;
const accountForm = document.querySelector<HTMLFormElement>('#account-form')!;
const accountEmail = document.querySelector<HTMLInputElement>('#account-email')!;
const accountPassword = document.querySelector<HTMLInputElement>('#account-password')!;
const accountLogout = document.querySelector<HTMLButtonElement>('#account-logout')!;
const libraryControls = document.querySelector<HTMLElement>('#library-controls')!;
const libraryRefresh = document.querySelector<HTMLButtonElement>('#library-refresh')!;
const librarySkills = document.querySelector<HTMLSelectElement>('#library-skills')!;
const libraryLoad = document.querySelector<HTMLButtonElement>('#library-load')!;
const webApp = document.querySelector<HTMLAnchorElement>('#web-app')!;
const runParameters = document.querySelector<HTMLElement>('#run-parameters')!;
const runStart = document.querySelector<HTMLButtonElement>('#run-start')!;
const runControls = document.querySelector<HTMLElement>('#run-controls')!;
const runStatus = document.querySelector<HTMLElement>('#run-status')!;
const runNext = document.querySelector<HTMLButtonElement>('#run-next')!;
const runConfirm = document.querySelector<HTMLButtonElement>('#run-confirm')!;
const runStop = document.querySelector<HTMLButtonElement>('#run-stop')!;
const runLog = document.querySelector<HTMLOListElement>('#run-log')!;
type SkillDraft = { sourceRecordingId: string; name: string; description: string; markdown: string; remoteSkillId?: string; readOnly?: boolean };
let shownRecordingId: string | null = null;
let parameterDefinitions: SkillParameter[] = [];
let planValid = false;
let currentDraft: SkillDraft | null = null;
let signedInUser: { id: string; email: string } | null = null;
webApp.href = import.meta.env.WXT_API_BASE_URL || 'http://localhost:3000';

function showParameters(markdown: string) {
  runParameters.replaceChildren();
  try {
    parameterDefinitions = parseSkillPlan(markdown).parameters;
    planValid = true;
    for (const parameter of parameterDefinitions) {
      const label = document.createElement('label');
      label.textContent = parameter.name;
      const input = document.createElement('input');
      input.dataset.parameter = parameter.name;
      input.type = parameter.type === 'boolean' ? 'checkbox' : 'text';
      label.append(input);
      runParameters.append(label);
    }
    runStart.disabled = false;
  } catch {
    parameterDefinitions = [];
    planValid = false;
    runStart.disabled = true;
  }
}

function showDraft(draft: SkillDraft | null) {
  currentDraft = draft;
  draftSection.hidden = !draft;
  if (!draft) return;
  skillName.value = draft.name;
  skillDescription.value = draft.description;
  skillMarkdown.value = draft.markdown;
  skillName.disabled = !!draft.readOnly;
  skillDescription.disabled = !!draft.readOnly;
  skillMarkdown.disabled = !!draft.readOnly;
  showParameters(draft.markdown);
}

async function refreshLibrary() {
  if (!signedInUser) return;
  const skills = await browser.runtime.sendMessage({ type: 'library-list' }) as
    { id: string; title: string; ownerId: string; currentVersion: number }[];
  librarySkills.replaceChildren();
  for (const skill of skills) {
    const option = document.createElement('option');
    option.value = skill.id;
    option.textContent = `${skill.title} · v${skill.currentVersion}${skill.ownerId === signedInUser.id ? '' : ' · shared'}`;
    librarySkills.append(option);
  }
  libraryLoad.disabled = skills.length === 0;
}

async function renderAccount() {
  signedInUser = await browser.runtime.sendMessage({ type: 'account-status' }) as typeof signedInUser;
  accountStatus.textContent = signedInUser ? `Signed in as ${signedInUser.email}` : 'Sign in to save and load shared skills.';
  accountForm.hidden = !!signedInUser;
  libraryControls.hidden = !signedInUser;
  if (signedInUser) await refreshLibrary();
  await renderRun();
}

function persistDraft() {
  if (!currentDraft || currentDraft.readOnly) return;
  const draft: SkillDraft = { ...currentDraft, name: skillName.value.trim(),
    description: skillDescription.value.trim(), markdown: skillMarkdown.value };
  currentDraft = draft;
  showParameters(draft.markdown);
  void browser.storage.local.set({ skillDraft: draft });
}

async function renderRun() {
  const [run, stored] = await Promise.all([
    browser.runtime.sendMessage({ type: 'get-run' }) as Promise<RunState | null>,
    browser.storage.local.get('runPlan'),
  ]);
  runControls.hidden = !run?.active;
  if (run?.syncError) error.textContent = run.syncError;
  runStart.disabled = !!run?.active || draftSection.hidden || !planValid;
  skillMarkdown.disabled = !!run?.active || !!currentDraft?.readOnly;
  generate.disabled = !!run?.active;
  saveLibrary.disabled = !!run?.active || !signedInUser || !planValid || !!currentDraft?.readOnly;
  if (run?.active) {
    const upcoming = (stored.runPlan as SkillPlan | undefined)?.steps[run.nextStep];
    const action = upcoming?.kind === 'navigation' && run.awaitingNavigation && !run.navigationObserved
      ? 'Waiting for the page to finish navigating'
      : upcoming?.kind === 'navigation' ? `Check ${upcoming.url}`
      : upcoming?.kind === 'input' ? `Fill ${upcoming.inputKind} control (value hidden)`
      : upcoming?.kind === 'key' ? 'Press Enter in the matched control'
      : upcoming?.kind === 'click' ? 'Click the matched control' : 'Unknown step';
    runStatus.textContent = `Step ${run.nextStep + 1} of ${run.totalSteps}: ${action}`;
  } else {
    runStatus.textContent = '';
  }
  runNext.hidden = run?.confirmationStep === run?.nextStep;
  runConfirm.hidden = run?.confirmationStep !== run?.nextStep;
  runLog.replaceChildren();
  for (const entry of run?.logs ?? []) {
    const item = document.createElement('li');
    item.textContent = `Step ${entry.step}: ${entry.status} — ${entry.detail}`;
    runLog.append(item);
  }
}

function defaultName(recording: Recording): string {
  const hostname = new URL(recording.actions[0]!.url).hostname;
  const domain = hostname.split('.').at(-2) ?? hostname;
  return `${domain.replace(/[^a-z0-9]+/g, '-')}-task`;
}

async function render() {
  const [recording, stored] = await Promise.all([
    browser.runtime.sendMessage({ type: 'get-recording' }) as Promise<Recording | null>,
    browser.storage.local.get('skillDraft'),
  ]);
  start.disabled = !!recording?.active;
  stop.disabled = !recording?.active;
  status.textContent = recording?.active ? 'Recording' : recording ? 'Saved locally' : 'Ready';
  count.textContent = String(recording?.actions.length ?? 0);
  timeline.replaceChildren();
  for (const action of recording?.actions ?? []) {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = action.kind === 'input' ? `${action.inputKind} input (value omitted)` : action.kind === 'key' ? 'press Enter' : action.kind;
    const detail = document.createElement('span');
    detail.textContent = action.selector ?? action.url;
    const time = document.createElement('time');
    time.textContent = new Date(action.at).toLocaleTimeString();
    item.append(label, detail, time);
    timeline.append(item);
  }
  skillSection.hidden = !!recording?.active || (!currentDraft && (!recording || recording.actions.length === 0) && !stored.skillDraft);
  if (recording && recording.id !== shownRecordingId) {
    shownRecordingId = recording.id;
    if (!currentDraft && recording.actions.length) {
      skillName.value = defaultName(recording);
      skillDescription.value = `Repeat the demonstrated task on ${new URL(recording.actions[0]!.url).hostname} with new inputs.`;
    }
  }
  if (!currentDraft && stored.skillDraft) showDraft(stored.skillDraft as SkillDraft);
  await renderRun();
}

async function execute(type: 'start-recording' | 'stop-recording') {
  error.textContent = '';
  notice.textContent = '';
  start.disabled = true;
  stop.disabled = true;
  try {
    await browser.runtime.sendMessage({ type });
    await render();
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    await render();
  }
}

start.addEventListener('click', () => { void execute('start-recording'); });
stop.addEventListener('click', () => { void execute('stop-recording'); });
generate.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    try {
      const recording = await browser.runtime.sendMessage({ type: 'get-recording' }) as Recording | null;
      if (!recording) throw new Error('Record a task first.');
      const draft: SkillDraft = {
        sourceRecordingId: recording.id,
        name: skillName.value.trim(),
        description: skillDescription.value.trim(),
        markdown: createSkillMarkdown(recording, skillName.value.trim(), skillDescription.value.trim()),
      };
      await browser.storage.local.set({ skillDraft: draft });
      showDraft(draft);
      skillSection.hidden = false;
      await renderRun();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  })();
});
skillMarkdown.addEventListener('input', persistDraft);
skillName.addEventListener('input', persistDraft);
skillDescription.addEventListener('input', persistDraft);
runStart.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    try {
      const parameters: Record<string, string | boolean> = {};
      for (const definition of parameterDefinitions) {
        const input = runParameters.querySelector<HTMLInputElement>(`[data-parameter="${definition.name}"]`)!;
        parameters[definition.name] = definition.type === 'boolean' ? input.checked : input.value;
      }
      await browser.runtime.sendMessage({ type: 'start-run', markdown: skillMarkdown.value, parameters,
        remoteSkillId: currentDraft?.remoteSkillId });
      await renderRun();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  })();
});
async function runAction(type: 'run-next-step' | 'stop-run', confirm = false) {
  error.textContent = '';
  try {
    await browser.runtime.sendMessage({ type, confirm });
    await renderRun();
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}
runNext.addEventListener('click', () => { void runAction('run-next-step'); });
runConfirm.addEventListener('click', () => { void runAction('run-next-step', true); });
runStop.addEventListener('click', () => { void runAction('stop-run'); });
download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([skillMarkdown.value], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'SKILL.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
accountForm.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    error.textContent = '';
    try {
      await browser.runtime.sendMessage({ type: 'account-login', email: accountEmail.value, password: accountPassword.value });
      accountPassword.value = '';
      await renderAccount();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  })();
});
accountLogout.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    try { await browser.runtime.sendMessage({ type: 'account-logout' }); await renderAccount(); }
    catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  })();
});
libraryRefresh.addEventListener('click', () => {
  void refreshLibrary().catch(cause => { error.textContent = cause instanceof Error ? cause.message : String(cause); });
});
libraryLoad.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    try {
      const loaded = await browser.runtime.sendMessage({ type: 'library-load', id: librarySkills.value }) as
        { id: string; name: string; description: string; markdown: string; ownerId: string };
      const draft: SkillDraft = { sourceRecordingId: `library:${loaded.id}`, remoteSkillId: loaded.id,
        name: loaded.name, description: loaded.description, markdown: loaded.markdown,
        readOnly: loaded.ownerId !== signedInUser?.id };
      await browser.storage.local.set({ skillDraft: draft });
      showDraft(draft);
      skillSection.hidden = false;
      await renderRun();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  })();
});
saveLibrary.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    notice.textContent = '';
    try {
      const saved = await browser.runtime.sendMessage({ type: 'library-save',
        name: skillName.value.trim(), description: skillDescription.value.trim(), markdown: skillMarkdown.value,
        remoteSkillId: currentDraft?.remoteSkillId }) as { id: string; currentVersion: number };
      const draft: SkillDraft = { sourceRecordingId: currentDraft?.sourceRecordingId ?? 'library',
        remoteSkillId: saved.id, name: skillName.value.trim(), description: skillDescription.value.trim(),
        markdown: skillMarkdown.value };
      await browser.storage.local.set({ skillDraft: draft });
      showDraft(draft);
      await refreshLibrary();
      notice.textContent = `Saved to library as version ${saved.currentVersion}.`;
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  })();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.recording) void render();
  else if (changes.runState) void renderRun();
});
void render().then(renderAccount).catch(cause => { error.textContent = cause instanceof Error ? cause.message : String(cause); });
