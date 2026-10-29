# Show Me Once

Turn a browser task into a reusable skill from one demonstration.

Record the task, save the generated SKILL.md, then describe what to do with new inputs and click **Run**. The agent follows the skill, shows its progress, and pauses for protected actions. You can pause or stop it at any time.

[Live app](https://show-me-once-dimitar.vercel.app) · [Demo](https://drive.google.com/drive/folders/1G-dQTsi6W9gPskKOihy5F-TK0WyOhbFq?usp=sharing) · [Download](https://github.com/DimitarPanayotov/show-me-once/releases/latest) · [Setup](docs/setup.md) · [Architecture](docs/architecture.md)

## Features

- Record clicks, inputs and navigation without storing typed values.
- Generate editable skills with parameters and page checkpoints.
- Save, version, share and delete skills in the web library.
- Run tasks inside the extension using your own OpenAI/Anthropic API key or Codex subscription.
- Connect an existing coding agent through optional [MCP integration](docs/mcp.md).

## Getting started

1. Download and extract the bundle. Load its `extension` folder through **chrome://extensions → Developer mode → Load unpacked**.
2. Open Show Me Once and sign in.
3. Choose model access under **Agent settings**. API keys are session-only; Codex subscriptions require a one-time helper installation.
4. Open a task's starting page, record it, then save the generated skill. Enter a new request and click **Run**.

See [setup](docs/setup.md) for model configuration.

## Privacy and limits

The recorder excludes passwords and typed values. Skills contain parameter names and sanitized page checkpoints. The model receives your new request and filtered control descriptions; saved run logs exclude parameter values and page text.

Protected actions require explicit approval. Ambiguous targets and uncertain outcomes pause the run. Human-verification challenges require user input. An action already dispatched may finish after Stop.

## Development

TypeScript monorepo with WXT/Chrome MV3, Next.js/shadcn/ui, oRPC and PostgreSQL/Prisma. The web app deploys to Vercel.

See [local development](docs/development.md) for setup, build and test commands, and [example skills](examples/README.md) for saved workflows.
