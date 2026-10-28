import { browser } from "wxt/browser";
import {
  createSkillMarkdown,
  parseSkillPlan,
  readSkillMetadata,
  writeSkillMetadata,
  validateSkillMetadata,
  editSkillDocument,
  checkedSkillDocument,
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
import {
  containsSecret,
  DEFAULT_AGENT_MODELS,
  type AgentProviderId,
} from "@show-me-once/shared/agent";
import { zipSync, strToU8 } from "fflate";
import { mcpInstallation, type McpAgent } from '../../lib/mcp-install';
import {
  keepLocalDraft,
  localSkillId,
  EXAMPLE_ID,
  EXAMPLE_START_URL,
  EXAMPLE_REQUEST,
  EXAMPLE_STEP_LABELS,
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
let approvalToken: string | undefined;
let approving = false;
let mcpConnected = false;
let mcpPendingId: string | undefined;
let catalogSize = 0;
let runStarting = false;
let runAfterSignIn = false;
let requestKey = "";
let taskRequests: Record<string, string> = {};
let agentSettings: {
  provider: AgentProviderId;
  model: string;
  hasKey: boolean;
} = { provider: "codex-local", model: "", hasKey: false };
let subscriptionReady = false;
let agentSettingsDirty = false;
const taskRequest = element<HTMLTextAreaElement>("task-request");
function builtin(draft: SkillDraft | null) {
  return draft?.sourceRecordingId === EXAMPLE_ID && !draft.remoteSkillId;
}

function renderExecution() {
  const ready =
    agentSettings.provider === "codex-local"
      ? subscriptionReady
      : agentSettings.hasKey;
  element("execution-status").textContent = agentSettingsDirty
    ? "Save your agent settings before running."
    : !ready
      ? agentSettings.provider === "codex-local"
        ? "Set up or check your subscription under Agent settings."
        : "Add your API key under Agent settings."
      : !signedInUser
        ? "Sign in to save this skill and its run history."
        : agentSettings.provider === "codex-local"
          ? "Ready · your Codex subscription. No coding-agent chat needed."
          : "Ready · your API key. Steps run automatically.";
  const button = element<HTMLButtonElement>("run-start");
  button.textContent = runStarting
    ? "Starting…"
    : agentSettingsDirty
      ? "Save agent settings"
      : !ready
        ? "Set up agent"
        : !signedInUser
          ? "Sign in to run"
          : "Run";
  button.disabled =
    saving ||
    runStarting ||
    !!activeRun?.active ||
    !currentDraft ||
    !planValid ||
    !taskRequest.value.trim();
  taskRequest.disabled = runStarting || !!activeRun?.active;
  if (runStarting) {
    for (const control of [
      start,
      libraryLoad,
      librarySkills,
      skillName,
      skillDescription,
      skillMarkdown,
    ])
      control.disabled = true;
    element<HTMLButtonElement>("generate").disabled = true;
  }
  element<HTMLButtonElement>("open-task-page").disabled =
    runStarting || !!activeRun?.active;
  for (const id of [
    "agent-provider",
    "agent-api-key",
    "agent-model",
    "save-agent-settings",
    "forget-api-key",
    "check-subscription",
  ])
    element<HTMLInputElement>(id).disabled = runStarting || !!activeRun?.active;
}

async function refreshAgentSettings() {
  agentSettings = (await browser.runtime.sendMessage({
    type: "agent-status",
  })) as typeof agentSettings;
  agentSettingsDirty = false;
  element<HTMLSelectElement>("agent-provider").value = agentSettings.provider;
  setValue(element<HTMLInputElement>("agent-model"), agentSettings.model);
  element<HTMLInputElement>("agent-api-key").placeholder = agentSettings.hasKey
    ? "Key set for this Chrome session"
    : "Paste your API key";
  element("subscription-extension-id").textContent = browser.runtime.id;
  renderAgentFields();
  renderExecution();
}

function renderAgentFields() {
  const provider = element<HTMLSelectElement>("agent-provider").value;
  element("subscription-settings").hidden = provider !== "codex-local";
  element("api-settings").hidden = provider === "codex-local";
}

async function checkSubscription() {
  element("subscription-status").textContent = "Checking your subscription…";
  try {
    const status = (await browser.runtime.sendMessage({
      type: "agent-check-native",
    })) as { ready: boolean };
    subscriptionReady = status.ready;
    element("subscription-status").textContent = status.ready
      ? "✓ Ready. Chrome will start your subscription agent when you click Run."
      : "Codex is not signed in. Sign in with ChatGPT, then check again.";
  } catch {
    subscriptionReady = false;
    element("subscription-status").textContent =
      "Subscription helper unavailable. Install it once using the steps above, then check again.";
  }
  renderExecution();
}

async function startExtensionRun() {
  if (runStarting || activeRun?.active || !currentDraft) return;
  element("run-error").textContent = "";
  const request = taskRequest.value.trim();
  if (!request || request.length > 2000 || containsSecret(request)) {
    element("run-error").textContent =
      "Describe the task without passwords or secrets.";
    return;
  }
  if (
    agentSettingsDirty ||
    (agentSettings.provider === "codex-local"
      ? !subscriptionReady
      : !agentSettings.hasKey)
  ) {
    element<HTMLDetailsElement>("execution-settings").open = true;
    element("execution-settings").scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    return;
  }
  if (!signedInUser) {
    runAfterSignIn = true;
    openAccount();
    return;
  }
  runStarting = true;
  const startingMarkdown = currentDraft.markdown;
  renderExecution();
  try {
    if (agentSettings.provider === "codex-local") {
      subscriptionReady = false;
      const status = (await browser.runtime.sendMessage({
        type: "agent-check-native",
      })) as { ready: boolean };
      subscriptionReady = status.ready;
      if (!status.ready)
        throw new Error(
          "Sign in to Codex with ChatGPT, then check your subscription under Agent settings.",
        );
    }
    if (currentDraft.markdown !== startingMarkdown)
      throw new Error("The selected skill changed. Review it and start again.");
    if (!currentDraft.remoteSkillId || currentDraft.dirty) {
      if (!(await saveDraft(true)))
        throw new Error("Save the skill successfully before running it.");
    }
    const draft = currentDraft!;
    await browser.runtime.sendMessage({
      type: "start-run",
      engine: "agent",
      mode: "automatic",
      provider: agentSettings.provider,
      taskRequest: request,
      markdown: draft.markdown,
      remoteSkillId: draft.remoteSkillId,
      skillKey: draft.remoteSkillId ?? draft.sourceRecordingId,
      parameters: {},
    });
    await render();
  } catch (cause) {
    element("run-error").textContent =
      cause instanceof Error ? cause.message : "Could not start this run.";
  } finally {
    runStarting = false;
    await render();
    renderExecution();
  }
}

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
  try {
    const metadata = readSkillMetadata(markdown);
    validateSkillMetadata(metadata);
    if (!currentDraft?.readOnly && (metadata.name !== currentDraft?.name || metadata.description !== currentDraft?.description))
      throw new Error('Name and description must match the SKILL.md header. Edit either field to sync it.');
    element("metadata-error").textContent = "";
    parseSkillPlan(markdown);
    planValid = true;
  } catch (cause) {
    planValid = false;
    element("metadata-error").textContent = cause instanceof Error ? cause.message : 'Check the skill document.';
  }
  element<HTMLButtonElement>("download").disabled = !planValid;
  element<HTMLButtonElement>("download-mcp").disabled = !planValid;
}
function renderHandoff() {
  const nextKey = currentDraft?.sourceRecordingId ?? "";
  if (requestKey !== nextKey) {
    requestKey = nextKey;
    taskRequest.value =
      taskRequests[nextKey] ??
      (currentDraft?.sourceRecordingId === EXAMPLE_ID
        ? "Find open issues in microsoft/vscode about terminal with label bug. Sort by recently updated and open the first matching issue."
        : "");
  }
  const request = currentDraft
    ? builtin(currentDraft)
      ? EXAMPLE_REQUEST
      : "Use Show Me Once to run skill " +
        localSkillId(currentDraft) +
        " (" +
        JSON.stringify(currentDraft.name) +
        "). Ask me for the new inputs you need."
    : "";
  setValue(element<HTMLTextAreaElement>("agent-request"), request);
  element("copy-request").textContent = builtin(currentDraft)
    ? "Open GitHub & copy triage request"
    : "Copy agent request";
  element<HTMLButtonElement>("copy-request").disabled =
    !currentDraft ||
    !mcpConnected ||
    !!activeRun?.active ||
    runStarting ||
    !planValid;
  element<HTMLButtonElement>("try-example").disabled =
    saving || runStarting || !!activeRun?.active || !!currentRecording?.active;
  element("handoff-help").textContent = mcpConnected
    ? "Open the task's starting page, then paste this request into your coding agent. It can read the skill directly."
    : "Connect your coding agent above first. Your skill stays here.";
  let url: string | undefined;
  try {
    const start = currentDraft
      ? parseSkillPlan(currentDraft.markdown).steps[0]?.url
      : undefined;
    if (currentDraft?.sourceRecordingId === EXAMPLE_ID) url = EXAMPLE_START_URL;
    else if (start && !start.includes("…")) url = start;
    element("starting-page").textContent = start
      ? "Starting page: " + (url ?? start)
      : "";
  } catch {
    /* Invalid Markdown stays editable. */
  }
  const open = element<HTMLButtonElement>("open-start-page");
  open.hidden = !url || currentDraft?.sourceRecordingId === EXAMPLE_ID;
  open.disabled = !!activeRun?.active || !!currentRecording?.active;
  open.dataset.url = url;
  element("run-starting-page").textContent =
    element("starting-page").textContent;
  element<HTMLButtonElement>("open-task-page").hidden = !url;
  element("open-task-page").dataset.url = url;
  renderExecution();
}

function showDraft(draft: SkillDraft | null) {
  currentDraft = draft;
  if (!draft) {
    planValid = false;
    return;
  }
  setValue(skillName, draft.name);
  setValue(skillDescription, draft.description);
  setValue(skillMarkdown, draft.markdown);
  element("current-name").textContent = draft.name;
  element("current-description").textContent = draft.description;
  element("current-meta").textContent = builtin(draft)
    ? "Example skill"
    : draft.readOnly
      ? "Shared skill"
      : draft.remoteSkillId
        ? draft.dirty
          ? "Draft · unsaved changes"
          : "Saved skill"
        : "New skill · not saved yet";
  element("draft-label").textContent = builtin(draft)
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
  saveLibrary.hidden = builtin(currentDraft);
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
    : currentDraft?.remoteSkillId && currentDraft.dirty
      ? "Unsaved changes. Save changes to update your library."
      : "";
  for (const control of [skillName, skillDescription, skillMarkdown])
    control.disabled = saving || !!activeRun?.active || runStarting || !!currentDraft?.readOnly;
  if (saving) {
    start.disabled = true;
    element<HTMLButtonElement>("run-start").disabled = true;
    element<HTMLButtonElement>("try-example").disabled = true;
    libraryLoad.disabled = librarySkills.disabled = true;
    element<HTMLButtonElement>("generate").disabled = true;
  }
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
  libraryLoad.disabled =
    !!activeRun?.active || runStarting || result.skills.length === 0;
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
  element("account-toggle").textContent = signedInUser ? "Account" : "Sign in";
  accountForm.hidden = !!signedInUser;
  element("account-logout").hidden = !signedInUser;
  element("library-controls").hidden =
    !!activeRun?.active || (!currentDraft && catalogSize <= 1);
  element("sign-in-prompt").hidden = !!signedInUser;
  await refreshLibrary();
  renderSave();
  renderExecution();
}

async function refreshMcp() {
  const status = (await browser.runtime.sendMessage({
    type: "mcp-status",
  })) as { paired: boolean; connected: boolean; enabled?: boolean; pending?: { id: string; code: string }; error?: string; runError?: string };
  mcpConnected = status.connected;
  mcpPendingId = status.pending?.id;
  element('mcp-run-error').textContent = status.runError ?? '';
  const feedback = element("mcp-status");
  feedback.dataset.state = status.connected
    ? "connected"
    : status.pending ? "approval"
    : status.paired
      ? "unavailable"
      : "disconnected";
  feedback.textContent = status.connected
    ? "✓ Connected to your coding agent"
    : status.pending ? "Connection approval needed — compare the code below."
    : status.error ? status.error
    : status.paired
      ? "Waiting for your coding agent. Open it to reconnect automatically."
      : "Waiting for your agent. Add Show Me Once below, then ask it to list your skills.";
  element("mcp-disconnect").hidden = !status.paired && !status.pending && !status.enabled;
  element('mcp-disconnect').textContent = status.paired ? 'Forget connection' : 'Cancel connection';
  element("mcp-check").hidden = status.connected || !!status.pending;
  element("mcp-pair-form").hidden = status.paired || !!status.pending;
  element("mcp-approval").hidden = !status.pending;
  element("mcp-pairing-code").textContent = status.pending?.code ?? '';
  element<HTMLButtonElement>('mcp-approve').disabled = !!activeRun?.active || !!currentRecording?.active || element('mcp-approve').dataset.busy === 'true';
  element("mcp-connected-help").hidden = !status.connected;
  element("mcp-settings-summary").textContent = status.paired
    ? "Connection settings"
    : "Connect your coding agent";
  element("connection-heading").textContent = status.paired
    ? "Your coding agent"
    : "Connect your coding agent";
  renderHandoff();
}

function renderMcpInstallation() {
  const installation = mcpInstallation(element<HTMLSelectElement>('mcp-agent').value as McpAgent, webApp.href);
  const link = element<HTMLAnchorElement>('mcp-install-link');
  link.hidden = !installation.link;
  if (installation.link) link.href = installation.link;
  link.textContent = installation.label;
  const command = element<HTMLTextAreaElement>('mcp-install-command');
  command.hidden = !installation.command; command.value = installation.command ?? '';
  element('mcp-copy-command').hidden = !installation.command;
  element('mcp-copy-command').textContent = installation.label;
}

function renderRun(
  run: RunState | null,
  plan: SkillPlan | undefined,
  pending?: PendingConfirmation,
) {
  activeRun = run;
  if (run?.active && run.engine === "external")
    element("current-meta").textContent = "Running with your coding agent";
  else if (run?.active)
    element("current-meta").textContent = "Running in this extension";
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
  element("external-handoff").hidden = !currentDraft || active;
  element("external-agent-details").hidden = active;
  element("execution-settings").hidden = active;
  skillName.disabled =
    skillDescription.disabled =
    skillMarkdown.disabled =
      active || runStarting || saving || !!currentDraft?.readOnly;
  element<HTMLButtonElement>("generate").disabled =
    active || runStarting || saving || !!currentDraft?.readOnly;
  libraryLoad.disabled =
    active || runStarting || saving || librarySkills.options.length === 0;
  librarySkills.disabled = active || saving || librarySkills.options.length === 0;
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
          : "Agent is running";
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
    const exampleStep =
      currentDraft?.sourceRecordingId === EXAMPLE_ID
        ? EXAMPLE_STEP_LABELS[run.nextStep]
        : undefined;
    element("run-status").textContent =
      `Step ${run.nextStep + 1}: ${copy ? "Waiting for your approval" : run.thinking ? "Agent is choosing a safe action…" : waiting ? "Waiting for navigation…" : (exampleStep ?? (upcoming?.kind === "navigation" ? "Checking the page" : upcoming?.kind === "input" ? "Filling the supplied input" : upcoming?.kind === "key" ? "Pressing Enter" : "Clicking the target"))}`;
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
  start.disabled = !!run?.active || runStarting || saving;
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

function persistDraft(event: Event) {
  if (!currentDraft || currentDraft.readOnly || saving) return;
  ++renderRevision;
  const input = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
  const field = input === skillName ? "name" : input === skillDescription ? "description" : "markdown";
  const draft: SkillDraft = {
    ...editSkillDocument(currentDraft, field, input.value),
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
async function saveDraft(copyExample = false): Promise<SkillDraft | undefined> {
  if (!signedInUser) {
    saveAfterSignIn = true;
    openAccount();
    return;
  }
  if (saving || !currentDraft) return;
  if (currentDraft.readOnly && !(copyExample && builtin(currentDraft))) return;
  saving = true;
  element("save-error").textContent = "";
  renderSave();
  try {
    const snapshot = checkedSkillDocument(currentDraft);
    const saved = (await browser.runtime.sendMessage({
      type: "library-save",
      name: snapshot.name,
      description: snapshot.description,
      markdown: snapshot.markdown,
      remoteSkillId: snapshot.remoteSkillId,
    })) as { id: string; currentVersion: number };
    const draft: SkillDraft = {
      ...snapshot,
      remoteSkillId: saved.id,
      savedVersion: saved.currentVersion,
      dirty: false,
      readOnly: false,
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
    return draft;
  } catch (cause) {
    element("save-error").textContent =
      cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
    renderSave();
    await render();
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
    const name = readSkillMetadata(markdown).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,64);
    if (!name)
      throw new Error(
        "The SKILL.md frontmatter needs a lowercase name with hyphens.",
      );
    const archive = zipSync({
      [`.agents/skills/${name}/SKILL.md`]: strToU8(markdown),
      "INSTALL.md": strToU8(
        `Extract this ZIP in the workspace where you use Codex. The folder must be .agents/skills/${name}/SKILL.md. This export is optional: a connected Show Me Once agent can discover and read your skills directly with list_skills and get_skill.\n\nConnect under External coding agent in the extension. Choose your agent, add its MCP connection, compare the six-digit code and Allow once. The coding agent starts the connector automatically; no ID, pairing secret or helper terminal is needed. Reload/reconnect the client and verify /mcp and the skill selector. Invoke $${name} explicitly to verify discovery before relying on automatic matching.\n\nSetup: https://github.com/DimitarPanayotov/show-me-once/blob/main/docs/mcp.md\n`,
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
element("mcp-approve").addEventListener("click", () => {
  void (async () => {
    const button = element<HTMLButtonElement>("mcp-approve");
    button.disabled = true;
    button.dataset.busy = "true";
    element("mcp-status").textContent = "Connecting to your coding agent…";
    try {
      await browser.runtime.sendMessage({
        type: "mcp-approve",
        pairingId: mcpPendingId,
      });
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
      await browser.runtime.sendMessage({ type: "mcp-begin" });
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
element('mcp-reject').addEventListener('click', () => {
  void browser.runtime.sendMessage({ type: 'mcp-disconnect' }).then(refreshMcp).catch(report);
});
element('mcp-agent').addEventListener('change', () => {
  renderMcpInstallation();
  element('mcp-install-notice').textContent = '';
  void browser.storage.local.set({ mcpAgent: element<HTMLSelectElement>('mcp-agent').value });
});
element('mcp-copy-command').addEventListener('click', () => {
  void (async () => {
    await navigator.clipboard.writeText(element<HTMLTextAreaElement>('mcp-install-command').value);
    element('mcp-install-notice').textContent = element<HTMLSelectElement>('mcp-agent').value === 'other'
      ? 'Configuration copied. Add it in your MCP client, then ask it to use Show Me Once.'
      : 'Command copied. Run it once in a terminal, then ask your agent to use Show Me Once.';
    await browser.runtime.sendMessage({ type: 'mcp-begin' }); await refreshMcp();
  })().catch(report);
});
element('mcp-install-link').addEventListener('click', () => {
  element('mcp-install-notice').textContent = 'Approve installation in your editor, then ask its agent to use Show Me Once.';
  void browser.runtime.sendMessage({ type: 'mcp-begin' }).then(refreshMcp).catch(report);
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
      if (runAfterSignIn) {
        runAfterSignIn = false;
        await startExtensionRun();
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
      taskRequests = {};
      taskRequest.value = "";
      await browser.storage.session.remove("taskRequests");
      await refreshAgentSettings();
      renderExecution();
    } catch (cause) {
      report(cause);
    }
  })();
});
element("library-refresh").addEventListener("click", () => {
  void refreshLibrary().catch(report);
});
async function repairSavedMetadata() {
  const stored = await browser.storage.local.get(["skillDraft", "runState"]);
  const draft = stored.skillDraft as SkillDraft | undefined;
  if (!draft || draft.readOnly || (stored.runState as RunState | undefined)?.active) return;
  try {
    // Existing versions stay immutable. Repair only the editable local copy.
    readSkillMetadata(draft.markdown);
    validateSkillMetadata(draft);
    const markdown = writeSkillMetadata(draft.markdown, draft);
    if (markdown !== draft.markdown)
      await browser.storage.local.set({ skillDraft: { ...draft, markdown, dirty: true } });
  } catch { /* Incomplete documents stay editable. */ }
}

async function openSkill(skillId: string) {
  await browser.runtime.sendMessage({ type: "mcp-open-skill", skillId });
  await repairSavedMetadata();
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
      if (currentDraft?.sourceRecordingId === EXAMPLE_ID)
        return browser.tabs.create({ url: EXAMPLE_START_URL });
    })
    .catch(report);
});
element("try-example").addEventListener("click", () => {
  void (async () => {
    await openSkill(EXAMPLE_ID);
    await browser.tabs.create({ url: EXAMPLE_START_URL });
  })().catch(report);
});
element("run-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void startExtensionRun();
});
taskRequest.addEventListener("input", () => {
  if (!containsSecret(taskRequest.value)) {
    taskRequests[requestKey] = taskRequest.value;
    void browser.storage.session.set({ taskRequests });
  }
  element("run-error").textContent = "";
  renderExecution();
});
element("open-task-page").addEventListener("click", () => {
  const url = element("open-task-page").dataset.url;
  if (url && url !== "undefined")
    void browser.tabs.create({ url }).catch(report);
});
element("agent-provider").addEventListener("change", () => {
  agentSettingsDirty = true;
  const provider = element<HTMLSelectElement>("agent-provider").value;
  setValue(
    element<HTMLInputElement>("agent-model"),
    provider === "openai" || provider === "anthropic"
      ? DEFAULT_AGENT_MODELS[provider]
      : "",
  );
  element<HTMLInputElement>("agent-api-key").value = "";
  element("agent-settings-notice").textContent =
    "Save agent settings to apply this choice.";
  renderAgentFields();
  renderExecution();
});
for (const id of ["agent-api-key", "agent-model"])
  element(id).addEventListener("input", () => {
    agentSettingsDirty = true;
    renderExecution();
  });
element("save-agent-settings").addEventListener("click", () => {
  void (async () => {
    try {
      const apiKey = element<HTMLInputElement>("agent-api-key").value.trim();
      await browser.runtime.sendMessage({
        type: "agent-configure",
        provider: element<HTMLSelectElement>("agent-provider").value,
        model: element<HTMLInputElement>("agent-model").value,
        ...(apiKey ? { apiKey } : {}),
      });
      element<HTMLInputElement>("agent-api-key").value = "";
      await refreshAgentSettings();
      element("agent-settings-notice").textContent = "✓ Agent settings saved.";
    } catch (cause) {
      element("agent-settings-notice").textContent =
        cause instanceof Error
          ? cause.message
          : "Could not save agent settings.";
    }
  })();
});
element("forget-api-key").addEventListener("click", () => {
  void browser.runtime
    .sendMessage({ type: "agent-forget-key" })
    .then(refreshAgentSettings)
    .catch(report);
});
element("check-subscription").addEventListener("click", () => {
  void checkSubscription();
});
element("subscription-copy-id").addEventListener("click", () => {
  void navigator.clipboard
    .writeText(browser.runtime.id)
    .then(() => {
      element("subscription-status").textContent =
        "✓ Extension ID copied. Paste it into the subscription setup.";
    })
    .catch(report);
});
element("open-start-page").addEventListener("click", () => {
  const url = element("open-start-page").dataset.url;
  if (url) void browser.tabs.create({ url }).catch(report);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.recording || changes.skillDraft || changes.runState)
  )
    void render();
  if (area === "session" && changes.runConfirmation) void render();
  if (area === "session" && (changes.mcpConnected || changes.mcpConnectionChanged || changes.mcpLastError))
    void refreshMcp().catch(report);
});
void (async () => {
  taskRequests =
    ((await browser.storage.session.get("taskRequests")).taskRequests as
      | Record<string, string>
      | undefined) ?? {};
  const saved = await browser.storage.local.get([
    "popupView",
    "skillDraft",
    "runState",
    "recording",
    "mcpAgent",
  ]);
  if (['codex', 'claude-code', 'cursor', 'vscode', 'other'].includes(saved.mcpAgent as string))
    element<HTMLSelectElement>('mcp-agent').value = saved.mcpAgent as string;
  renderMcpInstallation();
  const previous = saved.skillDraft as SkillDraft | undefined;
  if (
    previous?.sourceRecordingId === "example:wikipedia-search" &&
    previous.readOnly &&
    !previous.dirty &&
    !(saved.runState as RunState | undefined)?.active &&
    !(saved.recording as Recording | undefined)?.active
  )
    await browser.runtime.sendMessage({
      type: "mcp-open-skill",
      skillId: EXAMPLE_ID,
    });
  view = saved.popupView === "record" ? "record" : "run";
  await repairSavedMetadata();
  await render();
  await refreshMcp();
  await refreshAgentSettings();
  try {
    await renderAccount();
  } catch (cause) {
    report(cause);
  }
  document.documentElement.dataset.ready = "true";
  if (agentSettings.provider === "codex-local") void checkSubscription();
  void browser.runtime.sendMessage({ type: "get-run" }).catch(() => undefined);
})().catch(report);
setInterval(() => {
  if (element<HTMLDetailsElement>('external-agent-details').open)
    void refreshMcp().catch(() => {});
}, 2000);
