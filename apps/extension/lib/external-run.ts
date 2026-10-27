import {
  parseSkillPlan,
  type RunState,
  type SkillPlan,
  type SkillStep,
} from "@show-me-once/shared";
import {
  checkedDecision,
  type AgentObservation,
} from "@show-me-once/shared/agent";
import {
  checkedExternalCommand,
  type ExternalIdentity,
  type ExternalResult,
} from "@show-me-once/shared/mcp";

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
};
export interface ExternalRunPorts {
  readRun(): Promise<RunState | null>;
  readSession(): Promise<ExternalSession | undefined>;
  saveSession(session: ExternalSession): Promise<void>;
  start(
    markdown: string,
    parameters: Record<string, string | boolean>,
  ): Promise<RunState>;
  observe(run: RunState, step: SkillStep): Promise<AgentObservation>;
  perform(): Promise<RunState>;
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
  async handle(
    identity: ExternalIdentity,
    raw: unknown,
  ): Promise<ExternalResult> {
    const command = checkedExternalCommand(raw);
    if (command.kind === "start") {
      if ((await this.ports.readRun())?.active)
        throw new Error("Stop the current run first.");
      const run = await this.ports.start(command.markdown, command.parameters);
      await this.ports.saveSession({
        ...identity,
        runId: run.id,
        markdown: command.markdown,
      });
      return externalStatus(run, parseSkillPlan(command.markdown));
    }
    const run = await this.ports.readRun(),
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
    if (command.kind === "status") return externalStatus(run, plan);
    if (command.kind === "stop")
      return externalStatus(await this.ports.stop(), plan);
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
      observation: undefined,
      selected,
    });
    return externalStatus(await this.ports.perform(), plan);
  }
}
