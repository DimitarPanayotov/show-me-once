---
name: wikipedia-search
description: "Search Wikipedia for a supplied topic."
---

# Instructions
Start in a browser tab on www.wikipedia.org. Use the supplied parameters for this run. The recorded selectors are hints, not proof that an element is safe to act on.

## Parameters
- `search_1` (string, required): replacement for the search control in step 3.

## Steps
1. **Navigation checkpoint:** Wait for the current tab to match `https://www.wikipedia.org` (same origin and path depth). Stop if it does not.
2. Find one visible, enabled control at `body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)`, verify it is the intended target, then click it.
3. Find one visible search control at `body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)`. Set it from `{{search_1}}`; verify the control accepted it locally without logging the value.
4. Find one visible, enabled control at `body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > button:nth-of-type(1)`, verify it is the intended target, then click it.
5. **Navigation checkpoint:** Wait for the current tab to match `https://en.wikipedia.org/…/…` (same origin and path depth). Stop if it does not.

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
      "name": "search_1",
      "type": "string"
    }
  ],
  "steps": [
    {
      "kind": "navigation",
      "url": "https://www.wikipedia.org"
    },
    {
      "kind": "click",
      "url": "https://www.wikipedia.org",
      "selector": "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)"
    },
    {
      "kind": "input",
      "url": "https://www.wikipedia.org",
      "selector": "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)",
      "inputKind": "search",
      "parameter": "search_1"
    },
    {
      "kind": "click",
      "url": "https://www.wikipedia.org",
      "selector": "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > button:nth-of-type(1)"
    },
    {
      "kind": "navigation",
      "url": "https://en.wikipedia.org/…/…"
    }
  ]
}
```
