import { createSkillMarkdown, type Recording } from "@show-me-once/shared";
import type { CatalogDraft } from "./skill-catalog.ts";

export const EXAMPLE_ID = "example:github-issue-triage";
export const EXAMPLE_START_URL = "https://github.com/search/advanced";
export const EXAMPLE_REQUEST =
  "Use Show Me Once to triage open GitHub issues in microsoft/vscode about terminal with the bug label. Sort by recently updated and open the first matching issue. Ask me to approve the search in the extension.";
export const EXAMPLE_ALTERNATIVE_REQUEST =
  "Use the same Show Me Once issue-triage skill for microsoft/TypeScript, topic inference, state open, and label bug. Sort by recently updated and open the first matching issue.";
export const EXAMPLE_STEP_LABELS = [
  "Check GitHub Advanced search",
  "Fill the topic",
  "Fill the repository",
  "Set the issue state",
  "Fill the label",
  "Submit the advanced search",
  "Check search results",
  "Open the sort menu",
  "Choose Recently updated",
  "Check sorted results",
  "Open the first matching issue",
  "Check the issue page",
];
const advanced = "https://github.com/…/…",
  results = "https://github.com/…",
  detail = "https://github.com/…/…/…/…";
const actions: Omit<Recording["actions"][number], "id" | "at">[] = [
  { kind: "navigation", url: advanced },
  {
    kind: "input",
    url: advanced,
    inputKind: "text",
    selector:
      "form:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > label:nth-of-type(1) > input:nth-of-type(1)",
  },
  {
    kind: "input",
    url: advanced,
    inputKind: "text",
    selector:
      "main:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(2) > fieldset:nth-of-type(1) > dl:nth-of-type(2) > dd:nth-of-type(1) > input:nth-of-type(1)",
  },
  {
    kind: "input",
    url: advanced,
    inputKind: "select",
    selector:
      "main:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(2) > fieldset:nth-of-type(4) > dl:nth-of-type(1) > dd:nth-of-type(1) > select:nth-of-type(1)",
  },
  {
    kind: "input",
    url: advanced,
    inputKind: "text",
    selector:
      "main:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(2) > fieldset:nth-of-type(4) > dl:nth-of-type(4) > dd:nth-of-type(1) > input:nth-of-type(1)",
  },
  {
    kind: "click",
    url: advanced,
    selector:
      "main:nth-of-type(1) > form:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)",
  },
  { kind: "navigation", url: results },
  {
    kind: "click",
    url: results,
    selector:
      "div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1)",
  },
  {
    kind: "click",
    url: results,
    selector: "ul:nth-of-type(1) > li:nth-of-type(5)",
  },
  { kind: "navigation", url: results },
  {
    kind: "click",
    url: results,
    selector:
      "div:nth-of-type(4) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > h3:nth-of-type(1) > div:nth-of-type(2) > a:nth-of-type(1)",
  },
  { kind: "navigation", url: detail },
];
let markdown = createSkillMarkdown(
  {
    id: EXAMPLE_ID,
    active: false,
    tabId: 0,
    startedAt: "2026-10-28T00:00:00Z",
    actions: actions.map((action, index) => ({
      ...action,
      id: String(index),
      at: "2026-10-28T00:00:00Z",
    })),
  },
  "github-issue-triage",
  "Find public issues by repository, topic, state and label, sort by recent activity, and open a matching issue.",
);
for (const [from, to] of Object.entries({
  text_1: "topic",
  text_2: "repository",
  select_3: "state",
  text_4: "label",
}))
  markdown = markdown.replaceAll(from, to);
markdown = markdown.replace(
  "## Parameters",
  [
    "## Workflow and target meanings",
    "Start on GitHub Advanced search (https://github.com/search/advanced). This built-in example uses public issues and makes no repository changes.",
    "Read each step together with these target meanings; structural selectors are fallback hints.",
    "- Step 2: fill the main Search terms control with {{topic}}.",
    "- Step 3: fill In these repositories with {{repository}} (owner/repository).",
    "- Step 4: set In the state to {{state}}. GitHub's option values are open and closed.",
    "- Step 5: fill With the labels with {{label}}.",
    "- Step 6: submit the advanced-search form using its Search button. Wait for human approval in the extension.",
    "- Steps 8–9: open the Sort by control, then choose Recently updated. Use the visible menu item, not a guessed selector.",
    "- Step 11: open the first actual issue result after sorting. Choose a result link whose sanitized destination matches the next issue-page checkpoint; skip navigation and repository links.",
    "- If no issue result is available, report that and stop. Do not substitute a different repository, broaden the search, or invent an issue.",
    "- Step 12: verify navigation to an issue page. Ask the user to inspect its repository and topic; an origin/path-depth checkpoint alone cannot establish those semantics.",
    "",
    "## Parameters",
  ].join("\n"),
);
export const exampleDraft: CatalogDraft = {
  sourceRecordingId: EXAMPLE_ID,
  name: "GitHub issue triage",
  description:
    "Filter public issues, sort by recent activity, and open a matching issue.",
  markdown,
  readOnly: true,
  dirty: false,
};
