# Architecture

Show Me Once turns one browser demonstration into a reusable skill. The user gives new inputs, and an agent follows the skill in Chrome.

**Record → generate SKILL.md → save → enter a request → Run.**

## What runs where

| Part | Job |
| --- | --- |
| **Popup** | The interface for recording, editing, saving and running skills. Shows progress and approval, Pause and Stop controls. |
| **Content script** | Runs inside the webpage. Records actions, describes available controls and performs clicks and inputs. |
| **Service worker** | Coordinates the task in the background: saves progress, asks the model for the next action, checks it and updates history. |
| **Backend** | Next.js and oRPC on Vercel. Handles login, skill access, versions, sharing and run history. |
| **Database** | PostgreSQL through Prisma. Stores users, sessions, skills, versions, shares, runs and step logs. |

The extension uses TypeScript, WXT and Chrome Manifest V3. The web interface uses shadcn/ui.

## The skill file

The recorder stores actions without typed values or passwords. Recorded URLs hide path text and query values. Local code turns the recording into a skill; generation does not need a model.

**SKILL.md** contains a `name` and `description` at the top, readable instructions, parameters, page checkpoints, safety rules and a JSON block of executable steps.

For example, a search field becomes `{{text_1}}`, which accepts a different search each run. Markdown makes the skill easy to read, edit and share. JSON gives the extension a clear structure to check and execute. Both describe the same task.

## Running the skill

The user selects a skill, types a new request and clicks **Run**. New or edited owned skills are saved first, so history refers to a specific version.

For each step, the content script describes the current controls. The model chooses an action using the skill and request. The extension checks the choice, performs it and checks the next page or step. Recorded selectors are hints, helping the agent handle small page changes.

Safe steps continue automatically. Unclear targets pause the run. Protected actions show exactly what needs approval; approval covers that action only. **Stop** cancels further work, although an action already sent may finish.

Progress is saved in Chrome storage. Closing the popup does not stop the run. An interrupted action with an uncertain outcome pauses for review.

## Model access

Users supply either:

- **An OpenAI or Anthropic API key.** Kept for the Chrome session and passed through the backend to the provider when needed. The backend does not save it.
- **A Codex subscription.** A helper installed once lets Chrome ask the signed-in Codex CLI for decisions. Chrome starts it automatically; the extension performs the browser actions. Requires Node.js 24 and Codex sign-in.

Loading the extension and logging in alone does not provide model access.

Optional **MCP integration** lets an existing coding agent run skills instead. After one-time setup and pairing, it opens the task page automatically. Supported clients also show approvals inside the coding agent.

## Privacy and limits

The model receives the new request, skill and filtered control descriptions. It does not receive recorded input values, raw HTML or screenshots. Saved logs leave out requests, parameter values and page labels.

Owners control editing and sharing; recipients can read and run. Edits create new saved versions. Local drafts are kept separate when accounts change.

Human-verification checks need the user. Page checkpoints cannot prove the correct issue or article opened. MCP run history currently stays local; runs started inside the extension save history to the backend.

See [verification notes](verification.md) for test results.
