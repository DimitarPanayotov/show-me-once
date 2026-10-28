import { browser } from "wxt/browser";
import {
  createSkillMarkdown,
  parseSkillPlan,
  type Recording,
  type RunState,
  type SkillPlan,
} from "@show-me-once/shared";
import {
  confirmationCopy,
  isPendingConfirmation,
  type PendingConfirmation,
} from "../../lib/confirmation";
import "./style.css";
import { withMcpInstructions } from "@show-me-once/shared/mcp";
import { zipSync, strToU8 } from "fflate";
import {
  keepLocalDraft,
  localSkillId,
  EXAMPLE_ID,
  type CatalogDraft,
} from "../../lib/skill-catalog";

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
const runControls = element<HTMLElement>("run-controls");
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
let planValid = false;
let view: "run" | "record" = "run";
let saving = false;
let saveAfterSignIn = false;
let renderRevision = 0;
let activeRun: RunState | null = null;
let lastMarkdown = "";
let approvalToken: string | undefined;
let approving = false;
let mcpConnected = false;
let catalogSize = 0;

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
  try {
    parseSkillPlan(markdown);
    planValid = true;
  } catch {
    planValid = false;
  }
}
function renderHandoff() {
  const request = currentDraft
    ? currentDraft.sourceRecordingId === EXAMPLE_ID
      ? "Use Show Me Once to run the Wikipedia search example for Grace Hopper. Ask me to approve the search in the extension."
      : "Use Show Me Once to run skill " +
        localSkillId(currentDraft) +
        " (" +
        JSON.stringify(currentDraft.name) +
        "). Ask me for the new inputs you need."
    : "";
  setValue(element<HTMLTextAreaElement>("agent-request"), request);
  element<HTMLButtonElement>("copy-request").disabled =
    !currentDraft || !mcpConnected || !!activeRun?.active || !planValid;
  element<HTMLButtonElement>("try-example").disabled =
    !mcpConnected || !!activeRun?.active || !!currentRecording?.active;
  element("handoff-help").textContent = mcpConnected
    ? "Open the task's starting page, then paste this request into your coding agent. It can read the skill directly."
    : "Connect your coding agent above first. Your skill stays here.";
  let url: string | undefined;
  try {
    const start = currentDraft
      ? parseSkillPlan(currentDraft.markdown).steps[0]?.url
      : undefined;
    if (start && !start.includes("…")) url = start;
    element("starting-page").textContent = start
      ? "Starting page: " + start
      : "";
  } catch {
    /* Invalid Markdown stays editable. */
  }
  const open = element<HTMLButtonElement>("open-start-page");
  open.hidden = !url;
  open.disabled = !!activeRun?.active || !!currentRecording?.active;
  open.dataset.url = url;
}

function showDraft(draft: SkillDraft | null) {
  if (
    (draft?.remoteSkillId ?? draft?.sourceRecordingId) !==
    (currentDraft?.remoteSkillId ?? currentDraft?.sourceRecordingId)
  ) {
    lastMarkdown = "";
  }
  currentDraft = draft;
  if (!draft) {
    lastMarkdown = "";
    planValid = false;
    return;
  }
  setValue(skillName, draft.name);
  setValue(skillDescription, draft.description);
  setValue(skillMarkdown, draft.markdown);
  element("current-name").textContent = draft.name;
  element("current-description").textContent = draft.description;
  element("current-meta").textContent =
    draft.sourceRecordingId === EXAMPLE_ID
      ? "Example skill"
      : draft.readOnly
        ? "Shared skill"
        : draft.remoteSkillId
          ? draft.dirty
            ? "Draft · unsaved changes"
            : "Saved skill"
          : "New skill · not saved yet";
  element("draft-label").textContent =
    draft.sourceRecordingId === EXAMPLE_ID
      ? "Example"
      : draft.readOnly
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
  saveLibrary.hidden = currentDraft?.sourceRecordingId === EXAMPLE_ID;
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
  element("try-skill").hidden = view === "run";
}

async function refreshLibrary() {
  const selected = currentDraft
    ? localSkillId(currentDraft)
    : librarySkills.value;
  const result = (await browser.runtime.sendMessage({
    type: "mcp-skills",
  })) as {
    skills: { id: string; name: string; source: string }[];
    message?: string;
  };
  catalogSize = result.skills.length;
  element("library-controls").hidden =
    !!activeRun?.active || (!currentDraft && catalogSize <= 1);
  librarySkills.replaceChildren();
  for (const skill of result.skills) {
    const option = document.createElement("option");
    option.value = skill.id;
    option.textContent =
      skill.name +
      (skill.source === "example"
        ? " · example"
        : skill.source === "library"
          ? " · library"
          : " · local");
    librarySkills.append(option);
  }
  if (result.skills.some((s) => s.id === selected))
    librarySkills.value = selected;
  libraryLoad.disabled = !!activeRun?.active || result.skills.length === 0;
  librarySkills.disabled = libraryLoad.disabled;
  element("library-empty").textContent = result.message ?? "";
  element("library-empty").hidden = !result.message;
}
async function renderAccount() {
  signedInUser = (await browser.runtime.sendMessage({
    type: "account-status",
  })) as typeof signedInUser;
  element("account-status").textContent = signedInUser
    ? `Signed in as ${signedInUser.email}`
    : "Sign in to save skills and access your library.";
  element("account-toggle").textContent = signedInUser ? "Account" : "Library";
  accountForm.hidden = !!signedInUser;
  element("account-logout").hidden = !signedInUser;
  element("library-controls").hidden =
    !!activeRun?.active || (!currentDraft && catalogSize <= 1);
  element("sign-in-prompt").hidden = !!signedInUser;
  await refreshLibrary();
  renderSave();
}

async function refreshMcp() {
  const status = (await browser.runtime.sendMessage({
    type: "mcp-status",
  })) as { paired: boolean; connected: boolean };
  mcpConnected = status.connected;
  const feedback = element("mcp-status");
  feedback.dataset.state = status.connected
    ? "connected"
    : status.paired
      ? "unavailable"
      : "disconnected";
  feedback.textContent = status.connected
    ? "✓ Connected to your coding agent"
    : status.paired
      ? "Waiting for your coding agent. Open it to reconnect automatically."
      : "Connect once to run skills from your coding agent.";
  element("mcp-disconnect").hidden = !status.paired;
  element("mcp-check").hidden = !status.paired;
  element("mcp-pair-form").hidden = status.paired;
  element("mcp-connected-help").hidden = !status.connected;
  element("mcp-settings-summary").textContent = status.paired
    ? "Connection settings"
    : "Connect your coding agent";
  element("mcp-extension-id").textContent = browser.runtime.id;
  element("connection-heading").textContent = status.paired
    ? "Your coding agent"
    : "1. Connect your coding agent";
  renderHandoff();
}

function renderRun(
  run: RunState | null,
  plan: SkillPlan | undefined,
  pending?: PendingConfirmation,
) {
  activeRun = run;
  if (run?.active && run.engine === "external")
    element("current-meta").textContent = "Running with your coding agent";
  approvalToken = undefined;
  element("run-confirmation").hidden = true;
  const active = !!run?.active;
  element("library-controls").hidden =
    active || (!currentDraft && catalogSize <= 1);
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
    const preview =
      confirmation && isPendingConfirmation(pending, run.id, run.nextStep)
        ? pending.details
        : undefined;
    const copy = preview
      ? confirmationCopy(preview, run.mode === "automatic")
      : undefined;
    approvalToken = preview?.token;
    if (copy && preview) {
      element("run-confirmation").hidden = false;
      element("confirmation-title").textContent = copy.title;
      element("confirmation-target").textContent = copy.target;
      element("confirmation-effect").textContent = copy.effect;
      element("confirmation-destination").hidden = !copy.destination;
      element("confirmation-destination").textContent = copy.destination;
      element("confirmation-changed").hidden = !preview.changed;
    }
    const blocked = run.pauseReason === "blocked";
    const paused = run.pauseReason === "user";
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
          : "Your agent is running";
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
      `Step ${run.nextStep + 1}: ${copy ? "Waiting for your approval" : run.thinking ? "Agent is choosing a safe action…" : waiting ? "Waiting for navigation…" : upcoming?.kind === "navigation" ? "Checking the page" : upcoming?.kind === "input" ? "Filling the supplied input" : upcoming?.kind === "key" ? "Pressing Enter" : "Clicking the target"}`;
    element("run-context").textContent = confirmation
      ? (copy?.continuation ??
        "Preparing the action preview. Approval is unavailable until it is ready.")
      : blocked
        ? (run.logs.at(-1)?.detail ?? "Check the target page, then retry.")
        : paused
          ? "Nothing else will execute until you resume."
          : "You can close this popup. Your agent continues and pauses for approval.";
    runConfirm.hidden = !confirmation;
    runConfirm.disabled = !preview || approving;
    runConfirm.textContent = approving
      ? "Approving…"
      : (copy?.button ?? "Preparing preview…");
    runPause.hidden = !!run.pauseReason;
    runResume.hidden = !run.pauseReason || confirmation;
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
  renderHandoff();
}

async function render() {
  const revision = ++renderRevision;
  const [stored, session] = await Promise.all([
    browser.storage.local.get([
      "recording",
      "skillDraft",
      "runState",
      "runPlan",
    ]),
    browser.storage.session.get(["runConfirmation", "agentError"]),
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
  const startSlot = review
    ? element("record-footer")
    : element("record-start-slot");
  if (start.parentElement !== startSlot) startSlot.append(start);
  start.hidden = recording;
  start.disabled = !!run?.active;
  start.textContent = review ? "Record another task" : "Start recording";
  start.className = `button ${review ? "quiet" : "primary"} full`;
  element("record-active").hidden = !recording;
  element("record-heading").textContent = review
    ? "Recording complete."
    : "Show us once.";
  element("record-description").textContent = review
    ? "Your agent can use this skill now. Saving to your shared library is optional."
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
  const editorSlot =
    view === "record"
      ? element("record-review-slot")
      : element("run-editor-slot");
  if (skillSection.parentElement !== editorSlot)
    editorSlot.append(skillSection);
  skillSection.hidden =
    !currentDraft || recording || (view === "record" && !review);
  element("editor-title").textContent =
    view === "record" ? "Your skill is ready" : "Skill details";
  element("generate").hidden = !review || !!currentDraft?.readOnly;
  renderRun(
    run,
    stored.runPlan as SkillPlan | undefined,
    session.runConfirmation as PendingConfirmation | undefined,
  );
  const agentError = session.agentError as
    | { runId?: string; message?: string }
    | undefined;
  if (
    run?.active &&
    run.pauseReason === "blocked" &&
    agentError?.runId === run.id
  )
    element("run-context").textContent =
      agentError.message ?? "Check the agent connection and retry.";
}

function persistDraft() {
  if (!currentDraft || currentDraft.readOnly) return;
  ++renderRevision;
  const draft: SkillDraft = {
    ...currentDraft,
    name: skillName.value,
    description: skillDescription.value,
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
  const stored = await browser.storage.local.get(["skillDraft", "localSkills"]);
  await browser.storage.local.set({
    skillDraft: draft,
    localSkills: keepLocalDraft(
      (stored.localSkills as CatalogDraft[] | undefined) ?? [],
      stored.skillDraft as CatalogDraft | undefined,
    ),
  });
  await render();
  await refreshLibrary();
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
async function runAction(type: string, confirm = false) {
  error.textContent = "";
  const token = approvalToken;
  if (confirm) {
    approving = true;
    runConfirm.disabled = true;
    runConfirm.textContent = "Approving…";
  }
  try {
    await browser.runtime.sendMessage({
      type,
      confirm,
      ...(confirm ? { approvalToken: token } : {}),
    });
    await render();
  } catch (cause) {
    report(cause);
  } finally {
    if (confirm) {
      approving = false;
      await render();
    }
  }
}
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
element("download-mcp").addEventListener("click", () => {
  try {
    const markdown = withMcpInstructions(skillMarkdown.value);
    const name = /^name:\s*([a-z0-9-]{1,64})\s*$/m.exec(markdown)?.[1];
    if (!name)
      throw new Error(
        "The SKILL.md frontmatter needs a lowercase name with hyphens.",
      );
    const archive = zipSync({
      [`.agents/skills/${name}/SKILL.md`]: strToU8(markdown),
      "INSTALL.md": strToU8(
        `Extract this ZIP in the workspace where you use Codex. The folder must be .agents/skills/${name}/SKILL.md. This export is optional: a connected Show Me Once agent can discover and read your skills directly with list_skills and get_skill.\n\nCodex MCP command: codex mcp add show_me_once -- node C:/absolute/path/to/mcp/server.mjs\nRun setup.mjs with your extension ID once, register the MCP server and pair under Connect your coding agent. The coding agent starts the connector automatically; no helper terminal is needed. Reload/reconnect the client and verify /mcp and the skill selector. Invoke $${name} explicitly to verify discovery before relying on automatic matching.\n\nSetup: https://github.com/DimitarPanayotov/show-me-once/blob/main/docs/mcp.md\n`,
      ),
    });
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(archive)], { type: "application/zip" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-agent-skill.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) {
    report(cause);
  }
});
element("mcp-pair").addEventListener("click", () => {
  void (async () => {
    const button = element<HTMLButtonElement>("mcp-pair");
    button.disabled = true;
    button.dataset.busy = "true";
    element("mcp-status").textContent = "Connecting to your coding agent…";
    try {
      await browser.runtime.sendMessage({
        type: "mcp-pair",
        token: element<HTMLInputElement>("mcp-code").value.trim(),
      });
      element<HTMLInputElement>("mcp-code").value = "";
      await refreshMcp();
      element<HTMLDetailsElement>("mcp-settings").open = false;
    } catch (cause) {
      element("mcp-status").textContent =
        cause instanceof Error ? cause.message : String(cause);
      element("mcp-status").dataset.state = "error";
    } finally {
      button.disabled = false;
      button.dataset.busy = "false";
    }
  })();
});
element("mcp-check").addEventListener("click", () => {
  void (async () => {
    const button = element<HTMLButtonElement>("mcp-check");
    button.disabled = true;
    element("mcp-status").textContent =
      "Checking your coding-agent connection…";
    try {
      await browser.runtime.sendMessage({ type: "mcp-connect" });
      await refreshMcp();
    } catch (cause) {
      element("mcp-status").textContent =
        cause instanceof Error
          ? cause.message
          : "Waiting for your coding agent. Open it, then check again.";
      element("mcp-status").dataset.state = "unavailable";
    } finally {
      button.disabled = false;
    }
  })();
});

element("mcp-disconnect").addEventListener("click", () => {
  void browser.runtime
    .sendMessage({ type: "mcp-disconnect" })
    .then(refreshMcp)
    .catch(report);
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
async function openSkill(skillId: string) {
  await browser.runtime.sendMessage({ type: "mcp-open-skill", skillId });
  goRun();
  await render();
  await refreshLibrary();
}
libraryLoad.addEventListener("click", () => {
  void openSkill(librarySkills.value).catch(report);
});
element("copy-request").addEventListener("click", () => {
  void navigator.clipboard
    .writeText(element<HTMLTextAreaElement>("agent-request").value)
    .then(() => {
      element("handoff-notice").textContent =
        "✓ Request copied. Paste it into your coding agent.";
    })
    .catch(report);
});
element("try-example").addEventListener("click", () => {
  void (async () => {
    await openSkill(EXAMPLE_ID);
    await navigator.clipboard.writeText(
      element<HTMLTextAreaElement>("agent-request").value,
    );
    await browser.tabs.create({ url: "https://www.wikipedia.org/" });
  })().catch(report);
});
element("open-start-page").addEventListener("click", () => {
  const url = element("open-start-page").dataset.url;
  if (url) void browser.tabs.create({ url }).catch(report);
});
element("mcp-copy-id").addEventListener("click", () => {
  void navigator.clipboard
    .writeText(browser.runtime.id)
    .then(() => {
      element("mcp-copy-id").textContent = "Copied";
    })
    .catch(report);
});
element("mcp-guide").addEventListener("click", () => {
  void browser.tabs
    .create({ url: browser.runtime.getURL("/setup.html") })
    .catch(report);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.recording || changes.skillDraft || changes.runState)
  )
    void render();
  if (area === "session" && changes.runConfirmation) void render();
  if (area === "session" && changes.mcpConnected)
    void refreshMcp().catch(report);
});
void (async () => {
  const saved = await browser.storage.local.get(["popupView"]);
  view = saved.popupView === "record" ? "record" : "run";
  await render();
  await refreshMcp();
  try {
    await renderAccount();
  } catch (cause) {
    report(cause);
  }
  document.documentElement.dataset.ready = "true";
  void browser.runtime.sendMessage({ type: "get-run" }).catch(() => undefined);
})().catch(report);
