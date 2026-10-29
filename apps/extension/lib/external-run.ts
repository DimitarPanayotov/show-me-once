import {
  parseSkillPlan,
  readSkillMetadata,
  type RunState,
  type SkillPlan,
  type SkillStep,
} from "@show-me-once/shared";
import {
  checkedDecision,
  safeAgentLabel,
  containsSecret,
  type AgentObservation,
} from "@show-me-once/shared/agent";
import {
  checkedExternalCommand,
  type ExternalIdentity,
  type ExternalResult,
} from "@show-me-once/shared/mcp";
import { keepLocalDraft, type CatalogDraft } from "./skill-catalog.ts";
import { confirmationCopy, isPendingConfirmation, type PendingConfirmation } from './confirmation.ts';
import type { ConnectorResult } from '@show-me-once/shared/approval';

export function prepareExternalDraft(
  previous: CatalogDraft | undefined,
  skills: CatalogDraft[],
  markdown: string,
  runId: string,
) {
  try {
    return { ...externalDraft(previous, markdown, runId), skills };
  } catch (error) {
    if (!previous?.dirty) throw error;
    return {
      ...externalDraft(undefined, markdown, runId),
      skills: keepLocalDraft(skills, previous),
    };
  }
}

/** Preserve an existing edited draft when it represents the same exported skill. */
export function externalDraft(
  previous: Record<string, unknown> | undefined,
  markdown: string,
  runId: string,
) {
  const base = (text: string) =>
    text.split("<!-- show-me-once-mcp -->")[0]!.replace(/\r\n/g, "\n").trim();
  if (
    previous &&
    typeof previous.markdown === "string" &&
    typeof previous.sourceRecordingId === "string" &&
    base(previous.markdown) === base(markdown)
  )
    return {
      draft: previous,
      skillKey:
        typeof previous.remoteSkillId === "string"
          ? previous.remoteSkillId
          : previous.sourceRecordingId,
    };
  if (previous?.dirty)
    throw new Error(
      "Save your current draft before starting a different external skill.",
    );
  let metadata;
  try { metadata = readSkillMetadata(markdown); }
  catch { throw new Error('The skill header is invalid. Read the original skill again.'); }
  return {
    draft: {
      sourceRecordingId: `mcp:${runId}`,
      name: metadata.name,
      description: metadata.description,
      markdown,
      dirty: true,
    },
    skillKey: `mcp:${runId}`,
  };
}

export type ExternalSession = ExternalIdentity & {
  runId: string;
  markdown: string;
  observation?: {
    at: number;
    step: number;
    tabId: number;
    page: AgentObservation;
  };
  selected?: { step: number; observationId: string; targetId: string };
  actionReview?: { id: string; token: string; step: number; tabId: number; expiresAt: number };
};
export interface ExternalRunPorts {
  readRun(): Promise<RunState | null>;
  readSession(): Promise<ExternalSession | undefined>;
  saveSession(session: ExternalSession): Promise<void>;
  start(
    markdown: string,
    parameters: Record<string, string | boolean>,
    startUrl?: string,
  ): Promise<RunState>;
  refreshStart?(run: RunState): Promise<RunState>;
  observe(run: RunState, step: SkillStep): Promise<AgentObservation>;
  perform(confirmed?: boolean, approvalToken?: string): Promise<RunState>;
  readConfirmation?(run: RunState): Promise<PendingConfirmation | undefined>;
  stop(): Promise<RunState>;
}
export function externalStatus(
  run: RunState,
  plan?: SkillPlan,
): ExternalResult {
  return {
    runId: run.id,
    stepIndex: run.nextStep,
    totalSteps: run.totalSteps,
    ...(run.engine === 'external' ? { approvalInAgent: true } : {}),
    status: !run.active
      ? run.nextStep === run.totalSteps
        ? "completed"
        : "stopped"
      : run.inFlightStep !== undefined
        ? "unknown_outcome"
        : run.pauseReason === "user"
          ? "paused"
          : run.confirmationStep === run.nextStep
            ? "needs_approval"
            : run.pauseReason
              ? "blocked"
              : run.awaitingNavigation && !run.navigationObserved
                ? "waiting"
                : "ready",
    ...(plan?.steps[run.nextStep] ? { step: plan.steps[run.nextStep] } : {}),
    ...(run.active && run.preparingStart ? { message: 'Opening the starting page automatically. Poll get_run_status; do not start another run.' } : {}),
  };
}
/** Serialized by the background worker. The transport supplies identity, never tool arguments. */
export class ExternalRunController {
  private ports: ExternalRunPorts;
  private now: () => number;
  constructor(ports: ExternalRunPorts, now = Date.now) {
    this.ports = ports;
    this.now = now;
  }
  private async owned(identity: ExternalIdentity, runId: string) {
    const run = await this.ports.readRun(), session = await this.ports.readSession();
    if (!run || !session || run.engine !== 'external' || run.id !== runId || session.runId !== run.id || session.controllerId !== identity.controllerId || session.bridgeId !== identity.bridgeId)
      throw new Error('This controller does not own that run.');
    if (session.connectionId !== identity.connectionId) throw new Error('Connection changed. Resume in the extension before continuing.');
    return { run, session, plan: parseSkillPlan(session.markdown) };
  }
  async review(identity: ExternalIdentity, runId: string): Promise<ConnectorResult> {
    const { run, session, plan } = await this.owned(identity, runId);
    const status = externalStatus(run, plan);
    if (status.status !== 'needs_approval') return status;
    const pending = await this.ports.readConfirmation?.(run);
    if (!isPendingConfirmation(pending, run.id, run.nextStep)) throw new Error('The action preview changed. Review it again before approving.');
    const old = session.actionReview;
    const review = old && old.token === pending.details.token && old.step === run.nextStep && old.tabId === run.tabId && old.expiresAt > this.now()
      ? old : { id: crypto.randomUUID(), token: pending.details.token, step: run.nextStep, tabId: run.tabId, expiresAt: this.now() + 120000 };
    await this.ports.saveSession({ ...session, actionReview: review });
    const copy = confirmationCopy({ ...pending.details, targetLabel: containsSecret(pending.details.targetLabel) ? 'Sensitive control' : safeAgentLabel(pending.details.targetLabel) }, true);
    return { ...status, approval: { reviewId: review.id, runId, stepIndex: run.nextStep, expiresAt: review.expiresAt,
      title: copy.title, target: copy.target, effect: copy.effect,
      destination: pending.details.destinationOrigin && pending.details.destinationOrigin !== pending.details.origin
        ? `Destination: ${new URL(pending.details.destinationOrigin).host}` : '' } };
  }
  async decide(identity: ExternalIdentity, runId: string, reviewId: string, approved: boolean): Promise<ConnectorResult> {
    const { run, session, plan } = await this.owned(identity, runId);
    const status = externalStatus(run, plan);
    if (status.status !== 'needs_approval') return status;
    const review = session.actionReview;
    if (!review || review.id !== reviewId || review.step !== run.nextStep || review.tabId !== run.tabId || review.expiresAt <= this.now())
      throw new Error('The action preview changed. Review it again before approving.');
    const pending = await this.ports.readConfirmation?.(run);
    // Consume before dispatch: stale forms, duplicate responses and uncertain outcomes cannot repeat the click.
    await this.ports.saveSession({ ...session, observation: undefined, actionReview: undefined });
    if (!isPendingConfirmation(pending, run.id, run.nextStep) || review.token !== pending.details.token)
      throw new Error('The action preview changed. Review it again before approving.');
    if (!approved) return { ...status, message: 'Action not approved. No click was performed. Leave the run waiting; do not request approval again unless the user asks.' };
    return externalStatus(await this.ports.perform(true, pending.details.token), plan);
  }
  async handle(
    identity: ExternalIdentity,
    raw: unknown,
  ): Promise<ExternalResult> {
    const command = checkedExternalCommand(raw);
    if (command.kind === "list_skills" || command.kind === "get_skill")
      throw new Error("Catalog commands must use the read-only skill catalog.");
    if (command.kind === "start") {
      if ((await this.ports.readRun())?.active)
        throw new Error("Stop the current run first.");
      if (!command.markdown) throw new Error('Read the original skill again before starting.');
      const run = await this.ports.start(command.markdown, command.parameters, command.startUrl);
      await this.ports.saveSession({
        ...identity,
        runId: run.id,
        markdown: command.markdown,
      });
      return externalStatus(run, parseSkillPlan(command.markdown));
    }
    let run = await this.ports.readRun();
    const
      session = await this.ports.readSession();
    if (
      !run ||
      !session ||
      run.engine !== "external" ||
      run.id !== command.runId ||
      session.runId !== run.id ||
      session.controllerId !== identity.controllerId ||
      session.bridgeId !== identity.bridgeId
    )
      throw new Error("This controller does not own that run.");
    const plan = parseSkillPlan(session.markdown);
    if (command.kind === "stop")
      return externalStatus(await this.ports.stop(), plan);
    if (run.active && run.preparingStart && this.ports.refreshStart) run = await this.ports.refreshStart(run);
    if (command.kind === "status") return externalStatus(run, plan);
    if (
      !run.active ||
      run.pauseReason ||
      run.inFlightStep !== undefined ||
      run.confirmationStep === run.nextStep
    )
      return externalStatus(run, plan);
    if (run.awaitingNavigation && !run.navigationObserved)
      return externalStatus(run, plan);
    if (session.connectionId !== identity.connectionId)
      throw new Error(
        "Connection changed. Resume in the extension before continuing.",
      );
    const step = plan.steps[run.nextStep]!;
    if (command.kind === "observe") {
      const page = await this.ports.observe(run, step);
      await this.ports.saveSession({
        ...session,
        selected: undefined,
        observation: {
          at: this.now(),
          step: run.nextStep,
          tabId: run.tabId,
          page,
        },
      });
      return { ...externalStatus(run, plan), observation: page };
    }
    const snapshot = session.observation;
    if (command.kind !== "act") throw new Error("Unsupported command.");
    if (
      !snapshot ||
      command.stepIndex !== run.nextStep ||
      snapshot.step !== run.nextStep ||
      snapshot.tabId !== run.tabId ||
      snapshot.page.id !== command.observationId ||
      this.now() - snapshot.at > 15000
    )
      throw new Error("Stale observation. Observe this run again.");
    let selected: ExternalSession["selected"];
    if (step.kind === "navigation") {
      if (command.action !== "checkpoint" || command.targetId !== undefined)
        throw new Error("Only the current checkpoint is permitted.");
    } else {
      const decision = checkedDecision(
        {
          action: command.action,
          targetId: command.targetId,
          parameter: step.kind === "input" ? step.parameter : null,
          value: null,
        },
        {
          markdown: session.markdown,
          request: "",
          stepIndex: run.nextStep,
          plan,
          supplied: plan.parameters.map((p) => p.name),
          observation: snapshot.page,
        },
      );
      selected = {
        step: run.nextStep,
        observationId: snapshot.page.id,
        targetId: decision.targetId!,
      };
    }
    // Consume before dispatch: retries cannot repeat a command with an uncertain outcome.
    await this.ports.saveSession({
      ...session,
      observation: undefined, actionReview: undefined,
      selected,
    });
    return externalStatus(await this.ports.perform(), plan);
  }
}
