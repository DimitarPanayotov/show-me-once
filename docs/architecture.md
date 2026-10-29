# Architecture

Show Me Once turns a browser demonstration into a reusable skill, then uses an agent to run it with new inputs.

## Components

| Component | Responsibility |
| --- | --- |
| Popup | Recording, skill editing, model settings, progress, approvals and Stop. |
| Content script | Captures safe actions, describes live controls and performs validated interactions. |
| Service worker | Coordinates recording and execution, persists progress and requests model decisions. |
| Backend | Next.js/oRPC API for accounts, skills, versions, sharing, deletion and run history. For API-key execution, forwards model requests to the selected provider. |
| Database | PostgreSQL/Prisma stores users, sessions, skills, versions, shares, runs and step logs. |

The extension uses WXT, TypeScript and Chrome Manifest V3. The web interface uses shadcn/ui and deploys to Vercel.

## Skill format

Generation runs locally without a model. SKILL.md contains name/description frontmatter, readable instructions, parameters, checkpoints and a JSON executable plan.

Typed values become parameters such as `{{text_1}}`. Recorded URLs hide path text and query values. Markdown supports reading and editing; the JSON plan gives the runner a structure it can validate.

## Execution

For each step, the content script describes available controls. The model selects an action using the skill and the new request. The extension checks the selection, executes it and evaluates the next checkpoint. Recorded selectors are hints; live controls must still match.

Progress is persisted in Chrome storage across popup closure and service-worker suspension. Ambiguous targets and uncertain in-flight outcomes pause execution. Protected actions require a fresh approval for that specific action. Stop cancels remaining work; a dispatched action may finish.

## Model access

- **Personal API key:** held in extension session storage and forwarded transiently through the backend to OpenAI or Anthropic.
- **Codex subscription:** Chrome starts an installed native-messaging helper that asks the signed-in Codex CLI for decisions.
- **Optional MCP:** an existing coding agent supplies decisions through the same guarded browser controls.

## Data and limits

Recordings exclude passwords and typed values. The model receives the new request and filtered control descriptions, without raw HTML or screenshots. Persistent logs exclude requests, parameter values and page labels.

Owners can edit, share and delete skills; recipients can read and run them. Edits create versions. Confirmed deletion removes the skill's versions, sharing access and associated run history together.

Human-verification challenges require user input. Navigation checkpoints do not prove that a page contains the intended result. MCP activity stays local; extension-led runs save history to the backend.
