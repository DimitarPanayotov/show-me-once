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
import { resolveStartPage, skillBody } from './mcp-start.ts';
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
  ownerId?: string;
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
/** Earlier MCP runs imported the unchanged built-in example as a new local draft. */
export function isExampleRunCopy(draft: CatalogDraft) {
  const body = skillBody(draft.markdown).replace(
    'Wait for human approval in the extension.',
    'Wait for explicit human approval through the coding client or extension.',
  );
  return !draft.remoteSkillId && draft.sourceRecordingId.startsWith('mcp:') &&
    draft.name === exampleDraft.name && draft.description === exampleDraft.description &&
    body === skillBody(exampleDraft.markdown);
}

export function localDraftVisible(draft: CatalogDraft, userId: string | undefined) {
  return !draft.remoteSkillId && !isExampleRunCopy(draft) && draft.ownerId === userId;
}

export function keepLocalDraft(saved: CatalogDraft[], draft?: CatalogDraft) {
  saved = saved.filter(value => !isExampleRunCopy(value));
  if (
    !draft ||
    isExampleRunCopy(draft) ||
    (draft.remoteSkillId && !draft.dirty) ||
    (draft.sourceRecordingId.startsWith("example:") &&
      draft.readOnly &&
      !draft.dirty)
  )
    return saved;
  return [
    draft,
    ...saved.filter((d) => localSkillId(d) !== localSkillId(draft)),
  ];
}

/** Cached cloud edits are recoverable only after fresh authorization as their owner. */
function ownedLibraryDraft(id: string, ownerId: string | undefined, userId: string | undefined, drafts: (CatalogDraft | undefined)[]) {
  if (!userId || ownerId !== userId) return undefined;
  return drafts.find(d => d?.remoteSkillId === id && d.dirty && !d.readOnly && (!d.ownerId || d.ownerId === userId));
}

/** Remove only the exact edit snapshot that was successfully saved, never newer work. */
export function withoutSavedDraft(saved: CatalogDraft[], snapshot: Pick<CatalogDraft, 'remoteSkillId' | 'name' | 'description' | 'markdown'>) {
  if (!snapshot.remoteSkillId) return saved;
  return saved.filter(d => !(d.remoteSkillId === snapshot.remoteSkillId && d.name === snapshot.name && d.description === snapshot.description && d.markdown === snapshot.markdown));
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
      { id: string; title: string; description: string; ownerId?: string }[]
    >;
    getLibrary(id: string): Promise<RemoteSkill>;
    userId(): Promise<string | undefined>;
  };
  constructor(ports: SkillCatalog["ports"]) {
    this.ports = ports;
  }
  async list(): Promise<ExternalResult> {
    const { draft, skills = [] } = await this.ports.readLocal();
    const userId = await this.ports.userId();
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
      if (value !== exampleDraft && !localDraftVisible(value, userId)) continue;
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
        const selected = ownedLibraryDraft(value.id, value.ownerId, userId, [draft, ...skills]);
        if (!entries.has(id))
          entries.set(id, {
            id,
            name: safeAgentLabel(selected?.name ?? value.title),
            description: safeAgentLabel(
              selected?.description ?? value.description,
            ),
            source: "library",
            ...(selected ? { hasLocalEdits: true } : {}),
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
  async load(skillId: string, options: { forEditing?: boolean } = {}): Promise<CatalogDraft> {
    const { draft, skills = [] } = await this.ports.readLocal();
    const userId = await this.ports.userId();
    if (skillId === EXAMPLE_ID && (!draft || localSkillId(draft) !== skillId || (draft.readOnly && !draft.dirty))) return { ...exampleDraft };
    if (draft && localDraftVisible(draft, userId) && localSkillId(draft) === skillId) {
      if (!options.forEditing) withMcpInstructions(draft.markdown);
      return draft;
    }
    if (skillId === EXAMPLE_ID) return { ...exampleDraft };
    const local = skills.find(
      (d) => localDraftVisible(d, userId) && localSkillId(d) === skillId,
    );
    if (local) {
      if (!options.forEditing) withMcpInstructions(local.markdown);
      return local;
    }
    if (!skillId.startsWith("library:"))
      throw new Error("Skill not found. Refresh the skills list.");
    const remote = await this.ports.getLibrary(skillId.slice(8));
    const pending = ownedLibraryDraft(remote.id, remote.ownerId, userId, [draft, ...skills]);
    if (pending) {
      if (!options.forEditing) withMcpInstructions(pending.markdown);
      return { ...pending, ownerId: remote.ownerId };
    }
    if (!remote.versions[0]) throw new Error("The skill has no saved version.");
    if (!options.forEditing) withMcpInstructions(remote.versions[0].markdown);
    return {
      sourceRecordingId: `library:${remote.id}`,
      remoteSkillId: remote.id,
      ownerId: remote.ownerId,
      name: remote.title,
      description: remote.description,
      markdown: remote.versions[0].markdown,
      readOnly: remote.ownerId !== userId,
      savedVersion: remote.currentVersion,
      dirty: false,
    };
  }
}
