import { browser } from 'wxt/browser';
import { createSkillMarkdown, parseSkillPlan, type Recording, type RunState, type SkillParameter, type SkillPlan } from '@show-me-once/shared';
import './style.css';

const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLElement>('#status')!;
const error = document.querySelector<HTMLElement>('#error')!;
const timeline = document.querySelector<HTMLOListElement>('#timeline')!;
const count = document.querySelector<HTMLElement>('#count')!;
const skillSection = document.querySelector<HTMLElement>('#skill-section')!;
const draftSection = document.querySelector<HTMLElement>('#draft-section')!;
const skillName = document.querySelector<HTMLInputElement>('#skill-name')!;
const skillDescription = document.querySelector<HTMLInputElement>('#skill-description')!;
const skillMarkdown = document.querySelector<HTMLTextAreaElement>('#skill-markdown')!;
const generate = document.querySelector<HTMLButtonElement>('#generate')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const runParameters = document.querySelector<HTMLElement>('#run-parameters')!;
const runStart = document.querySelector<HTMLButtonElement>('#run-start')!;
const runControls = document.querySelector<HTMLElement>('#run-controls')!;
const runStatus = document.querySelector<HTMLElement>('#run-status')!;
const runNext = document.querySelector<HTMLButtonElement>('#run-next')!;
const runConfirm = document.querySelector<HTMLButtonElement>('#run-confirm')!;
const runStop = document.querySelector<HTMLButtonElement>('#run-stop')!;
const runLog = document.querySelector<HTMLOListElement>('#run-log')!;
type SkillDraft = { sourceRecordingId: string; name: string; description: string; markdown: string };
let shownRecordingId: string | null = null;
let parameterDefinitions: SkillParameter[] = [];
let planValid = false;

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
  draftSection.hidden = !draft;
  if (!draft) return;
  skillName.value = draft.name;
  skillDescription.value = draft.description;
  skillMarkdown.value = draft.markdown;
  showParameters(draft.markdown);
}

async function renderRun() {
  const [run, stored] = await Promise.all([
    browser.runtime.sendMessage({ type: 'get-run' }) as Promise<RunState | null>,
    browser.storage.local.get('runPlan'),
  ]);
  runControls.hidden = !run?.active;
  runStart.disabled = !!run?.active || draftSection.hidden || !planValid;
  skillMarkdown.disabled = !!run?.active;
  generate.disabled = !!run?.active;
  if (run?.active) {
    const upcoming = (stored.runPlan as SkillPlan | undefined)?.steps[run.nextStep];
    const action = upcoming?.kind === 'navigation' ? `Check ${upcoming.url}`
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
  skillSection.hidden = !recording || recording.active || recording.actions.length === 0;
  if (recording && recording.id !== shownRecordingId) {
    shownRecordingId = recording.id;
    skillName.value = defaultName(recording);
    skillDescription.value = `Repeat the demonstrated task on ${new URL(recording.actions[0]!.url).hostname} with new inputs.`;
    const draft = stored.skillDraft as SkillDraft | undefined;
    showDraft(draft?.sourceRecordingId === recording.id ? draft : null);
  }
  await renderRun();
}

async function execute(type: 'start-recording' | 'stop-recording') {
  error.textContent = '';
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
      await renderRun();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  })();
});
skillMarkdown.addEventListener('input', () => {
  if (!shownRecordingId) return;
  showParameters(skillMarkdown.value);
  void browser.storage.local.set({ skillDraft: {
    sourceRecordingId: shownRecordingId,
    name: skillName.value.trim(),
    description: skillDescription.value.trim(),
    markdown: skillMarkdown.value,
  } satisfies SkillDraft });
});
runStart.addEventListener('click', () => {
  void (async () => {
    error.textContent = '';
    try {
      const parameters: Record<string, string | boolean> = {};
      for (const definition of parameterDefinitions) {
        const input = runParameters.querySelector<HTMLInputElement>(`[data-parameter="${definition.name}"]`)!;
        parameters[definition.name] = definition.type === 'boolean' ? input.checked : input.value;
      }
      await browser.runtime.sendMessage({ type: 'start-run', markdown: skillMarkdown.value, parameters });
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
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.recording) void render();
  else if (changes.runState) void renderRun();
});
void render();
