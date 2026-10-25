import { browser } from 'wxt/browser';
import type { Recording } from '@show-me-once/shared';
import './style.css';

const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLElement>('#status')!;
const error = document.querySelector<HTMLElement>('#error')!;
const timeline = document.querySelector<HTMLOListElement>('#timeline')!;
const count = document.querySelector<HTMLElement>('#count')!;

async function render() {
  const recording = await browser.runtime.sendMessage({ type: 'get-recording' }) as Recording | null;
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
browser.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void render(); });
void render();
