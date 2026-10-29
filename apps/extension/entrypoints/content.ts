import { browser } from "wxt/browser";
import {
  permittedDestination,
  permittedFormDestination,
} from "@show-me-once/shared/mcp";
import {
  sanitizeUrl,
  structuralSelector,
  type SkillStep,
} from "@show-me-once/shared";
import {
  confirmationIntent,
  controlLabel,
  type ConfirmationDetails,
} from "../lib/confirmation";
import {
  safeAgentLabel,
  type AgentObservation,
} from "@show-me-once/shared/agent";

function isSensitive(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.isContentEditable || element.closest('[contenteditable="true"]'))
    return true;
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  )
    return false;
  const attributes = [
    element.getAttribute("type"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
  ]
    .join(" ")
    .toLowerCase();
  return /password|passwd|secret|token|otp|one.time|auth|credit|card|cvc|cvv|ssn|private|key|pin|hidden|email|tel|phone/.test(
    attributes,
  );
}

function formFor(target: HTMLElement): HTMLFormElement | null {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
    return target.form;
  return target.closest("form");
}
function formDestination(target: HTMLElement, form: HTMLFormElement): string {
  return (target instanceof HTMLButtonElement ||
    target instanceof HTMLInputElement) &&
    target.hasAttribute("formaction")
    ? target.formAction
    : form.action;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  main(ctx) {
    let active = false;
    let lastLocation = location.href;
    let lastPointer: {
      target: Element;
      selector: string;
      id: string;
      at: number;
    } | null = null;
    let inputSessions = new WeakMap<Element, { id: string; sent: boolean }>();
    let stateRevision = 0;
    let pendingApproval: {
      target: HTMLElement;
      signature: string;
      details: ConfirmationDetails;
    } | null = null;
    let agentSnapshot: {
      observation: AgentObservation;
      targets: Map<string, { element: HTMLElement; fingerprint: string }>;
    } | null = null;

    function agentLabel(target: HTMLElement): string {
      const field =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      return safeAgentLabel(
        target.getAttribute("aria-label") ||
          (target.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .slice(0, 4)
            .map((id) => {
              const label = document.getElementById(id);
              return label &&
                !label.matches("input,textarea,select,[contenteditable]")
                ? (label.textContent?.slice(0, 160) ?? "")
                : "";
            })
            .join(" ")
            .trim() ||
          target.getAttribute("title") ||
          (field
            ? [...(target.labels ?? [])]
                .map((label) => label.textContent)
                .join(" ") ||
              target.getAttribute("placeholder") ||
              ""
            : target.innerText || ""),
      );
    }

    function fingerprint(target: HTMLElement) {
      return JSON.stringify([
        target.tagName,
        target.getAttribute("type"),
        agentLabel(target),
        target.closest("form")?.getAttribute("action"),
        target.getAttribute("href"),
      ]);
    }

    function needsHumanVerification(): boolean {
      return (
        /(?:^|\/)(?:verify_human|captcha|challenge)(?:\/|$)/i.test(
          location.pathname,
        ) ||
        /verify (?:you are|you're|that you are) human|human verification|just a moment|security check/i.test(
          document.title,
        ) ||
        [
          ...document.querySelectorAll(
            'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]',
          ),
        ].some(
          (frame) =>
            frame instanceof HTMLElement &&
            frame.getClientRects().length > 0 &&
            getComputedStyle(frame).visibility !== "hidden",
        )
      );
    }

    function scopedTarget(target: HTMLElement, scope?: string[]): boolean {
      if (!scope) return true;
      const anchor = target.closest("a[href]");
      if (
        anchor instanceof HTMLAnchorElement &&
        !permittedDestination(anchor.href, scope)
      )
        return false;
      const form = formFor(target);
      if (
        form instanceof HTMLFormElement &&
        target.matches(
          'button[type="submit"],button:not([type]),input[type="submit"]',
        ) &&
        !permittedFormDestination(
          formDestination(target, form),
          scope,
          location.href,
        )
      )
        return false;
      return true;
    }

    function clearableSearchFilter(target: HTMLElement): boolean {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) ||
        target.required || (target instanceof HTMLInputElement && (target.readOnly || !['text', 'search'].includes(target.type)))) return false;
      const form = formFor(target);
      if (!form || form.method.toLowerCase() !== 'get') return false;
      return form.getAttribute('role') === 'search' || /(?:^|\/)(?:search|find|filter)(?:\/|$)/i.test(new URL(form.action).pathname) ||
        !!form.querySelector('input[type="search"],input[name="q"],input[name="query"],input[name="search"]');
    }

    function matchingParameters(target: HTMLElement, parameters: Record<string, string | boolean>): string[] {
      if (!(target instanceof HTMLAnchorElement)) return [];
      try {
        const path = new URL(target.href).pathname.split('/').filter(Boolean).map(decodeURIComponent);
        return Object.entries(parameters).slice(0, 30).filter(([, value]) => {
          if (typeof value !== 'string' || !/^[a-zA-Z0-9_.~-]+(?:\/[a-zA-Z0-9_.~-]+){1,7}$/.test(value)) return false;
          const parts = value.split('/');
          return parts.every(part => part !== '.' && part !== '..') &&
            path.slice(0, parts.length).join('/').toLowerCase() === value.toLowerCase();
        }).map(([name]) => name);
      } catch { return []; }
    }

    function observeAgent(
      step: SkillStep,
      navigationScope?: string[],
      parameters: Record<string, string | boolean> = {},
    ): AgentObservation {
      const observation: AgentObservation = {
        id: crypto.randomUUID(),
        url: sanitizeUrl(location.href)!,
        controls: [],
      };
      const targets = new Map<
        string,
        { element: HTMLElement; fingerprint: string }
      >();
      if (observation.url !== step.url) return observation;
      const hintMatches =
        step.kind !== "navigation"
          ? [...document.querySelectorAll(step.selector)]
          : [];
      const hintedTag =
        step.kind !== "navigation"
          ? step.selector.split(" > ").at(-1)?.split(":")[0]
          : "";
      const candidates = [
        ...document.querySelectorAll(
          'input,textarea,select,button,a,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="link"]',
        ),
      ]
        .filter(usable)
        .filter((target) => scopedTarget(target, navigationScope))
        .filter(
          (target) =>
            !formFor(target)?.querySelector(
              'input[type="password"],input[autocomplete^="cc-"]',
            ),
        )
        .sort((a, b) => {
          const rank = (el: HTMLElement) =>
            matchingParameters(el, parameters).length && el.closest('h1,h2,h3,h4,h5,h6')
              ? -1
              : hintMatches.includes(el)
              ? 0
              : el.tagName.toLowerCase() === hintedTag
                ? 1
                : el.matches(
                      'input,textarea,select,button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
                    )
                  ? 2
                  : 3;
          return rank(a) - rank(b);
        });
      for (const target of candidates) {
        if (observation.controls.length >= 60) break;
        if (
          target instanceof HTMLInputElement &&
          !["text", "search", "checkbox", "radio", "submit", "button"].includes(
            target.type,
          )
        )
          continue;
        const label = agentLabel(target);
        if (label.includes("[redacted]")) continue;
        const role = target.matches(
          'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],input[type="submit"],input[type="button"]',
        )
          ? "button"
          : target.matches('a,[role="link"]')
            ? "link"
            : target instanceof HTMLSelectElement
              ? "select"
              : "input";
        const id = `c${observation.controls.length + 1}`;
        const heading = role === 'link' ? target.closest('h1,h2,h3,h4,h5,h6') : null;
        const matches = matchingParameters(target, parameters);
        observation.controls.push({
          id,
          role,
          label,
          selector: structuralSelector(target),
          ...(clearableSearchFilter(target) ? { clearable: true } : {}),
          ...(heading ? { headingLevel: Number(heading.tagName[1]) } : {}),
          ...(matches.length ? { matchesParameters: matches } : {}),
          ...(target instanceof HTMLAnchorElement && sanitizeUrl(target.href)
            ? { destination: sanitizeUrl(target.href)! }
            : {}),
          ...(role === "input"
            ? {
                inputKind:
                  target instanceof HTMLInputElement ? target.type : "text",
              }
            : role === "select"
              ? { inputKind: "select" }
              : {}),
        });
        targets.set(id, { element: target, fingerprint: fingerprint(target) });
      }
      agentSnapshot = { observation, targets };
      return observation;
    }

    function usable(element: Element): element is HTMLElement {
      if (!(element instanceof HTMLElement) || isSensitive(element))
        return false;
      if (element instanceof HTMLInputElement && element.disabled) return false;
      if (element instanceof HTMLButtonElement && element.disabled)
        return false;
      if (element instanceof HTMLSelectElement && element.disabled)
        return false;
      if (element instanceof HTMLTextAreaElement && element.disabled)
        return false;
      if (element.getAttribute("aria-disabled") === "true") return false;
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    }

    function executeStep(
      step: SkillStep,
      value: unknown,
      confirmed: boolean,
      approvalToken?: string,
      previewOnly = false,
      executionKey?: string,
      resolvedTarget?: HTMLElement,
    ): {
      status: "done" | "blocked" | "confirmation-required";
      confirmation?: ConfirmationDetails;
    } {
      if (sanitizeUrl(location.href) !== step.url || step.kind === "navigation")
        return { status: "blocked" };
      const matches = [...document.querySelectorAll(step.selector)].filter(
        usable,
      );
      let target: HTMLElement | undefined;
      if (resolvedTarget) {
        if (usable(resolvedTarget) && resolvedTarget.isConnected)
          target = resolvedTarget;
      } else if (step.kind === "click" && step.parameter) {
        if (typeof value !== "string" || !value.trim())
          return { status: "blocked" };
        const wanted = value.trim().toLocaleLowerCase();
        const named = [
          ...document.querySelectorAll(
            'a,button,[role="link"],[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
          ),
        ]
          .filter(usable)
          .filter(
            (element) =>
              (element.getAttribute("aria-label") || element.innerText)
                .trim()
                .toLocaleLowerCase() === wanted,
          );
        if (named.length > 1) return { status: "blocked" };
        if (named.length === 1) target = named[0];
        else if (named.length === 0) {
          const partial = [
            ...document.querySelectorAll(
              'a,button,[role="link"],[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
            ),
          ]
            .filter(usable)
            .filter((element) =>
              (element.getAttribute("aria-label") || element.innerText)
                .trim()
                .toLocaleLowerCase()
                .includes(wanted),
            );
          if (partial.length > 1) return { status: "blocked" };
          if (partial.length === 1) target = partial[0];
        }
        if (!target && matches.length === 1) {
          const label = (
            matches[0]!.getAttribute("aria-label") || matches[0]!.innerText
          )
            .trim()
            .toLocaleLowerCase();
          if (label.includes(wanted)) target = matches[0];
        }
      } else if (matches.length === 1) {
        target = matches[0];
      }
      if (!target) return { status: "blocked" };

      if (step.kind === "click" || step.kind === "key") {
        const form = formFor(target);
        const label = `${target.getAttribute("aria-label") ?? ""} ${target.getAttribute("title") ?? ""} ${target.innerText ?? ""}`;
        const destination =
          target instanceof HTMLAnchorElement
            ? target.href
            : form instanceof HTMLFormElement
              ? formDestination(target, form)
              : "";
        const submits =
          (target instanceof HTMLButtonElement ||
            target instanceof HTMLInputElement) &&
          target.type === "submit";
        const search = !!(
          /\b(search|find|filter|query)\b/i.test(label) ||
          (target instanceof HTMLInputElement &&
            /search|query|filter/i.test(
              `${target.type} ${target.name} ${target.id} ${target.placeholder}`,
            )) ||
          (form &&
            (form.getAttribute("role") === "search" ||
              form.querySelector(
                'input[type="search"],input[name="search"],input[name="q"],input[name="query"],input[name="title"]',
              ) ||
              /\/search\b/i.test(form.action)))
        );
        const intent = confirmationIntent({
          label,
          destination,
          submits,
          search,
          enter: step.kind === "key",
          navigationLink: step.kind === 'click' && target instanceof HTMLAnchorElement &&
            ['http:', 'https:'].includes(target.protocol) && !!target.closest('h1,h2,h3,h4,h5,h6') &&
            !form && [null, 'link'].includes(target.getAttribute('role')) &&
            !['onclick', 'download', 'data-method', 'data-turbo-method', 'formaction'].some(attribute => target.hasAttribute(attribute)),
        });
        if (intent) {
          const inputLabel =
            target instanceof HTMLInputElement
              ? [...(target.labels ?? [])]
                  .map((item) => item.textContent)
                  .join(" ") || target.placeholder
              : "";
          const targetLabel = controlLabel(
            target.getAttribute("aria-label") ||
              target.innerText ||
              target.getAttribute("title") ||
              inputLabel ||
              (submits && target instanceof HTMLInputElement
                ? target.value
                : "") ||
              "",
          );
          const destinationOrigin =
            form instanceof HTMLFormElement &&
            /^https?:$/.test(new URL(formDestination(target, form)).protocol)
              ? new URL(formDestination(target, form)).origin
              : undefined;
          // Bind consent to the live element and its meaning. A changed/replaced target requires new approval.
          const signature = JSON.stringify({
            executionKey,
            step,
            intent,
            targetLabel,
            destination,
            action: form ? formDestination(target, form) : undefined,
            method: form?.method,
            type: target.getAttribute("type"),
          });
          const sameTarget =
            pendingApproval?.target === target &&
            pendingApproval.signature === signature;
          if (
            !confirmed ||
            !sameTarget ||
            approvalToken !== pendingApproval?.details.token
          ) {
            if (!sameTarget)
              pendingApproval = {
                target,
                signature,
                details: {
                  token: crypto.randomUUID(),
                  intent,
                  interaction: step.kind === "key" ? "enter" : "click",
                  targetLabel,
                  targetTag:
                    target instanceof HTMLButtonElement
                      ? "button"
                      : target instanceof HTMLInputElement
                        ? "input"
                        : target instanceof HTMLAnchorElement
                          ? "link"
                          : "control",
                  origin: location.origin,
                  ...(destinationOrigin ? { destinationOrigin } : {}),
                  ...(confirmed ? { changed: true } : {}),
                },
              };
            target.scrollIntoView({ block: "center", behavior: "instant" });
            return {
              status: "confirmation-required",
              confirmation: pendingApproval!.details,
            };
          }
        } else if (confirmed || previewOnly) return { status: "blocked" };
      }
      // Rebuilding a missing preview must never dispatch a browser action.
      if (previewOnly) return { status: "blocked" };
      pendingApproval = null;

      if (step.kind === "click") {
        ctx.setTimeout(() => {
          if (ctx.isValid) target.click();
        }, 0);
        return { status: "done" };
      }

      if (step.kind === "key") {
        if (!(target instanceof HTMLInputElement) || step.key !== "Enter")
          return { status: "blocked" };
        if (!confirmed) return { status: "confirmation-required" };
        ctx.setTimeout(() => {
          if (!ctx.isValid) return;
          const form = formFor(target);
          if (form instanceof HTMLFormElement) form.requestSubmit();
          else {
            target.focus();
            target.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
              }),
            );
            target.dispatchEvent(
              new KeyboardEvent("keyup", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
              }),
            );
          }
        }, 0);
        return { status: "done" };
      }

      if (step.inputKind === "checkbox" || step.inputKind === "radio") {
        if (
          !(target instanceof HTMLInputElement) ||
          target.type !== step.inputKind ||
          typeof value !== "boolean"
        )
          return { status: "blocked" };
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "checked",
        )?.set;
        setter?.call(target, value);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { status: target.checked === value ? "done" : "blocked" };
      }
      if (typeof value !== "string") return { status: "blocked" };
      if (value === '' && !clearableSearchFilter(target)) return { status: 'blocked' };
      if (step.inputKind === "select") {
        if (
          !(target instanceof HTMLSelectElement) ||
          ![...target.options].some((option) => option.value === value)
        )
          return { status: "blocked" };
        target.value = value;
      } else {
        if (
          !(
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          )
        )
          return { status: "blocked" };
        const prototype =
          target instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
          target,
          value,
        );
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { status: target.value === value ? "done" : "blocked" };
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.recording) {
        const nextActive = !!(
          changes.recording.newValue as { active?: boolean } | undefined
        )?.active;
        if (nextActive && !active) inputSessions = new WeakMap();
        active = nextActive;
        stateRevision++;
      }
    });

    browser.runtime.onMessage.addListener(
      (message: unknown, _sender, sendResponse) => {
        if (!message || typeof message !== "object") return;
        if (
          [
            "observe-agent-page",
            "execute-agent-action",
            "execute-skill-step",
          ].includes((message as { type?: string }).type ?? "")
        )
          trackNavigation();
        if ((message as { type?: string }).type === "recorder-ping") {
          sendResponse(true);
          return;
        }
        if ((message as { type?: string }).type === "execute-skill-step") {
          const request = message as {
            step?: SkillStep;
            value?: unknown;
            confirmed?: boolean;
            approvalToken?: string;
            previewOnly?: boolean;
            executionKey?: string;
          };
          sendResponse(
            request.step
              ? executeStep(
                  request.step,
                  request.value,
                  request.confirmed === true,
                  request.approvalToken,
                  request.previewOnly === true,
                  request.executionKey,
                )
              : { status: "blocked" },
          );
          return;
        }
        if ((message as { type?: string }).type === "observe-agent-page") {
          const request = message as {
            step: SkillStep;
            navigationScope?: string[];
            parameters?: Record<string, string | boolean>;
          };
          sendResponse(observeAgent(request.step, request.navigationScope, request.parameters));
          return;
        }
        if ((message as { type?: string }).type === "check-run-page") {
          const connectionError =
            /^(?:Hmm(?:\.{3}|…)?|Service Unavailable|403 Forbidden|404 Not Found|502 Bad Gateway|503 Service Unavailable)$/i.test(
              document.title.trim(),
            ) || !!document.querySelector("#main-frame-error,body.neterror");
          sendResponse({
            humanVerification: needsHumanVerification(),
            connectionError,
          });
          return;
        }
        if ((message as { type?: string }).type === "execute-agent-action") {
          const request = message as {
            observationId: string;
            targetId: string;
            step: SkillStep;
            value?: unknown;
            confirmed?: boolean;
            approvalToken?: string;
            executionKey?: string;
            previewOnly?: boolean;
            navigationScope?: string[];
          };
          const snapshot = agentSnapshot;
          const matched =
            snapshot?.observation.id === request.observationId
              ? snapshot.targets.get(request.targetId)
              : undefined;
          if (
            !matched ||
            !matched.element.isConnected ||
            !usable(matched.element) ||
            fingerprint(matched.element) !== matched.fingerprint
          ) {
            sendResponse({ status: "blocked" });
            return;
          }
          if (!scopedTarget(matched.element, request.navigationScope)) {
            sendResponse({ status: "blocked" });
            return;
          }
          if (request.step.kind === "key" && request.navigationScope) {
            const form = formFor(matched.element);
            if (
              form instanceof HTMLFormElement &&
              !permittedFormDestination(
                form.action,
                request.navigationScope,
                location.href,
              )
            ) {
              sendResponse({ status: "blocked" });
              return;
            }
          }
          const step = {
            ...request.step,
            ...(request.step.kind !== "navigation"
              ? { selector: structuralSelector(matched.element) }
              : {}),
          };
          if (step.kind === "click") delete step.parameter;
          if (step.kind === "input") {
            const currentType =
              matched.element instanceof HTMLInputElement
                ? matched.element.type
                : matched.element instanceof HTMLSelectElement
                  ? "select"
                  : "text";
            if (
              ["checkbox", "radio", "select"].includes(step.inputKind)
                ? currentType !== step.inputKind
                : !["text", "search"].includes(currentType)
            ) {
              sendResponse({ status: "blocked" });
              return;
            }
          }
          sendResponse(
            executeStep(
              step,
              request.value,
              request.confirmed === true,
              request.approvalToken,
              request.previewOnly === true,
              request.executionKey,
              matched.element,
            ),
          );
          return;
        }
        if ((message as { type?: string }).type === "recording-state") {
          const nextActive = !!(message as { active?: boolean }).active;
          if (nextActive && !active) inputSessions = new WeakMap();
          active = nextActive;
          stateRevision++;
        }
      },
    );

    function send(action: Record<string, unknown>, eventId?: string) {
      if (!active) return;
      void browser.runtime
        .sendMessage({
          type: "record-action",
          eventId,
          action: { ...action, url: location.href },
        })
        .catch(() => undefined);
    }

    function clickTarget(target: EventTarget | null): Element | null {
      if (!(target instanceof Element)) return null;
      const interactive = target.closest(
        'a,button,input,select,textarea,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="link"]',
      );
      if (!interactive || isSensitive(interactive)) return null;
      return interactive;
    }

    function recordInput(
      target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    ) {
      if (!active || isSensitive(target)) return;
      const session = inputSessions.get(target) ?? {
        id: crypto.randomUUID(),
        sent: false,
      };
      if (session.sent) return;
      session.sent = true;
      inputSessions.set(target, session);
      let inputKind: "text" | "search" | "checkbox" | "radio" | "select" =
        "text";
      if (target instanceof HTMLSelectElement) inputKind = "select";
      else if (target instanceof HTMLInputElement) {
        if (target.type === "checkbox") inputKind = "checkbox";
        else if (target.type === "radio") inputKind = "radio";
        else if (target.type === "search") inputKind = "search";
      }
      send(
        {
          kind: "input",
          selector: structuralSelector(target),
          inputKind,
          ...(inputKind === "checkbox" || inputKind === "radio"
            ? { checked: (target as HTMLInputElement).checked }
            : {}),
        },
        session.id,
      );
    }

    ctx.addEventListener(
      document,
      "focusin",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          inputSessions.set(target, { id: crypto.randomUUID(), sent: false });
        }
      },
      true,
    );

    ctx.addEventListener(
      document,
      "input",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
          recordInput(target);
      },
      true,
    );

    ctx.addEventListener(
      document,
      "pointerdown",
      (event) => {
        if (!(event instanceof PointerEvent) || event.button !== 0) return;
        const target = clickTarget(event.target);
        if (!target) return;
        const selector = structuralSelector(target);
        const id = crypto.randomUUID();
        lastPointer = { target, selector, id, at: Date.now() };
        send({ kind: "click", selector }, id);
      },
      true,
    );

    ctx.addEventListener(
      document,
      "click",
      (event) => {
        const pointer = lastPointer;
        lastPointer = null;
        const target = clickTarget(event.target);
        if (!target) return;
        const selector = structuralSelector(target);
        const elapsed = pointer ? Date.now() - pointer.at : Infinity;
        // React portals can move the same menu element between pointerdown and click.
        // Keep its original gesture identity and selector; never serialize the DOM reference.
        const sameGesture =
          pointer &&
          elapsed >= 0 &&
          elapsed < 1500 &&
          (pointer.target === target || pointer.selector === selector);
        send(
          {
            kind: "click",
            selector: sameGesture ? pointer.selector : selector,
          },
          sameGesture ? pointer.id : crypto.randomUUID(),
        );
      },
      true,
    );

    ctx.addEventListener(
      document,
      "change",
      (event) => {
        const target = event.target;
        if (
          !(
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement
          )
        )
          return;
        recordInput(target);
      },
      true,
    );

    ctx.addEventListener(
      document,
      "keydown",
      (event) => {
        if (
          !(event instanceof KeyboardEvent) ||
          event.key !== "Enter" ||
          event.repeat ||
          event.isComposing
        )
          return;
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || isSensitive(target))
          return;
        recordInput(target);
        send(
          { kind: "key", key: "Enter", selector: structuralSelector(target) },
          crypto.randomUUID(),
        );
      },
      true,
    );

    function trackNavigation() {
      if (location.href === lastLocation) return;
      lastLocation = location.href;
      agentSnapshot = null;
      pendingApproval = null;
      send({ kind: "navigation" });
      void browser.runtime
        .sendMessage({ type: "run-navigation" })
        .catch(() => undefined);
    }
    ctx.setInterval(trackNavigation, 500);

    // Never delay event listeners while a dormant service worker wakes up.
    const revisionAtRequest = stateRevision;
    void browser.runtime
      .sendMessage({ type: "get-recording-status" })
      .then((status: { active?: boolean } | null) => {
        if (stateRevision === revisionAtRequest) active = !!status?.active;
      })
      .catch(() => undefined);
  },
});
