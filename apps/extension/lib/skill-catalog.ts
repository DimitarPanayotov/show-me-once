import {
  EXAMPLE_ID,
  exampleDraft,
} from "./example-skill.ts";
export {
  EXAMPLE_ID,
  EXAMPLE_START_URL,
  EXAMPLE_REQUEST,
  EXAMPLE_ALTERNATIVE_REQUEST,
  EXAMPLE_STEP_LABELS,
  exampleDraft,
} from "./example-skill.ts";
import { safeAgentLabel } from "@show-me-once/shared/agent";
import { resolveStartPage } from './mcp-start.ts';
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
export function localSkillId(draft: CatalogDraft) {
  return draft.remoteSkillId
    ? `library:${draft.remoteSkillId}`
    : draft.sourceRecordingId === EXAMPLE_ID
      ? EXAMPLE_ID
      : `local:${draft.sourceRecordingId}`;
}
export function keepLocalDraft(saved: CatalogDraft[], draft?: CatalogDraft) {
  if (
    !draft ||
    draft.remoteSkillId ||
    (draft.sourceRecordingId.startsWith("example:") &&
      draft.readOnly &&
      !draft.dirty)
  )
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
      if (
        value.sourceRecordingId === "example:wikipedia-search" &&
        value.readOnly &&
        !value.dirty
      )
        continue;
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
        startUrl: (() => { try { return resolveStartPage(markdown); } catch { return ''; } })(),
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
