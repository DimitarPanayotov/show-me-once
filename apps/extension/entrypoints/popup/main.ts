import { browser } from "wxt/browser";
import {
  createSkillMarkdown,
  parseSkillPlan,
  type Recording,
  type RunState,
  type SkillParameter,
  type SkillPlan,
} from "@show-me-once/shared";
import "./style.css";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const start = element<HTMLButtonElement>("start");
const stop = element<HTMLButtonElement>("stop");
const error = element<HTMLParagraphElement>("error");
const notice = element<HTMLParagraphElement>("notice");
const skillSection = element<HTMLElement>("skill-section");
const skillName = element<HTMLInputElement>("skill-name");
const skillDescription = element<HTMLInputElement>("skill-description");
const skillMarkdown = element<HTMLTextAreaElement>("skill-markdown");
const saveLibrary = element<HTMLButtonElement>("save-library");
const runParameters = element<HTMLElement>("run-parameters");
const runMode = element<HTMLSelectElement>("run-mode");
const runStart = element<HTMLButtonElement>("run-start");
const runControls = element<HTMLElement>("run-controls");
const runNext = element<HTMLButtonElement>("run-next");
const runConfirm = element<HTMLButtonElement>("run-confirm");
const runPause = element<HTMLButtonElement>("run-pause");
const runResume = element<HTMLButtonElement>("run-resume");
const runStop = element<HTMLButtonElement>("run-stop");
const librarySkills = element<HTMLSelectElement>("library-skills");
const libraryLoad = element<HTMLButtonElement>("library-load");
const accountForm = element<HTMLFormElement>("account-form");
const accountEmail = element<HTMLInputElement>("account-email");
const accountPassword = element<HTMLInputElement>("account-password");
const webApp = element<HTMLAnchorElement>("web-app");
webApp.href = import.meta.env.WXT_API_BASE_URL || "http://localhost:3000";

type SkillDraft = {
  sourceRecordingId: string;
  name: string;
  description: string;
  markdown: string;
  remoteSkillId?: string;
  readOnly?: boolean;
  savedVersion?: number;
  dirty?: boolean;
};
let currentDraft: SkillDraft | null = null;
let currentRecording: Recording | null = null;
let signedInUser: { id: string; email: string } | null = null;
let parameterDefinitions: SkillParameter[] = [];
let planValid = false;
let view: "run" | "record" = "run";
let saving = false;
let starting = false;
let saveAfterSignIn = false;
let renderRevision = 0;
let activeRun: RunState | null = null;
let lastMarkdown = "";

function report(cause: unknown) {
  error.textContent = cause instanceof Error ? cause.message : String(cause);
}
function setValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  if (input.value !== value) input.value = value;
}

function openAccount(open = true) {
  element("account-section").hidden = !open;
  element("account-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    element("account-section").scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    if (!signedInUser) accountEmail.focus();
  }
}

function changeView(next: "run" | "record") {
  view = next;
  void browser.storage.local.set({ popupView: view });
  void render();
}

function goRun() {
  element<HTMLDetailsElement>("run-editor-details").open = false;
  changeView("run");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showParameters(markdown: string) {
  if (lastMarkdown === markdown) return;
  lastMarkdown = markdown;
  const previous = new Map(
    [...runParameters.querySelectorAll<HTMLInputElement>("input")].map(
      (input) => [
        input.dataset.parameter,
        input.type === "checkbox" ? input.checked : input.value,
      ],
    ),
  );
  runParameters.replaceChildren();
  try {
    parameterDefinitions = parseSkillPlan(markdown).parameters;
    planValid = true;
    for (const definition of parameterDefinitions) {
      const label = document.createElement("label");
      const kind = definition.name.split("_")[0];
      const title =
        kind === "search"
          ? "Search term"
          : kind === "target"
            ? "Target to click"
            : definition.type === "boolean"
              ? "Selected state"
              : "Text to enter";
      label.textContent = `${title}${parameterDefinitions.length > 1 ? ` (${definition.name})` : ""}`;
      const input = document.createElement("input");
      input.dataset.parameter = definition.name;
      input.type = definition.type === "boolean" ? "checkbox" : "text";
      input.autocomplete = "off";
      input.placeholder = "Enter a new value";
      const existing = previous.get(definition.name);
      if (typeof existing === "boolean") input.checked = existing;
      else if (typeof existing === "string") input.value = existing;
      label.append(input);
      runParameters.append(label);
    }
  } catch {
    parameterDefinitions = [];
    planValid = false;
  }
}

function showDraft(draft: SkillDraft | null) {
  if (
    (draft?.remoteSkillId ?? draft?.sourceRecordingId) !==
    (currentDraft?.remoteSkillId ?? currentDraft?.sourceRecordingId)
  ) {
    lastMarkdown = "";
    runParameters.replaceChildren();
  }
  currentDraft = draft;
  if (!draft) {
    lastMarkdown = "";
    planValid = false;
    runParameters.replaceChildren();
    return;
  }
  setValue(skillName, draft.name);
  setValue(skillDescription, draft.description);
  setValue(skillMarkdown, draft.markdown);
  element("current-name").textContent = draft.name;
  element("current-description").textContent = draft.description;
  element("current-meta").textContent = draft.readOnly
    ? "Shared skill"
    : draft.remoteSkillId
      ? draft.dirty
        ? "Draft · unsaved changes"
        : "Saved skill"
      : "New skill · not saved yet";
  element("draft-label").textContent = draft.readOnly
    ? "Read only"
    : draft.remoteSkillId && !draft.dirty
      ? "Saved"
      : "Draft";
  element("draft-label").classList.toggle(
    "saved",
    !!draft.remoteSkillId && !draft.dirty,
  );
  showParameters(draft.markdown);
  renderSave();
}

function renderSave() {
  const saved = !!currentDraft?.savedVersion && !currentDraft.dirty;
  saveLibrary.disabled =
    saving ||
    saved ||
    !!activeRun?.active ||
    !planValid ||
    !!currentDraft?.readOnly;
  saveLibrary.dataset.saved = String(saved);
  saveLibrary.dataset.busy = String(saving);
  saveLibrary.textContent = saving
    ? "Saving…"
    : saved
      ? "✓ Saved to library"
      : !signedInUser
        ? "Sign in to save"
        : currentDraft?.remoteSkillId
          ? "Save changes"
          : "Save to library";
  notice.textContent = saved
    ? `Saved to your library · version ${currentDraft!.savedVersion}.`
    : "";
  element("save-run").hidden = !saved || view === "run";
  element("try-skill").hidden = view === "run" || saved;
}

async function refreshLibrary() {
  if (!signedInUser) return;
  const selected = currentDraft?.remoteSkillId ?? librarySkills.value;
  const skills = (await browser.runtime.sendMessage({
    type: "library-list",
  })) as {
    id: string;
    title: string;
    ownerId: string;
    currentVersion: number;
  }[];
  librarySkills.replaceChildren();
  for (const skill of skills) {
    const option = document.createElement("option");
    option.value = skill.id;
    option.textContent = `${skill.title} · v${skill.currentVersion}${skill.ownerId === signedInUser.id ? "" : " · shared"}`;
    librarySkills.append(option);
  }
  if (skills.some((skill) => skill.id === selected))
    librarySkills.value = selected;
  libraryLoad.disabled = skills.length === 0 || !!activeRun?.active;
  librarySkills.disabled = skills.length === 0 || !!activeRun?.active;
  element("library-empty").hidden = skills.length > 0;
}

async function renderAccount() {
  signedInUser = (await browser.runtime.sendMessage({
    type: "account-status",
  })) as typeof signedInUser;
  element("account-status").textContent = signedInUser
    ? `Signed in as ${signedInUser.email}`
    : "Sign in to save skills and access your library.";
  element("account-toggle").textContent = signedInUser ? "Account" : "Sign in";
  accountForm.hidden = !!signedInUser;
  element("account-logout").hidden = !signedInUser;
  element("library-controls").hidden = !signedInUser || !!activeRun?.active;
  element("sign-in-prompt").hidden = !!signedInUser;
  if (signedInUser) await refreshLibrary();
  renderSave();
}

function renderRun(run: RunState | null, plan: SkillPlan | undefined) {
  activeRun = run;
  const active = !!run?.active;
  element("library-controls").hidden = !signedInUser || active;
  element("current-description").hidden = active;
  const relevant =
    active ||
    (!!run &&
      run.skillKey ===
        (currentDraft?.remoteSkillId ?? currentDraft?.sourceRecordingId));
  element("run-panel").hidden = !currentDraft;
  element("run-empty").hidden = !!currentDraft;
  element("run-setup").hidden = active;
  runControls.hidden = !active;
  element("run-editor-details").hidden = active;
  runStart.disabled =
    starting || active || !!currentRecording?.active || !planValid;
  runStart.dataset.busy = String(starting);
  runStart.textContent = starting
    ? "Starting…"
    : runMode.value === "manual"
      ? "Start step-by-step run"
      : "Run skill";
  for (const input of runParameters.querySelectorAll("input"))
    input.disabled = active;
  skillName.disabled =
    skillDescription.disabled =
    skillMarkdown.disabled =
      active || !!currentDraft?.readOnly;
  element<HTMLButtonElement>("generate").disabled =
    active || !!currentDraft?.readOnly;
  libraryLoad.disabled = active || librarySkills.options.length === 0;
  librarySkills.disabled = active || librarySkills.options.length === 0;
  if (active && run) {
    const confirmation = run.confirmationStep === run.nextStep;
    const blocked = run.pauseReason === "blocked";
    const paused = run.pauseReason === "user";
    const manual = run.mode !== "automatic";
    const upcoming = plan?.steps[run.nextStep];
    const waiting =
      upcoming?.kind === "navigation" &&
      run.awaitingNavigation &&
      !run.navigationObserved;
    element("run-state-label").textContent = confirmation
      ? "Confirmation needed"
      : blocked
        ? "Check the page"
        : paused
          ? "Paused"
          : manual
            ? "Ready for your next step"
            : "Running automatically";
    element("run-step-count").textContent =
      `${run.nextStep} / ${run.totalSteps}`;
    runControls.dataset.state = confirmation
      ? "confirmation"
      : blocked
        ? "blocked"
        : paused
          ? "paused"
          : "running";
    const progress = element<HTMLProgressElement>("run-progress");
    progress.max = run.totalSteps;
    progress.value = run.nextStep;
    element("run-status").textContent =
      `Step ${run.nextStep + 1}: ${waiting ? "Waiting for navigation…" : upcoming?.kind === "navigation" ? "Checking the page" : upcoming?.kind === "input" ? "Filling the supplied input" : upcoming?.kind === "key" ? "Pressing Enter" : "Clicking the target"}`;
    element("run-context").textContent = confirmation
      ? "Review the action on the page. Confirming will continue this run."
      : blocked
        ? (run.logs.at(-1)?.detail ?? "Check the target page, then retry.")
        : paused
          ? "Nothing else will execute until you resume."
          : manual
            ? "Advance one action at a time."
            : "You can close this popup. We will pause when we need you.";
    runNext.hidden = !manual || confirmation;
    runConfirm.hidden = !confirmation;
    runConfirm.textContent = manual
      ? "Confirm this action"
      : "Confirm & continue";
    runPause.hidden = manual || !!run.pauseReason;
    runResume.hidden = manual || !run.pauseReason || confirmation;
    runResume.textContent = blocked ? "Retry step" : "Resume run";
  }
  const summary = element("run-summary");
  summary.hidden = !run || active || !relevant || run.logs.length === 0;
  if (run && !active && relevant) {
    const complete = run.nextStep === run.totalSteps;
    summary.textContent = complete
      ? `✓ Completed all ${run.totalSteps} steps.`
      : `Run stopped · ${run.nextStep} of ${run.totalSteps} steps completed.`;
  }
  element("run-log-details").hidden = !relevant || !run?.logs.length;
  element("run-log-count").textContent = String(run?.logs.length ?? 0);
  const list = element<HTMLOListElement>("run-log");
  list.replaceChildren();
  if (relevant)
    for (const entry of run?.logs ?? []) {
      const item = document.createElement("li");
      item.dataset.status = entry.status;
      item.textContent = `Step ${entry.step}: ${entry.status} — ${entry.detail}`;
      list.append(item);
    }
  renderSave();
}

async function render() {
  const revision = ++renderRevision;
  const stored = await browser.storage.local.get([
    "recording",
    "skillDraft",
    "runState",
    "runPlan",
  ]);
  if (revision !== renderRevision) return;
  currentRecording = (stored.recording as Recording | undefined) ?? null;
  const run = (stored.runState as RunState | undefined) ?? null;
  showDraft((stored.skillDraft as SkillDraft | undefined) ?? null);
  if (currentRecording?.active) view = "record";
  else if (run?.active) view = "run";
  element("view-run").hidden = view !== "run";
  element("view-record").hidden = view !== "record";
  element("tab-run").setAttribute("aria-selected", String(view === "run"));
  element("tab-record").setAttribute(
    "aria-selected",
    String(view === "record"),
  );
  element("tab-run").tabIndex = view === "run" ? 0 : -1;
  element("tab-record").tabIndex = view === "record" ? 0 : -1;
  const recording = !!currentRecording?.active;
  const review =
    !recording &&
    !!currentRecording &&
    currentDraft?.sourceRecordingId === currentRecording.id;
  element("record-intro").hidden = recording || review;
  element("record-footer").hidden = !review;
  element("privacy-note").hidden = review;
  (review ? element("record-footer") : element("record-start-slot")).append(
    start,
  );
  start.hidden = recording;
  start.disabled = !!run?.active;
  start.textContent = review ? "Record another task" : "Start recording";
  start.className = `button ${review ? "quiet" : "primary"} full`;
  element("record-active").hidden = !recording;
  element("record-heading").textContent = review
    ? "Recording complete."
    : "Show us once.";
  element("record-description").textContent = review
    ? "Review the name below, then save your reusable skill."
    : "Open the task's starting page, then record yourself doing it.";
  element("status").textContent = recording
    ? "Recording in your browser"
    : run?.active
      ? run.pauseReason
        ? "Run needs your attention"
        : "A skill is running"
      : "Teach it once. Run it again.";
  const count = currentRecording?.actions.length ?? 0;
  element("record-count").textContent =
    `${count} action${count === 1 ? "" : "s"} captured`;
  element("count").textContent = String(count);
  element("record-timeline").hidden = count === 0;
  const timeline = element<HTMLOListElement>("timeline");
  timeline.replaceChildren();
  for (const action of currentRecording?.actions ?? []) {
    const item = document.createElement("li"),
      label = document.createElement("strong"),
      detail = document.createElement("span"),
      time = document.createElement("time");
    label.textContent =
      action.kind === "input"
        ? `${action.inputKind} input · value omitted`
        : action.kind === "key"
          ? "Press Enter"
          : action.kind;
    detail.textContent = action.selector ?? action.url;
    time.textContent = new Date(action.at).toLocaleTimeString();
    item.append(label, detail, time);
    timeline.append(item);
  }
  (view === "record"
    ? element("record-review-slot")
    : element("run-editor-slot")
  ).append(skillSection);
  skillSection.hidden =
    !currentDraft || recording || (view === "record" && !review);
  element("editor-title").textContent =
    view === "record" ? "Your skill is ready" : "Skill details";
  element("generate").hidden = !review || !!currentDraft?.readOnly;
  renderRun(run, stored.runPlan as SkillPlan | undefined);
}

function persistDraft() {
  if (!currentDraft || currentDraft.readOnly) return;
  const draft: SkillDraft = {
    ...currentDraft,
    name: skillName.value.trim(),
    description: skillDescription.value.trim(),
    markdown: skillMarkdown.value,
    dirty: true,
  };
  element("save-error").textContent = "";
  showDraft(draft);
  void browser.storage.local.set({ skillDraft: draft });
}

async function createDraft(recording: Recording) {
  const hostname = new URL(recording.actions[0]!.url).hostname;
  const domain =
    hostname === "localhost" || /^[\d.]+$/.test(hostname)
      ? "browser"
      : (hostname.split(".").at(-2) ?? hostname);
  const name = `${domain}-task`.replace(/[^a-z0-9-]/g, "-");
  const description = `Repeat this task on ${hostname} with new inputs.`;
  const draft: SkillDraft = {
    sourceRecordingId: recording.id,
    name,
    description,
    markdown: createSkillMarkdown(recording, name, description),
    dirty: true,
  };
  await browser.storage.local.set({ skillDraft: draft });
  await render();
}

async function saveDraft() {
  if (!signedInUser) {
    saveAfterSignIn = true;
    openAccount();
    return;
  }
  if (saving || !currentDraft) return;
  saving = true;
  element("save-error").textContent = "";
  renderSave();
  try {
    const saved = (await browser.runtime.sendMessage({
      type: "library-save",
      name: skillName.value.trim(),
      description: skillDescription.value.trim(),
      markdown: skillMarkdown.value,
      remoteSkillId: currentDraft.remoteSkillId,
    })) as { id: string; currentVersion: number };
    const draft: SkillDraft = {
      ...currentDraft,
      name: skillName.value.trim(),
      description: skillDescription.value.trim(),
      markdown: skillMarkdown.value,
      remoteSkillId: saved.id,
      savedVersion: saved.currentVersion,
      dirty: false,
    };
    showDraft(draft);
    await browser.storage.local.set({ skillDraft: draft });
    // Show success at the action immediately; refreshing the picker is a separate request.
    saving = false;
    renderSave();
    try {
      await refreshLibrary();
    } catch {
      /* The save has already succeeded. */
    }
  } catch (cause) {
    element("save-error").textContent =
      cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
    renderSave();
  }
}

element("tab-run").addEventListener("click", () => changeView("run"));
element("tab-record").addEventListener("click", () => changeView("record"));
element("empty-record").addEventListener("click", () => changeView("record"));
for (const tab of [element("tab-run"), element("tab-record")])
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = view === "run" ? "record" : "run";
    changeView(next);
    element(`tab-${next}`).focus();
  });
element("account-toggle").addEventListener("click", () =>
  openAccount(element("account-section").hidden),
);
element("account-close").addEventListener("click", () => openAccount(false));
element("sign-in-prompt").addEventListener("click", () => openAccount());
start.addEventListener("click", () => {
  void (async () => {
    error.textContent = "";
    start.disabled = true;
    try {
      await browser.runtime.sendMessage({ type: "start-recording" });
      view = "record";
      await render();
    } catch (cause) {
      report(cause);
      start.disabled = false;
    }
  })();
});
stop.addEventListener("click", () => {
  void (async () => {
    error.textContent = "";
    stop.disabled = true;
    try {
      const recording = (await browser.runtime.sendMessage({
        type: "stop-recording",
      })) as Recording;
      await createDraft(recording);
    } catch (cause) {
      report(cause);
    } finally {
      stop.disabled = false;
    }
  })();
});
element("generate").addEventListener("click", () => {
  void (async () => {
    try {
      if (!currentRecording) throw new Error("Record a task first.");
      const draft: SkillDraft = {
        sourceRecordingId: currentRecording.id,
        name: skillName.value.trim(),
        description: skillDescription.value.trim(),
        markdown: createSkillMarkdown(
          currentRecording,
          skillName.value.trim(),
          skillDescription.value.trim(),
        ),
        dirty: true,
      };
      await browser.storage.local.set({ skillDraft: draft });
      await render();
    } catch (cause) {
      report(cause);
    }
  })();
});
for (const input of [skillName, skillDescription, skillMarkdown])
  input.addEventListener("input", persistDraft);
saveLibrary.addEventListener("click", () => {
  void saveDraft();
});
element("try-skill").addEventListener("click", goRun);
element("save-run").addEventListener("click", goRun);
runMode.addEventListener("change", () => {
  void browser.storage.local.set({ runMode: runMode.value });
  element("run-help").textContent =
    runMode.value === "manual"
      ? "You choose when each step executes."
      : "Runs all steps and pauses when it needs your confirmation.";
  renderRun(activeRun, undefined);
});
runStart.addEventListener("click", () => {
  void (async () => {
    if (starting) return;
    starting = true;
    error.textContent = "";
    renderRun(activeRun, undefined);
    try {
      const parameters: Record<string, string | boolean> = {};
      for (const definition of parameterDefinitions) {
        const input = runParameters.querySelector<HTMLInputElement>(
          `[data-parameter="${definition.name}"]`,
        )!;
        parameters[definition.name] =
          definition.type === "boolean" ? input.checked : input.value;
      }
      await browser.runtime.sendMessage({
        type: "start-run",
        markdown: skillMarkdown.value,
        parameters,
        mode: runMode.value,
        remoteSkillId: currentDraft?.dirty
          ? undefined
          : currentDraft?.remoteSkillId,
        skillKey:
          currentDraft?.remoteSkillId ?? currentDraft?.sourceRecordingId,
      });
      await render();
    } catch (cause) {
      report(cause);
    } finally {
      starting = false;
      await render();
    }
  })();
});
async function runAction(type: string, confirm = false) {
  error.textContent = "";
  try {
    await browser.runtime.sendMessage({ type, confirm });
    await render();
  } catch (cause) {
    report(cause);
  }
}
runNext.addEventListener("click", () => {
  void runAction("run-next-step");
});
runConfirm.addEventListener("click", () => {
  void runAction("run-next-step", true);
});
runPause.addEventListener("click", () => {
  void runAction("pause-run");
});
runResume.addEventListener("click", () => {
  void runAction("resume-run");
});
runStop.addEventListener("click", () => {
  runStop.disabled = true;
  void runAction("stop-run").finally(() => {
    runStop.disabled = false;
  });
});
element("download").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([skillMarkdown.value], { type: "text/markdown" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "SKILL.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const button = element<HTMLButtonElement>("account-login");
    button.disabled = true;
    button.dataset.busy = "true";
    error.textContent = "";
    try {
      await browser.runtime.sendMessage({
        type: "account-login",
        email: accountEmail.value,
        password: accountPassword.value,
      });
      accountPassword.value = "";
      await renderAccount();
      openAccount(false);
      if (saveAfterSignIn) {
        saveAfterSignIn = false;
        await saveDraft();
      }
    } catch (cause) {
      report(cause);
    } finally {
      button.disabled = false;
      button.dataset.busy = "false";
    }
  })();
});
element("account-logout").addEventListener("click", () => {
  void (async () => {
    try {
      await browser.runtime.sendMessage({ type: "account-logout" });
      await renderAccount();
    } catch (cause) {
      report(cause);
    }
  })();
});
element("library-refresh").addEventListener("click", () => {
  void refreshLibrary().catch(report);
});
libraryLoad.addEventListener("click", () => {
  void (async () => {
    libraryLoad.disabled = true;
    libraryLoad.dataset.busy = "true";
    error.textContent = "";
    try {
      const loaded = (await browser.runtime.sendMessage({
        type: "library-load",
        id: librarySkills.value,
      })) as {
        id: string;
        name: string;
        description: string;
        markdown: string;
        ownerId: string;
        currentVersion: number;
      };
      const draft: SkillDraft = {
        sourceRecordingId: `library:${loaded.id}`,
        remoteSkillId: loaded.id,
        name: loaded.name,
        description: loaded.description,
        markdown: loaded.markdown,
        readOnly: loaded.ownerId !== signedInUser?.id,
        savedVersion: loaded.currentVersion,
        dirty: false,
      };
      lastMarkdown = "";
      await browser.storage.local.set({ skillDraft: draft });
      goRun();
      await render();
    } catch (cause) {
      report(cause);
    } finally {
      libraryLoad.dataset.busy = "false";
      libraryLoad.disabled =
        !!activeRun?.active || librarySkills.options.length === 0;
    }
  })();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.recording || changes.skillDraft || changes.runState)
  )
    void render();
});
void (async () => {
  const saved = await browser.storage.local.get(["popupView", "runMode"]);
  view = saved.popupView === "record" ? "record" : "run";
  runMode.value = saved.runMode === "manual" ? "manual" : "automatic";
  await render();
  try {
    await renderAccount();
  } catch (cause) {
    report(cause);
  }
  document.documentElement.dataset.ready = "true";
  void browser.runtime.sendMessage({ type: "get-run" }).catch(() => undefined);
})().catch(report);
