---
name: python-docs-search
description: "Search Python documentation for a supplied topic."
---

# Instructions
Start in a browser tab on docs.python.org. Use the supplied parameters for this run. The recorded selectors are hints, not proof that an element is safe to act on.

## Parameters
- `text_1` (string, required): replacement for the text control in step 3.

## Steps
1. **Navigation checkpoint:** Wait for the current tab to match `https://docs.python.org/…/…` (same origin and path depth). Stop if it does not.
2. Find one visible, enabled control at `body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(1)`, verify it is the intended target, then click it.
3. Find one visible text control at `body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(1)`. Set it from `{{text_1}}`; verify the control accepted it locally without logging the value.
4. Find one visible, enabled control at `body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(2)`, verify it is the intended target, then click it.
5. **Navigation checkpoint:** Wait for the current tab to match `https://docs.python.org/…/…` (same origin and path depth). Stop if it does not.

## Checkpoints and safety
- Before every click or input, confirm the target is unique, visible, enabled, and matches the intended action. Stop and ask the user if it does not.
- After each navigation, confirm the expected origin and path depth before continuing. Stop on an unexpected page.
- Obtain explicit user confirmation before any destructive action, purchase, payment, or submission with irreversible effects.
- Never record passwords, secrets, page text, or parameter values in the skill or run log.

## Executable plan
The runner reads this block. Keep it aligned with the instructions when editing the skill.
```json show-me-once
{
  "schemaVersion": 1,
  "parameters": [
    {
      "name": "text_1",
      "type": "string"
    }
  ],
  "steps": [
    {
      "kind": "navigation",
      "url": "https://docs.python.org/…/…"
    },
    {
      "kind": "click",
      "url": "https://docs.python.org/…/…",
      "selector": "body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(1)"
    },
    {
      "kind": "input",
      "url": "https://docs.python.org/…/…",
      "selector": "body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(1)",
      "inputKind": "text",
      "parameter": "text_1"
    },
    {
      "kind": "click",
      "url": "https://docs.python.org/…/…",
      "selector": "body:nth-of-type(1) > div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(2)"
    },
    {
      "kind": "navigation",
      "url": "https://docs.python.org/…/…"
    }
  ]
}
```
