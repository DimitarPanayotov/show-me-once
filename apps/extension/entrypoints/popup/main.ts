import { browser } from 'wxt/browser';
import { createSkillMarkdown, type Recording } from '@show-me-once/shared';
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
type SkillDraft = { sourceRecordingId: string; name: string; description: string; markdown: string };
let shownRecordingId: string | null = null;

function showDraft(draft: SkillDraft | null) {
  draftSection.hidden = !draft;
  if (!draft) return;
  skillName.value = draft.name;
  skillDescription.value = draft.description;
  skillMarkdown.value = draft.markdown;
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
    label.textContent = action.kind === 'input' ? `${action.inputKind} input (value omitted)` : action.kind;
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
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  })();
});
skillMarkdown.addEventListener('input', () => {
  if (!shownRecordingId) return;
  void browser.storage.local.set({ skillDraft: {
    sourceRecordingId: shownRecordingId,
    name: skillName.value.trim(),
    description: skillDescription.value.trim(),
    markdown: skillMarkdown.value,
  } satisfies SkillDraft });
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([skillMarkdown.value], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'SKILL.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.recording) void render(); });
void render();
