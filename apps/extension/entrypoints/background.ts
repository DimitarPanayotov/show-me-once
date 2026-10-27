import { browser } from "wxt/browser";
import {
  appendAction,
  parseSkillPlan,
  sanitizeUrl,
  sanitizedAction,
  type RecordedAction,
  type Recording,
  type RunState,
  type SkillPlan,
} from "@show-me-once/shared";
import { requestApi } from "../lib/api";
import { ExternalBridgeClient } from "../lib/external-bridge";
import type { ExternalResult } from "@show-me-once/shared/mcp";
import {
  ExternalRunController,
  externalDraft,
  type ExternalSession,
} from "../lib/external-run";
import {
  chooseAgentAction,
  pairLocalAgent,
  localAgentStatus,
} from "../lib/agent-client";
import {
  containsSecret,
  type AgentObservation,
  type AgentProviderId,
  type AgentDecision,
} from "@show-me-once/shared/agent";
import {
  isPendingConfirmation,
  type ConfirmationDetails,
  type PendingConfirmation,
} from "../lib/confirmation";
import {
  applyStepOutcome,
  canAutoAdvance,
  recoverInterruptedRun,
} from "../lib/run-state";

const STORAGE_KEY = "recording";
const AUTO_ALARM = "continue-skill-run";
const API_BASE = (
  import.meta.env.WXT_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
type Account = {
  token: string;
  user: { id: string; email: string; name: string | null };
};
let pending: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let tickQueued = false;
let interruption: "pause" | "stop" | undefined;
let controlRevision = 0;
let agentAbort: AbortController | undefined;
let mcp: ExternalBridgeClient;
let externalOwner:
  | { controllerId: string; bridgeId: string; runId: string }
  | undefined;
const interruptedControllers = new Set<string>();
const pendingExternalStarts = new Set<string>();
type AgentSession = {
  runId: string;
  markdown: string;
  request: string;
  provider: AgentProviderId;
  selected?: { step: number; observationId: string; targetId: string };
};

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}

async function read(): Promise<Recording | null> {
  return (
    ((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | Recording
      | undefined) ?? null
  );
}

async function save(recording: Recording): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: recording });
}

async function readRun(): Promise<RunState | null> {
  return (
    ((await browser.storage.local.get("runState")).runState as
      | RunState
      | undefined) ?? null
  );
}

async function saveRun(run: RunState): Promise<RunState> {
  if (!run.active || run.engine !== "external") externalOwner = undefined;
  await browser.storage.local.set({ runState: run });
  const paused =
    run.active && (!!run.pauseReason || run.confirmationStep === run.nextStep);
  await browser.action.setBadgeText({
    text: run.active ? (paused ? "!" : "RUN") : "",
  });
  await browser.action.setBadgeBackgroundColor({
    color: paused ? "#b45309" : "#2563eb",
  });
  await browser.action.setTitle({
    title: `Show Me Once${run.active ? (paused ? " — your attention is needed" : " — running") : ""}`,
  });
  return run;
}

async function readAccount(): Promise<Account | null> {
  return (
    ((await browser.storage.session.get("account")).account as
      | Account
      | undefined) ?? null
  );
}

async function api<T>(
  path: string,
  input: object,
  account?: Account | null,
): Promise<T> {
  return requestApi<T>(API_BASE, path, input, account?.token);
}

async function requiredAccount(): Promise<Account> {
  const account = await readAccount();
  if (!account) throw new Error("Sign in to the library first.");
  return account;
}

async function syncRunLogs(run: RunState): Promise<RunState> {
  if (!run.remoteRunId) return run;
  const account = await requiredAccount();
  let current = run;
  for (
    let index = run.remoteSyncedLogs ?? 0;
    index < run.logs.length;
    index++
  ) {
    const entry = run.logs[index]!;
    await api(
      "run/log",
      {
        runId: run.remoteRunId,
        stepNumber: entry.step,
        kind: entry.kind,
        status: entry.status,
      },
      account,
    );
    current = await saveRun({
      ...current,
      remoteSyncedLogs: index + 1,
      syncError: undefined,
    });
  }
  return current;
}

function append(
  recording: Recording,
  action: Omit<RecordedAction, "id" | "at">,
): Recording {
  return appendAction(
    recording,
    action,
    crypto.randomUUID(),
    new Date().toISOString(),
  );
}

async function ensureRecorder(tabId: number): Promise<void> {
  try {
    if (
      (await browser.tabs.sendMessage(tabId, { type: "recorder-ping" })) ===
      true
    )
      return;
  } catch {
    /* A tab opened before the extension was loaded needs its content script. */
  }
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["/content-scripts/content.js"],
  });
  if (
    (await browser.tabs.sendMessage(tabId, { type: "recorder-ping" })) !== true
  ) {
    throw new Error(
      "Could not connect to this page. Check its extension access.",
    );
  }
}

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

async function scheduleRun(run: RunState | null, delay = 450): Promise<void> {
  clearTimer();
  if (!canAutoAdvance(run) || interruption) {
    await browser.alarms.clear(AUTO_ALARM);
    return;
  }
  // The timer advances promptly; the alarm recovers persisted work if MV3 suspends the worker.
  if (!(await browser.alarms.get(AUTO_ALARM))) {
    await browser.alarms.create(AUTO_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5,
    });
  }
  timer = setTimeout(() => {
    timer = undefined;
    void automaticTick();
  }, delay);
}

async function performStep(
  confirmed = false,
  approvalToken?: string,
  previewOnly = false,
): Promise<RunState> {
  const run = await readRun();
  if (!run?.active) throw new Error("No active run.");
  if (interruption) return run;
  if (run.confirmationStep === run.nextStep && !confirmed && !previewOnly)
    return run;
  const { runPlan } = (await browser.storage.local.get("runPlan")) as {
    runPlan?: SkillPlan;
  };
  const step = runPlan?.steps[run.nextStep];
  if (!runPlan || !step) throw new Error("Run plan is unavailable.");
  const { runParameters, runConfirmation } = (await browser.storage.session.get(
    ["runParameters", "runConfirmation"],
  )) as {
    runParameters?: Record<string, string | boolean>;
    runConfirmation?: PendingConfirmation;
  };
  if (!runParameters)
    throw new Error("Run inputs expired. Stop and start the run again.");
  if (run.engine === "agent")
    await browser.storage.session.remove("agentError");
  const approved = confirmed && run.confirmationStep === run.nextStep;
  if (
    approved &&
    (!isPendingConfirmation(runConfirmation, run.id, run.nextStep) ||
      approvalToken !== runConfirmation.details.token)
  )
    throw new Error(
      "The action preview changed. Review it again before approving.",
    );
  const tab = await browser.tabs.get(run.tabId);
  if (tab.status === "loading") return run;
  const waiting =
    step.kind === "navigation" &&
    run.awaitingNavigation &&
    !run.navigationObserved;
  if (waiting && Date.now() - (run.navigationStartedAt ?? Date.now()) < 25000)
    return run;
  let status: "done" | "blocked" | "confirmation-required" = "blocked";
  let confirmation: PendingConfirmation | undefined;
  let detail = waiting
    ? "Navigation did not finish. Check the page, then retry."
    : "The page does not match the recorded checkpoint.";
  if (!waiting && (tab.url ? sanitizeUrl(tab.url) : null) === step.url) {
    await ensureRecorder(run.tabId);
    const pageSafety = (await browser.tabs.sendMessage(run.tabId, {
      type: "check-run-page",
    })) as { humanVerification?: boolean; connectionError?: boolean };
    if (pageSafety?.humanVerification) {
      detail =
        "Human verification is required. Complete it yourself on the page, then retry this step.";
    } else if (pageSafety?.connectionError) {
      detail =
        "The page could not load. Check its connection and reload it, then retry this step.";
    } else if (step.kind === "navigation") {
      status = "done";
      detail = "Navigation checkpoint matched.";
    } else {
      let agentSelection: AgentSession["selected"];
      if (run.engine === "external") {
        const session = (await browser.storage.session.get("externalSession"))
          .externalSession as ExternalSession | undefined;
        const connection = mcp?.current();
        if (
          !session ||
          session.runId !== run.id ||
          !connection ||
          session.bridgeId !== connection.bridgeId ||
          session.connectionId !== connection.connectionId ||
          session.selected?.step !== run.nextStep
        )
          throw new Error(
            "External agent selection or connection expired. Observe again after resuming.",
          );
        agentSelection = session.selected;
      } else if (run.engine === "agent") {
        const stored = await browser.storage.session.get("agentSession");
        const session = stored.agentSession as AgentSession | undefined;
        if (!session || session.runId !== run.id)
          throw new Error(
            "Agent session expired. Stop and start the run again.",
          );
        if (
          (approved || previewOnly) &&
          session.selected?.step === run.nextStep
        )
          agentSelection = session.selected;
        else {
          const observation = (await browser.tabs.sendMessage(run.tabId, {
            type: "observe-agent-page",
            step,
          })) as AgentObservation;
          await saveRun({ ...run, thinking: true });
          agentAbort = new AbortController();
          let decision: AgentDecision;
          try {
            decision = await chooseAgentAction(
              session.provider,
              {
                markdown: session.markdown,
                request: session.request,
                stepIndex: run.nextStep,
                plan: runPlan,
                observation,
                supplied: Object.keys(runParameters),
              },
              API_BASE,
              (await readAccount())?.token,
              AbortSignal.any([agentAbort.signal, AbortSignal.timeout(28000)]),
            );
          } finally {
            agentAbort = undefined;
          }
          if (interruption) return saveRun({ ...run, thinking: false });
          if (decision.action === "ask_user" || !decision.targetId)
            throw new Error(
              "The agent needs you to identify the intended control. Check the page, then retry or stop.",
            );
          if (decision.parameter && decision.value !== null) {
            runParameters[decision.parameter] = decision.value;
            await browser.storage.session.set({ runParameters });
          }
          agentSelection = {
            step: run.nextStep,
            observationId: observation.id,
            targetId: decision.targetId,
          };
          await browser.storage.session.set({
            agentSession: { ...session, selected: agentSelection },
          });
        }
      }
      // Stop and Pause take effect before another browser action, even during an in-flight API request.
      if (interruption) return run;
      await saveRun({ ...run, thinking: false, inFlightStep: run.nextStep });
      if (interruption) return saveRun({ ...run, inFlightStep: undefined });
      const response = (await browser.tabs.sendMessage(run.tabId, {
        type: agentSelection ? "execute-agent-action" : "execute-skill-step",
        ...(agentSelection
          ? {
              observationId: agentSelection.observationId,
              targetId: agentSelection.targetId,
            }
          : {}),
        executionKey: `${run.id}:${run.nextStep}`,
        ...(run.engine === "external"
          ? {
              navigationScope: [
                step.url,
                ...(runPlan.steps[run.nextStep + 1]?.kind === "navigation"
                  ? [runPlan.steps[run.nextStep + 1]!.url]
                  : []),
              ],
            }
          : {}),
        step,
        value:
          "parameter" in step && step.parameter
            ? runParameters[step.parameter]
            : undefined,
        confirmed: approved,
        approvalToken: approved ? approvalToken : undefined,
        previewOnly,
      })) as
        | { status?: string; confirmation?: ConfirmationDetails }
        | undefined;
      if (response?.status === "done") {
        status = "done";
        detail = `${step.kind} dispatched${run.engine === "agent" ? ` by ${run.provider} agent` : run.engine === "external" ? " by external MCP agent" : ""}.`;
      } else if (response?.status === "confirmation-required") {
        const pending = {
          runId: run.id,
          step: run.nextStep,
          details: response.confirmation,
        };
        if (isPendingConfirmation(pending, run.id, run.nextStep)) {
          confirmation = pending;
          status = "confirmation-required";
          detail = "Explicit confirmation required before this action.";
        } else
          detail =
            "Could not describe this action safely. Reload the page and retry.";
      } else
        detail =
          "The target was unavailable or ambiguous. Check the page, then retry.";
    }
  }
  if (confirmation)
    await browser.storage.session.set({ runConfirmation: confirmation });
  else await browser.storage.session.remove("runConfirmation");
  const updated = applyStepOutcome(run, runPlan, status, detail);
  updated.thinking = false;
  if (interruption === "pause" && updated.active && !updated.pauseReason)
    updated.pauseReason = "user";
  if (!updated.active)
    await browser.storage.session.remove([
      "runParameters",
      "agentSession",
      "agentError",
    ]);
  const saved = await saveRun(updated);
  try {
    return await syncRunLogs(saved);
  } catch {
    return saveRun({
      ...saved,
      syncError: "Run history will sync when you reopen the extension.",
    });
  }
}

async function automaticTick(): Promise<void> {
  if (tickQueued || interruption) return;
  tickQueued = true;
  try {
    await serial(async () => {
      const run = await readRun();
      if (!canAutoAdvance(run) || interruption) {
        await scheduleRun(null);
        return;
      }
      try {
        await scheduleRun(await performStep());
      } catch (error) {
        if (interruption) {
          await scheduleRun(null);
          return;
        }
        const current = await readRun();
        if (current?.active) {
          if (current.engine === "agent")
            await browser.storage.session.set({
              agentError: {
                runId: current.id,
                message:
                  error instanceof Error
                    ? error.message
                    : "The agent could not choose a safe action.",
              },
            });
          const plan = (await browser.storage.local.get("runPlan")).runPlan as
            | SkillPlan
            | undefined;
          if (plan?.steps[current.nextStep]) {
            await saveRun({
              ...applyStepOutcome(
                current,
                plan,
                "blocked",
                "Could not continue safely. Check the page and agent connection, then retry or stop.",
              ),
              thinking: false,
            });
          } else await saveRun({ ...current, pauseReason: "blocked" });
        }
        await scheduleRun(null);
      }
    });
  } finally {
    tickQueued = false;
  }
}

async function recoverRun(): Promise<void> {
  let run = await readRun();
  if (run?.thinking) run = await saveRun({ ...run, thinking: false });
  if (run?.active && run.inFlightStep !== undefined) {
    const plan = (await browser.storage.local.get("runPlan")).runPlan as
      | SkillPlan
      | undefined;
    run = await saveRun(
      plan?.steps[run.nextStep]
        ? recoverInterruptedRun(run, plan)
        : { ...run, pauseReason: "blocked" },
    );
  }
  if (run?.active && run.engine === "external") {
    const session = (await browser.storage.session.get("externalSession"))
      .externalSession as ExternalSession | undefined;
    externalOwner = session
      ? {
          controllerId: session.controllerId,
          bridgeId: session.bridgeId,
          runId: session.runId,
        }
      : undefined;
    if (session)
      await browser.storage.session.set({
        externalSession: {
          ...session,
          observation: undefined,
          selected: undefined,
        },
      });
    run = await saveRun({
      ...run,
      pauseReason: "user",
      confirmationStep: undefined,
    });
    await browser.storage.session.remove("runConfirmation");
  }
  await scheduleRun(run);
}

export default defineBackground(() => {
  const external = new ExternalRunController({
    readRun,
    readSession: async () =>
      (await browser.storage.session.get("externalSession")).externalSession as
        | ExternalSession
        | undefined,
    saveSession: async (session) => {
      externalOwner = {
        controllerId: session.controllerId,
        bridgeId: session.bridgeId,
        runId: session.runId,
      };
      await browser.storage.session.set({ externalSession: session });
    },
    async start(markdown, parameters) {
      if ((await read())?.active || (await readRun())?.active)
        throw new Error("Stop the current recording or run first.");
      const plan = parseSkillPlan(markdown);
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (
        tab?.id === undefined ||
        !tab.url ||
        sanitizeUrl(tab.url) !== plan.steps[0]?.url
      )
        throw new Error(
          "Open the skill starting page in the active Chrome tab.",
        );
      await ensureRecorder(tab.id);
      const id = crypto.randomUUID();
      const previousDraft = (await browser.storage.local.get("skillDraft"))
        .skillDraft as Record<string, unknown> | undefined;
      const selection = externalDraft(previousDraft, markdown, id);
      const run: RunState = {
        id,
        tabId: tab.id,
        active: true,
        engine: "external",
        mode: "automatic",
        skillKey: selection.skillKey,
        nextStep: 0,
        totalSteps: plan.steps.length,
        logs: [],
      };
      await browser.storage.local.set({
        runPlan: plan,
        skillDraft: selection.draft,
      });
      await browser.storage.session.set({ runParameters: parameters });
      await browser.storage.session.remove([
        "runConfirmation",
        "agentSession",
        "agentError",
      ]);
      interruption = undefined;
      return saveRun(run);
    },
    async observe(run, step) {
      const tab = await browser.tabs.get(run.tabId);
      if (
        tab.status === "loading" ||
        !tab.url ||
        sanitizeUrl(tab.url) !== step.url
      )
        throw new Error("The selected tab is not ready for this checkpoint.");
      await ensureRecorder(run.tabId);
      const safety = (await browser.tabs.sendMessage(run.tabId, {
        type: "check-run-page",
      })) as { humanVerification?: boolean; connectionError?: boolean };
      if (safety.humanVerification || safety.connectionError)
        throw new Error("The page needs human attention.");
      const plan = (await browser.storage.local.get("runPlan"))
        .runPlan as SkillPlan;
      return step.kind === "navigation"
        ? { id: crypto.randomUUID(), url: step.url, controls: [] }
        : ((await browser.tabs.sendMessage(run.tabId, {
            type: "observe-agent-page",
            step,
            navigationScope: [
              step.url,
              ...(plan.steps[run.nextStep + 1]?.kind === "navigation"
                ? [plan.steps[run.nextStep + 1]!.url]
                : []),
            ],
          })) as AgentObservation);
    },
    perform: () => performStep(),
    async stop() {
      const run = await readRun();
      if (!run) throw new Error("No run.");
      if (externalOwner)
        interruptedControllers.delete(externalOwner.controllerId);
      const session = (await browser.storage.session.get("externalSession"))
        .externalSession as ExternalSession | undefined;
      if (session)
        await browser.storage.session.set({
          externalSession: {
            ...session,
            observation: undefined,
            selected: undefined,
          },
        });
      await browser.storage.session.remove([
        "runParameters",
        "runConfirmation",
      ]);
      interruption = undefined;
      return saveRun({
        ...run,
        active: false,
        pauseReason: undefined,
        confirmationStep: undefined,
      });
    },
  });
  const pauseExternal = (controllerId?: string) => {
    if (
      controllerId &&
      (externalOwner?.controllerId === controllerId ||
        pendingExternalStarts.has(controllerId))
    )
      interruptedControllers.add(controllerId);
    if (!controllerId)
      for (const id of pendingExternalStarts) interruptedControllers.add(id);
    if (
      !externalOwner ||
      (controllerId && controllerId !== externalOwner.controllerId)
    )
      return;
    interruptedControllers.add(externalOwner.controllerId);
    // Interrupt before awaiting serialized work, just like the popup's Pause/Stop.
    controlRevision++;
    interruption = "pause";
    void serial(async () => {
      const run = await readRun();
      const session = (await browser.storage.session.get("externalSession"))
        .externalSession as ExternalSession | undefined;
      if (
        run?.active &&
        run.engine === "external" &&
        session &&
        (!controllerId || session.controllerId === controllerId)
      ) {
        await browser.storage.session.set({
          externalSession: {
            ...session,
            observation: undefined,
            selected: undefined,
          },
        });
        await browser.storage.session.remove("runConfirmation");
        await saveRun({
          ...run,
          pauseReason: "user",
          confirmationStep: undefined,
        });
      } else if (run?.engine !== "external") interruption = undefined;
    });
  };
  mcp = new ExternalBridgeClient((identity, command) => {
    const kind = (command as { kind?: string }).kind;
    if (kind === "start") pendingExternalStarts.add(identity.controllerId);
    if (
      kind === "stop" &&
      externalOwner?.controllerId === identity.controllerId &&
      externalOwner.bridgeId === identity.bridgeId &&
      (command as { runId?: string }).runId === externalOwner.runId
    ) {
      controlRevision++;
      interruption = "stop";
    }
    return serial<ExternalResult>(async () => {
      const connection = mcp.current();
      if (
        !connection ||
        connection.bridgeId !== identity.bridgeId ||
        connection.connectionId !== identity.connectionId
      )
        return {
          status: "disconnected",
          message:
            "Connection changed. Inspect the extension before continuing.",
        };
      if (
        interruptedControllers.has(identity.controllerId) &&
        kind !== "status" &&
        kind !== "stop"
      )
        return {
          status: "paused",
          message: "Resume in the extension before issuing new actions.",
        };
      const result = await external.handle(identity, command);
      if (
        interruptedControllers.has(identity.controllerId) &&
        kind === "start"
      ) {
        pauseExternal(identity.controllerId);
        return { ...result, status: "paused" };
      }
      return result;
    }).finally(() => {
      if (kind === "start") {
        pendingExternalStarts.delete(identity.controllerId);
        if (externalOwner?.controllerId !== identity.controllerId)
          interruptedControllers.delete(identity.controllerId);
      }
    });
  }, pauseExternal);
  const controls = new Set([
    "start-recording",
    "stop-recording",
    "start-run",
    "run-next-step",
    "pause-run",
    "resume-run",
    "stop-run",
  ]);
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!message || typeof message !== "object") return;
    const request = message as Record<string, unknown>;
    const fromOwnPage =
      sender.id === browser.runtime.id &&
      (!sender.tab || sender.url?.startsWith(browser.runtime.getURL("")));
    if (
      typeof request.type === "string" &&
      controls.has(request.type) &&
      !fromOwnPage
    ) {
      throw new Error("Only extension pages may control a recording or run.");
    }
    if (typeof request.type === "string" && request.type.startsWith("mcp-")) {
      if (!fromOwnPage)
        throw new Error("Only extension pages may pair an MCP bridge.");
      if (request.type === "mcp-status") return mcp.status();
      if (request.type === "mcp-pair")
        return serial(async () => {
          if ((await readRun())?.active)
            throw new Error(
              "Stop the current run before changing connections.",
            );
          if (typeof request.token !== "string")
            throw new Error("Enter a pairing code.");
          await mcp.pair(request.token);
          return mcp.status();
        });
      if (request.type === "mcp-disconnect") return mcp.disconnect();
    }
    if (typeof request.type === "string" && request.type.startsWith("agent-")) {
      if (!fromOwnPage)
        throw new Error("Only extension pages may configure an agent.");
      if (request.type === "agent-status")
        return (async () => {
          const localStatus = localAgentStatus();
          const account = await readAccount();
          const hosted = account
            ? await api<{ id: string; label: string; available: boolean }[]>(
                "agent/providers",
                {},
                account,
              ).catch(() => [])
            : [];
          return {
            hosted,
            ...(await localStatus),
            extensionOrigin: browser.runtime.getURL("").replace(/\/$/, ""),
          };
        })();
      if (request.type === "agent-pair")
        return serial(async () => {
          if (
            typeof request.token !== "string" ||
            request.token.length < 16 ||
            request.token.length > 128
          )
            throw new Error(
              "Enter the pairing code from the local agent process.",
            );
          return pairLocalAgent(request.token);
        });
      if (request.type === "agent-disconnect")
        return serial(async () => {
          if ((await readRun())?.active)
            throw new Error("Stop the run before disconnecting its agent.");
          await browser.storage.session.remove("localAgentToken");
          return true;
        });
    }
    if (
      typeof request.type === "string" &&
      (request.type.startsWith("account-") ||
        request.type.startsWith("library-"))
    ) {
      if (!fromOwnPage)
        throw new Error("Only extension pages may access the library.");
      if (request.type === "account-status")
        return readAccount().then((account) => account?.user ?? null);
      if (request.type === "account-login")
        return serial(async () => {
          if (
            typeof request.email !== "string" ||
            typeof request.password !== "string"
          )
            throw new Error("Enter email and password.");
          const account = await api<Account>("auth/login", {
            email: request.email,
            password: request.password,
          });
          await browser.storage.session.set({ account });
          return account.user;
        });
      if (request.type === "account-logout")
        return serial(async () => {
          if ((await readRun())?.active)
            throw new Error("Stop the current run before signing out.");
          const account = await readAccount();
          if (account)
            await api("auth/logout", {}, account).catch(() => undefined);
          await browser.storage.session.remove("account");
          return true;
        });
      if (request.type === "library-list")
        return requiredAccount().then((account) =>
          api("skill/list", {}, account),
        );
      if (request.type === "library-load")
        return serial(async () => {
          if (typeof request.id !== "string")
            throw new Error("Choose a skill.");
          const skill = await api<{
            id: string;
            title: string;
            description: string;
            ownerId: string;
            currentVersion: number;
            versions: { markdown: string }[];
          }>("skill/get", { id: request.id }, await requiredAccount());
          if (!skill.versions[0])
            throw new Error("The skill has no saved version.");
          return {
            id: skill.id,
            name: skill.title,
            description: skill.description,
            markdown: skill.versions[0].markdown,
            ownerId: skill.ownerId,
            currentVersion: skill.currentVersion,
          };
        });
      if (request.type === "library-save")
        return serial(async () => {
          if (
            typeof request.name !== "string" ||
            typeof request.description !== "string" ||
            typeof request.markdown !== "string"
          )
            throw new Error("Create a skill first.");
          parseSkillPlan(request.markdown);
          const account = await requiredAccount();
          const path =
            typeof request.remoteSkillId === "string"
              ? "skill/update"
              : "skill/create";
          return api<{ id: string; currentVersion: number }>(
            path,
            {
              ...(path === "skill/update" ? { id: request.remoteSkillId } : {}),
              title: request.name,
              description: request.description,
              markdown: request.markdown,
            },
            account,
          );
        });
    }
    if (request.type === "get-recording") return read();
    if (request.type === "get-run")
      return serial(async () => {
        let run = await readRun();
        if (
          fromOwnPage &&
          run?.active &&
          run.confirmationStep === run.nextStep
        ) {
          const pending = (await browser.storage.session.get("runConfirmation"))
            .runConfirmation;
          if (!isPendingConfirmation(pending, run.id, run.nextStep))
            run = await performStep(false, undefined, true);
        }
        if (run?.remoteRunId && (run.remoteSyncedLogs ?? 0) < run.logs.length) {
          try {
            run = await syncRunLogs(run);
          } catch {
            /* Keep the local log available offline. */
          }
        }
        await scheduleRun(run);
        return run;
      });
    if (request.type === "get-recording-status")
      return read().then((recording) => ({
        active: !!recording?.active,
        tabId: recording?.tabId ?? null,
      }));
    if (request.type === "start-recording")
      return serial(async () => {
        if ((await readRun())?.active)
          throw new Error("Stop the current run before recording.");
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tabId = tab?.id;
        const url = tab?.url ? sanitizeUrl(tab.url) : null;
        if (tabId === undefined || !url)
          throw new Error("Open a website before recording.");
        await ensureRecorder(tabId);
        const recording: Recording = {
          id: crypto.randomUUID(),
          active: true,
          tabId,
          startedAt: new Date().toISOString(),
          actions: [],
        };
        await save(append(recording, { kind: "navigation", url }));
        await browser.action.setBadgeText({ text: "REC" });
        await browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
        await browser.tabs
          .sendMessage(tabId, { type: "recording-state", active: true })
          .catch(() => undefined);
        return read();
      });
    if (request.type === "stop-recording")
      return serial(async () => {
        const recording = await read();
        if (!recording) return null;
        const stopped = {
          ...recording,
          active: false,
          stoppedAt: new Date().toISOString(),
        };
        await save(stopped);
        await browser.action.setBadgeText({ text: "" });
        await browser.tabs
          .sendMessage(recording.tabId, {
            type: "recording-state",
            active: false,
          })
          .catch(() => undefined);
        return stopped;
      });
    if (request.type === "record-action")
      return serial(async () => {
        const recording = await read();
        if (!recording?.active || sender.tab?.id !== recording.tabId)
          return false;
        const action = sanitizedAction(request.action);
        if (!action) return false;
        const eventId =
          typeof request.eventId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            request.eventId,
          )
            ? request.eventId
            : crypto.randomUUID();
        const updated = appendAction(
          recording,
          action,
          eventId,
          new Date().toISOString(),
        );
        if (updated !== recording) await save(updated);
        return true;
      });
    if (request.type === "run-navigation")
      return serial(async () => {
        const run = await readRun();
        if (
          !run?.active ||
          sender.tab?.id !== run.tabId ||
          !run.awaitingNavigation ||
          run.navigationObserved
        )
          return false;
        const updated = await saveRun({ ...run, navigationObserved: true });
        await scheduleRun(updated);
        return true;
      });
    if (request.type === "start-run")
      return serial(async () => {
        if ((await read())?.active)
          throw new Error("Stop recording before running a skill.");
        if ((await readRun())?.active)
          throw new Error("Stop the current run first.");
        if (typeof request.markdown !== "string")
          throw new Error("Choose a skill first.");
        const plan = parseSkillPlan(request.markdown);
        const engine = request.engine === "agent" ? "agent" : "recorded";
        const provider = request.provider as AgentProviderId;
        const taskRequest =
          typeof request.taskRequest === "string"
            ? request.taskRequest.trim()
            : "";
        if (engine === "agent") {
          if (!["openai", "anthropic", "codex-local"].includes(provider))
            throw new Error("Choose an agent provider.");
          if (
            taskRequest.length > 2000 ||
            containsSecret(taskRequest) ||
            containsSecret(request.markdown)
          )
            throw new Error(
              "Use a task request and skill without passwords or secrets.",
            );
          if (
            provider === "codex-local" &&
            !(await browser.storage.session.get("localAgentToken"))
              .localAgentToken
          )
            throw new Error("Connect your local agent first.");
          if (provider !== "codex-local") {
            const options = await api<{ id: string; available: boolean }[]>(
              "agent/providers",
              {},
              await requiredAccount(),
            );
            if (!options.some((item) => item.id === provider && item.available))
              throw new Error(
                "This hosted provider is not configured. Connect a local agent or configure the server.",
              );
          }
        }
        const provided =
          request.parameters && typeof request.parameters === "object"
            ? (request.parameters as Record<string, unknown>)
            : {};
        const parameters: Record<string, string | boolean> = {};
        for (const parameter of plan.parameters) {
          const value = provided[parameter.name];
          if (
            engine === "agent" &&
            (value === undefined ||
              (typeof value === "string" && !value.trim()))
          ) {
            if (!taskRequest)
              throw new Error(
                "Describe your task or supply the required parameters.",
              );
            continue;
          }
          if (
            parameter.type === "string" &&
            (typeof value !== "string" || !value.trim())
          )
            throw new Error(`Enter ${parameter.name}.`);
          if (parameter.type === "boolean" && typeof value !== "boolean")
            throw new Error(`Select ${parameter.name}.`);
          parameters[parameter.name] = value as string | boolean;
        }
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id === undefined || !tab.url || !sanitizeUrl(tab.url))
          throw new Error("Open the task website before running.");
        await ensureRecorder(tab.id);
        let remoteRunId: string | undefined;
        if (typeof request.remoteSkillId === "string") {
          const account = await requiredAccount();
          const skill = await api<{ versions: { markdown: string }[] }>(
            "skill/get",
            { id: request.remoteSkillId },
            account,
          );
          if (skill.versions[0]?.markdown !== request.markdown)
            throw new Error("Save your changes before running this skill.");
          remoteRunId = (
            await api<{ id: string }>(
              "run/start",
              { skillId: request.remoteSkillId },
              account,
            )
          ).id;
        }
        interruption = undefined;
        const run: RunState = {
          id: crypto.randomUUID(),
          tabId: tab.id,
          active: true,
          mode: request.mode === "manual" ? "manual" : "automatic",
          engine,
          ...(engine === "agent" ? { provider } : {}),
          skillKey:
            typeof request.skillKey === "string" ? request.skillKey : undefined,
          nextStep: 0,
          totalSteps: plan.steps.length,
          ...(remoteRunId ? { remoteRunId, remoteSyncedLogs: 0 } : {}),
          logs: [],
        };
        await browser.storage.local.set({ runPlan: plan });
        await browser.storage.session.remove("runConfirmation");
        await browser.storage.session.remove("agentError");
        if (engine === "agent")
          await browser.storage.session.set({
            agentSession: {
              runId: run.id,
              markdown: request.markdown,
              request:
                taskRequest || "Run this skill using the supplied parameters.",
              provider,
            } satisfies AgentSession,
          });
        await browser.storage.session.set({ runParameters: parameters });
        await saveRun(run);
        await scheduleRun(run);
        return run;
      });
    if (request.type === "run-next-step") {
      const revision = controlRevision;
      return serial(async () => {
        if (revision !== controlRevision) return readRun();
        interruption = undefined;
        if (
          (await readRun())?.engine === "external" &&
          request.confirm !== true
        )
          throw new Error(
            "The external agent chooses actions; approve only through the displayed preview.",
          );
        const run = await performStep(
          request.confirm === true,
          typeof request.approvalToken === "string"
            ? request.approvalToken
            : undefined,
        );
        await scheduleRun(run);
        return run;
      });
    }
    if (request.type === "pause-run" || request.type === "stop-run") {
      controlRevision++;
      interruption = request.type === "stop-run" ? "stop" : "pause";
      agentAbort?.abort();
      clearTimer();
      void browser.alarms.clear(AUTO_ALARM);
      return serial(async () => {
        const run = await readRun();
        if (!run?.active) return run;
        if (request.type === "pause-run") {
          if (run.engine === "external") {
            const session = (
              await browser.storage.session.get("externalSession")
            ).externalSession as ExternalSession | undefined;
            if (session)
              await browser.storage.session.set({
                externalSession: {
                  ...session,
                  observation: undefined,
                  selected: undefined,
                },
              });
          }
          return saveRun({
            ...run,
            thinking: false,
            pauseReason: run.pauseReason ?? "user",
          });
        }
        await browser.storage.session.remove([
          "runParameters",
          "runConfirmation",
          "agentSession",
          "agentError",
        ]);
        if (run.engine === "external") {
          const session = (await browser.storage.session.get("externalSession"))
            .externalSession as ExternalSession | undefined;
          if (session)
            await browser.storage.session.set({
              externalSession: {
                ...session,
                observation: undefined,
                selected: undefined,
              },
            });
        }
        if (externalOwner)
          interruptedControllers.delete(externalOwner.controllerId);
        const stopped = await saveRun({
          ...run,
          active: false,
          thinking: false,
          confirmationStep: undefined,
          pauseReason: undefined,
        });
        if (stopped.remoteRunId) {
          try {
            const synced = await syncRunLogs(stopped);
            await api(
              "run/stop",
              { runId: stopped.remoteRunId },
              await requiredAccount(),
            );
            return synced;
          } catch {
            return saveRun({
              ...stopped,
              syncError: "Run history could not sync yet.",
            });
          }
        }
        return stopped;
      });
    }
    if (request.type === "resume-run") {
      const revision = controlRevision;
      return serial(async () => {
        if (revision !== controlRevision) return readRun();
        const run = await readRun();
        if (!run?.active) throw new Error("No active run.");
        if (run.confirmationStep === run.nextStep)
          throw new Error("Confirm the pending action before continuing.");
        interruption = undefined;
        if (run.engine === "external") {
          const session = (await browser.storage.session.get("externalSession"))
            .externalSession as ExternalSession | undefined;
          const connection = mcp.current();
          if (
            !session ||
            !connection ||
            session.bridgeId !== connection.bridgeId
          )
            throw new Error(
              "Reconnect the original MCP bridge, or Stop and start a new run.",
            );
          await browser.storage.session.set({
            externalSession: {
              ...session,
              ...connection,
              observation: undefined,
              selected: undefined,
            },
          });
          interruptedControllers.delete(session.controllerId);
        }
        const resumed = await saveRun({
          ...run,
          pauseReason: undefined,
          navigationStartedAt: run.awaitingNavigation
            ? Date.now()
            : run.navigationStartedAt,
        });
        await scheduleRun(resumed, 100);
        return resumed;
      });
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return;
    void serial(async () => {
      const run = await readRun();
      if (run?.active && run.tabId === tabId) {
        const updated =
          run.awaitingNavigation && !run.navigationObserved
            ? await saveRun({ ...run, navigationObserved: true })
            : run;
        await scheduleRun(updated);
      }
      const recording = await read();
      if (!recording?.active || recording.tabId !== tabId) return;
      const url = sanitizeUrl(tab.url!);
      if (!url) return;
      const updated = append(recording, { kind: "navigation", url });
      if (updated !== recording) await save(updated);
    });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "mcp-reconnect") void mcp.connect().catch(() => {});
    if (alarm.name === AUTO_ALARM) void automaticTick();
  });
  browser.runtime.onStartup.addListener(() => {
    void serial(recoverRun);
  });
  void serial(recoverRun);
  void mcp.connect().catch(() => {});
});
