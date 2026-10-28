import {
  createSkillMarkdown,
  parseSkillPlan,
  type Recording,
} from "@show-me-once/shared";
import { safeAgentLabel } from "@show-me-once/shared/agent";
import {
  withMcpInstructions,
  type ExternalResult,
} from "@show-me-once/shared/mcp";

export type CatalogDraft = {
  sourceRecordingId: string;
  name: string;
  description: string;
  markdown: string;
  remoteSkillId?: string;
  readOnly?: boolean;
  savedVersion?: number;
  dirty?: boolean;
};
export const EXAMPLE_ID = "example:wikipedia-search";
const recording: Recording = {
  id: EXAMPLE_ID,
  active: false,
  tabId: 0,
  startedAt: "2026-10-28T00:00:00Z",
  actions: [
    {
      id: "1",
      at: "2026-10-28T00:00:00Z",
      kind: "navigation",
      url: "https://www.wikipedia.org",
    },
    {
      id: "2",
      at: "2026-10-28T00:00:01Z",
      kind: "input",
      url: "https://www.wikipedia.org",
      inputKind: "search",
      selector:
        "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)",
    },
    {
      id: "3",
      at: "2026-10-28T00:00:02Z",
      kind: "click",
      url: "https://www.wikipedia.org",
      selector:
        "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > form:nth-of-type(1) > fieldset:nth-of-type(1) > button:nth-of-type(1)",
    },
    {
      id: "4",
      at: "2026-10-28T00:00:03Z",
      kind: "navigation",
      url: "https://en.wikipedia.org/…/…",
    },
  ],
};
export const exampleDraft: CatalogDraft = {
  sourceRecordingId: EXAMPLE_ID,
  name: "Wikipedia search",
  description: "Search English Wikipedia for a new topic.",
  markdown: createSkillMarkdown(
    recording,
    "wikipedia-search",
    "Search English Wikipedia for a supplied topic.",
  ),
  readOnly: true,
  dirty: false,
};
export function localSkillId(draft: CatalogDraft) {
  return draft.sourceRecordingId === EXAMPLE_ID
    ? EXAMPLE_ID
    : draft.remoteSkillId
      ? `library:${draft.remoteSkillId}`
      : `local:${draft.sourceRecordingId}`;
}
export function keepLocalDraft(saved: CatalogDraft[], draft?: CatalogDraft) {
  if (!draft || draft.remoteSkillId || draft.sourceRecordingId === EXAMPLE_ID)
    return saved;
  return [
    draft,
    ...saved.filter((d) => d.sourceRecordingId !== draft.sourceRecordingId),
  ];
}
type RemoteSkill = {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  currentVersion: number;
  versions: { markdown: string }[];
};
export class SkillCatalog {
  private ports: {
    readLocal(): Promise<{ draft?: CatalogDraft; skills?: CatalogDraft[] }>;
    listLibrary(): Promise<
      { id: string; title: string; description: string }[]
    >;
    getLibrary(id: string): Promise<RemoteSkill>;
    userId(): Promise<string | undefined>;
  };
  constructor(ports: SkillCatalog["ports"]) {
    this.ports = ports;
  }
  async list(): Promise<ExternalResult> {
    const { draft, skills = [] } = await this.ports.readLocal();
    const entries = new Map<
      string,
      NonNullable<ExternalResult["skills"]>[number]
    >();
    for (const value of [exampleDraft, ...skills, ...(draft ? [draft] : [])]) {
      if (value.remoteSkillId) continue; // Cloud access must be checked for the current account.
      try {
        withMcpInstructions(value.markdown);
        const id = localSkillId(value);
        entries.set(id, {
          id,
          name: safeAgentLabel(value.name),
          description: safeAgentLabel(value.description),
          source:
            id === EXAMPLE_ID
              ? "example"
              : value.remoteSkillId
                ? "library"
                : "local",
        });
      } catch {
        /* Invalid drafts stay editable, but are not offered to the agent. */
      }
    }
    let message: string | undefined;
    try {
      for (const value of (await this.ports.listLibrary()).slice(0, 100)) {
        const id = `library:${value.id}`;
        // Keep a selected edited version visible instead of silently replacing it.
        const selected = draft?.remoteSkillId === value.id ? draft : undefined;
        if (!entries.has(id))
          entries.set(id, {
            id,
            name: safeAgentLabel(selected?.name ?? value.title),
            description: safeAgentLabel(
              selected?.description ?? value.description,
            ),
            source: "library",
          });
      }
    } catch {
      message =
        "Cloud library unavailable. Local skills and the example are still available.";
    }
    return {
      status: "ready",
      skills: [...entries.values()].slice(0, 100),
      ...(message ? { message } : {}),
    };
  }
  async get(skillId: string): Promise<ExternalResult> {
    const draft = await this.load(skillId);
    const markdown = withMcpInstructions(draft.markdown);
    return {
      status: "ready",
      skill: {
        id: skillId,
        name: safeAgentLabel(draft.name),
        description: safeAgentLabel(draft.description),
        markdown,
        startUrl: parseSkillPlan(markdown).steps[0]!.url,
      },
    };
  }
  async load(skillId: string): Promise<CatalogDraft> {
    const { draft, skills = [] } = await this.ports.readLocal();
    if (draft && !draft.remoteSkillId && localSkillId(draft) === skillId) {
      withMcpInstructions(draft.markdown);
      return draft;
    }
    if (skillId === EXAMPLE_ID) return { ...exampleDraft };
    const local = skills.find(
      (d) => !d.remoteSkillId && localSkillId(d) === skillId,
    );
    if (local) {
      withMcpInstructions(local.markdown);
      return local;
    }
    if (!skillId.startsWith("library:"))
      throw new Error("Skill not found. Refresh the skills list.");
    const remote = await this.ports.getLibrary(skillId.slice(8));
    if (
      draft?.remoteSkillId === remote.id &&
      draft.dirty &&
      remote.ownerId === (await this.ports.userId())
    ) {
      withMcpInstructions(draft.markdown);
      return draft;
    }
    if (!remote.versions[0]) throw new Error("The skill has no saved version.");
    withMcpInstructions(remote.versions[0].markdown);
    return {
      sourceRecordingId: `library:${remote.id}`,
      remoteSkillId: remote.id,
      name: remote.title,
      description: remote.description,
      markdown: remote.versions[0].markdown,
      readOnly: remote.ownerId !== (await this.ports.userId()),
      savedVersion: remote.currentVersion,
      dirty: false,
    };
  }
}
