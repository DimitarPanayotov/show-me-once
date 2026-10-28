import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmationCopy,
  confirmationIntent,
  controlLabel,
  isPendingConfirmation,
  type ConfirmationDetails,
} from "./confirmation.ts";

const details: ConfirmationDetails = {
  token: "07118f12-a190-4ddd-9dd9-d7ee5e69f98b",
  intent: "search",
  interaction: "click",
  targetLabel: "Search",
  targetTag: "button",
  origin: "https://www.wikipedia.org",
};

test("search submission has a specific action, target, consequence, and approval", () => {
  const copy = confirmationCopy(details, true);
  assert.equal(copy.title, "Submit search on www.wikipedia.org");
  assert.equal(copy.target, "Click the “Search” button.");
  assert.match(copy.effect, /submits the search fields/);
  assert.equal(copy.button, "Submit search & continue");
  assert.match(copy.continuation, /only this action/);
});

test("destructive and payment actions cannot be disguised by search context", () => {
  const search = { destination: "", submits: true, search: true, enter: false };
  assert.equal(
    confirmationIntent({ ...search, label: "Delete all results" }),
    "delete",
  );
  assert.equal(confirmationIntent({ ...search, label: "Pay now" }), "payment");
  assert.equal(confirmationIntent({ ...search, label: "Search" }), "search");
  assert.equal(confirmationIntent({ ...search, label: "Search", destination: "https://example.com/delete-item" }), "delete");
  assert.equal(
    confirmationIntent({ ...search, label: "Save", search: false }),
    "submit",
  );
  assert.equal(
    confirmationIntent({ ...search, label: "Focus", submits: false }),
    null,
  );
});

test("Enter and external form destinations are explained without leaking URL paths or queries", () => {
  const copy = confirmationCopy(
    {
      ...details,
      interaction: "enter",
      targetLabel: "Find a repository",
      destinationOrigin: "https://checkout.example.com",
    },
    false,
  );
  assert.equal(copy.target, "Press Enter in the “Find a repository” field.");
  assert.equal(copy.button, "Submit search");
  assert.equal(
    copy.destination,
    "Form destination: https://checkout.example.com",
  );
  assert.match(copy.continuation, /You choose/);
});

test("previews are bound to the pending run and step and accept only bounded plain labels and origins", () => {
  const pending = { runId: "run-1", step: 3, details };
  assert.equal(isPendingConfirmation(pending, "run-1", 3), true);
  assert.equal(isPendingConfirmation(pending, "another-run", 3), false);
  assert.equal(isPendingConfirmation(pending, "run-1", 4), false);
  assert.equal(
    isPendingConfirmation(
      {
        ...pending,
        details: {
          ...details,
          origin: "https://example.com/path?secret=value",
        },
      },
      "run-1",
      3,
    ),
    false,
  );
  assert.equal(
    isPendingConfirmation(
      { ...pending, details: { ...details, intent: "safe" } },
      "run-1",
      3,
    ),
    false,
  );
  assert.equal(
    isPendingConfirmation(
      { ...pending, details: { ...details, targetLabel: "x".repeat(1000) } },
      "run-1",
      3,
    ),
    false,
  );
  assert.equal(controlLabel(" Search\n\u202e now "), "Search now");
});
