import type { SkillPlan } from "./index";

export type AgentProviderId = "openai" | "anthropic" | "codex-local";
export const DEFAULT_AGENT_MODELS = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-4-6",
} as const;
export type AgentControl = {
  id: string;
  role: "button" | "link" | "input" | "select";
  label: string;
  inputKind?: string;
  selector: string;
  destination?: string;
};
export type AgentObservation = {
  id: string;
  url: string;
  controls: AgentControl[];
};
export type AgentInput = {
  markdown: string;
  request: string;
  stepIndex: number;
  plan: SkillPlan;
  observation: AgentObservation;
  supplied: string[];
};
export type AgentDecision = {
  action: "click" | "fill" | "press_enter" | "ask_user";
  targetId: string | null;
  parameter: string | null;
  value: string | boolean | null;
};

export const AGENT_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["click", "fill", "press_enter", "ask_user"],
    },
    targetId: { type: ["string", "null"] },
    parameter: { type: ["string", "null"] },
    value: { type: ["string", "boolean", "null"] },
  },
  required: ["action", "targetId", "parameter", "value"],
} as const;

/** Drop obvious secrets before an observation can cross the model boundary. Never read field values. */
export function safeAgentLabel(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(
      /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(/\b[A-Za-z0-9_-]{30,}\b/g, "[redacted]")
    .replace(/\b\d[\d ()+.-]{7,}\d\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

export function containsSecret(raw: string): boolean {
  return (
    /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/i.test(
      raw,
    ) || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(raw)
  );
}

export function checkedDecision(
  value: unknown,
  input: AgentInput,
): AgentDecision {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The agent returned an invalid action.");
  const d = value as Record<string, unknown>;
  if (
    Object.keys(d).some(
      (key) => !["action", "targetId", "parameter", "value"].includes(key),
    )
  )
    throw new Error("The agent returned an unsupported action.");
  if (d.action === "ask_user")
    return { action: "ask_user", targetId: null, parameter: null, value: null };
  const step = input.plan.steps[input.stepIndex];
  const expected =
    step?.kind === "click"
      ? "click"
      : step?.kind === "input"
        ? "fill"
        : step?.kind === "key"
          ? "press_enter"
          : null;
  if (d.action !== expected || typeof d.targetId !== "string")
    throw new Error("The agent action does not match the skill step.");
  const control = input.observation.controls.find(
    (item) => item.id === d.targetId,
  );
  if (!control) throw new Error("The agent selected an unknown page control.");
  if (d.action === "fill" || d.action === "press_enter") {
    if (!["input", "select"].includes(control.role))
      throw new Error("The agent selected the wrong control type.");
  }
  let parameter: string | null = null;
  let replacement: string | boolean | null = null;
  if (step?.kind === "input") {
    parameter = step.parameter;
    if (d.parameter !== parameter)
      throw new Error("The agent selected an unknown parameter.");
    if (!input.supplied.includes(parameter)) {
      const definition = input.plan.parameters.find(
        (item) => item.name === parameter,
      )!;
      if (definition.type === "string") {
        if (
          typeof d.value !== "string" ||
          !d.value.trim() ||
          containsSecret(d.value) ||
          !input.request
            .toLocaleLowerCase()
            .includes(d.value.trim().toLocaleLowerCase())
        )
          throw new Error(
            "Supply this parameter explicitly; the agent could not extract it safely from your request.",
          );
        replacement = d.value.trim();
      } else if (
        typeof d.value === "boolean" &&
        new RegExp(`\\b${d.value}\\b`, "i").test(input.request)
      )
        replacement = d.value;
      else throw new Error("Supply the selected state explicitly.");
    }
  }
  return {
    action: d.action as AgentDecision["action"],
    targetId: d.targetId,
    parameter,
    value: replacement,
  };
}
