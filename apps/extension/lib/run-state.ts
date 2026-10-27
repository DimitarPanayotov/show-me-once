import type { RunLog, RunState, SkillPlan } from "@show-me-once/shared";

export function canAutoAdvance(run: RunState | null): run is RunState {
  return (
    !!run?.active &&
    run.engine !== "external" &&
    run.mode === "automatic" &&
    !run.pauseReason &&
    run.inFlightStep === undefined &&
    run.confirmationStep !== run.nextStep
  );
}

export function applyStepOutcome(
  run: RunState,
  plan: SkillPlan,
  status: RunLog["status"],
  detail: string,
  now = Date.now(),
): RunState {
  const step = plan.steps[run.nextStep]!;
  const nextStep = status === "done" ? run.nextStep + 1 : run.nextStep;
  const startsNavigation =
    status === "done" &&
    (step.kind === "click" || step.kind === "key") &&
    plan.steps[nextStep]?.kind === "navigation";
  const endsNavigation = status === "done" && step.kind === "navigation";
  return {
    ...run,
    active: nextStep < plan.steps.length,
    nextStep,
    inFlightStep: undefined,
    pauseReason:
      status === "confirmation-required"
        ? "confirmation"
        : status === "blocked"
          ? "blocked"
          : undefined,
    confirmationStep:
      status === "confirmation-required" ? run.nextStep : undefined,
    awaitingNavigation: startsNavigation
      ? true
      : endsNavigation
        ? false
        : run.awaitingNavigation,
    navigationObserved:
      startsNavigation || endsNavigation ? false : run.navigationObserved,
    navigationStartedAt: startsNavigation
      ? now
      : endsNavigation
        ? undefined
        : run.navigationStartedAt,
    logs: [
      ...run.logs,
      {
        step: run.nextStep + 1,
        kind: step.kind,
        status,
        at: new Date(now).toISOString(),
        detail,
      },
    ],
  };
}

export function recoverInterruptedRun(
  run: RunState,
  plan: SkillPlan,
): RunState {
  return run.active && run.inFlightStep !== undefined
    ? applyStepOutcome(
        run,
        plan,
        "blocked",
        "The previous action was interrupted and may have executed. Check the page before retrying.",
      )
    : run;
}
