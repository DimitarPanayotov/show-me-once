export type ConfirmationIntent =
  | "open-link"
  | "search"
  | "submit"
  | "enter"
  | "delete"
  | "remove"
  | "payment"
  | "purchase"
  | "transfer";

export type ConfirmationDetails = {
  token: string;
  intent: ConfirmationIntent;
  interaction: "click" | "enter";
  targetLabel: string;
  targetTag: "button" | "input" | "link" | "control";
  origin: string;
  destinationOrigin?: string;
  changed?: boolean;
};

// Live control labels belong only in session storage, never in a skill or run log.
export type PendingConfirmation = {
  runId: string;
  step: number;
  details: ConfirmationDetails;
};

export function controlLabel(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sensitiveIntent(text: string): ConfirmationIntent | null {
  if (/\bdelete\b/i.test(text)) return "delete";
  if (/\bremove\b/i.test(text)) return "remove";
  if (/\btransfer\b/i.test(text)) return "transfer";
  if (/\b(pay|payment)\b/i.test(text)) return "payment";
  if (/\b(purchase|buy|checkout|place order)\b/i.test(text)) return "purchase";
  return null;
}

export function confirmationIntent(action: {
  label: string;
  destination: string;
  submits: boolean;
  search: boolean;
  enter: boolean;
  navigationLink?: boolean;
}): ConfirmationIntent | null {
  const text = `${action.label} ${action.destination}`;
  // Risky wording takes precedence even when a control sits in a search form.
  const sensitive = sensitiveIntent(text);
  if (sensitive) {
    // A heading link can describe an article or issue about an action. Keep approval,
    // but describe navigation when only its title contains the sensitive wording.
    return action.navigationLink && !action.submits && !action.enter && !sensitiveIntent(action.destination)
      ? "open-link" : sensitive;
  }
  if (action.submits || action.enter || /\bsubmit\b/i.test(text)) {
    if (action.search) return "search";
    return action.submits ? "submit" : "enter";
  }
  return null;
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

export function isPendingConfirmation(
  value: unknown,
  runId: string,
  step: number,
): value is PendingConfirmation {
  if (!value || typeof value !== "object") return false;
  const pending = value as PendingConfirmation;
  const details = pending.details;
  return (
    pending.runId === runId &&
    pending.step === step &&
    !!details &&
    typeof details.token === "string" &&
    /^[0-9a-f-]{36}$/i.test(details.token) &&
    [
      "open-link",
      "search",
      "submit",
      "enter",
      "delete",
      "remove",
      "payment",
      "purchase",
      "transfer",
    ].includes(details.intent) &&
    ["click", "enter"].includes(details.interaction) &&
    ["button", "input", "link", "control"].includes(details.targetTag) &&
    typeof details.targetLabel === "string" &&
    details.targetLabel === controlLabel(details.targetLabel) &&
    validOrigin(details.origin) &&
    (details.destinationOrigin === undefined ||
      validOrigin(details.destinationOrigin))
  );
}

export function confirmationCopy(
  details: ConfirmationDetails,
  automatic: boolean,
) {
  const names: Record<ConfirmationIntent, string> = {
    "open-link": "Open link",
    search: "Submit search",
    submit: "Submit form",
    enter: "Press Enter",
    delete: "Delete",
    remove: "Remove",
    payment: "Authorize payment",
    purchase: "Place order",
    transfer: "Authorize transfer",
  };
  const effects: Record<ConfirmationIntent, string> = {
    "open-link": "The link title mentions a potentially sensitive action. Check that this is the page you intend to open before continuing.",
    search: "This submits the search fields currently filled on the page.",
    submit: "This submits the form and may change data on the website.",
    enter: "This may submit the current field or apply a filter.",
    delete: "This may permanently delete data on the website.",
    remove: "This may remove data or access on the website.",
    payment: "This may send a payment or charge your account.",
    purchase: "This may place an order or complete a purchase.",
    transfer: "This may transfer funds or assets.",
  };
  const action = names[details.intent];
  const label = details.targetLabel ? `“${details.targetLabel}”` : "";
  const target =
    details.interaction === "enter"
      ? label
        ? `Press Enter in the ${label} field.`
        : "Press Enter in the matched input field."
      : label
        ? `Click the ${label} ${details.targetTag === "input" ? "control" : details.targetTag}.`
        : `Click the matched ${details.targetTag === "input" ? "control" : details.targetTag}.`;
  return {
    action,
    title: `${action} on ${new URL(details.origin).host}`,
    target,
    effect: effects[details.intent],
    destination:
      details.destinationOrigin && details.destinationOrigin !== details.origin
        ? `Form destination: ${details.destinationOrigin}`
        : "",
    continuation: automatic
      ? "Approves only this action. The remaining steps then continue automatically."
      : "Approves only this action. You choose when the next step runs.",
    button: `${action}${automatic ? " & continue" : ""}`,
  };
}
