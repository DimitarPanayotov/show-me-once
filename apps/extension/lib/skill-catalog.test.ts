import test from "node:test";
import assert from "node:assert/strict";
import {
  SkillCatalog,
  EXAMPLE_ID,
  exampleDraft,
  keepLocalDraft,
  withoutSavedDraft,
  localSkillId,
  type CatalogDraft,
} from "./skill-catalog.ts";
import { parseSkillPlan } from "@show-me-once/shared";

function fixture() {
  let draft: CatalogDraft | undefined,
    skills: CatalogDraft[] = [],
    authorized = false;
  const catalog = new SkillCatalog({
    readLocal: async () => ({ draft, skills }),
    listLibrary: async () =>
      authorized
        ? [{ id: "cloud", title: "Shared search", description: "Search" }]
        : [],
    getLibrary: async () => {
      if (!authorized) throw new Error("Sign in to the library first.");
      return {
        id: "cloud",
        title: "Shared search",
        description: "Search",
        ownerId: "other",
        currentVersion: 2,
        versions: [{ markdown: exampleDraft.markdown }],
      };
    },
    userId: async () => (authorized ? "me" : undefined),
  });
  return {
    catalog,
    setDraft: (v: CatalogDraft) => {
      draft = v;
    },
    setSkills: (v: CatalogDraft[]) => {
      skills = v;
    },
    signIn: (v: boolean) => {
      authorized = v;
    },
  };
}
test("a new reviewer can discover and read a valid parameterized example without any account or installed skill file", async () => {
  const f = fixture();
  const listed = await f.catalog.list();
  assert.deepEqual(
    listed.skills?.map((s) => s.id),
    [EXAMPLE_ID],
  );
  const result = await f.catalog.get(EXAMPLE_ID);
  assert.equal(result.skill?.startUrl, "https://github.com/search/advanced");
  assert.deepEqual(parseSkillPlan(result.skill!.markdown).parameters, [
    { name: "topic", type: "string" },
    { name: "repository", type: "string" },
    { name: "state", type: "string" },
    { name: "label", type: "string" },
  ]);
  assert.match(result.skill!.markdown, /show-me-once-mcp/);
  assert.equal(parseSkillPlan(result.skill!.markdown).steps.length, 12);
  assert.doesNotMatch(
    result.skill!.markdown,
    /microsoft\/vscode|terminal|microsoft\/TypeScript/,
  );
});
test("recorded drafts are immediately discoverable, and switching tasks preserves local edits", async () => {
  const f = fixture();
  const original = {
    ...exampleDraft,
    sourceRecordingId: "recorded-1",
    name: "My edited name",
    readOnly: false,
    dirty: true,
  };
  const saved = keepLocalDraft([], original);
  f.setSkills(saved);
  f.setDraft({ ...original, name: "Latest edited name" });
  const result = await f.catalog.list();
  assert.equal(
    result.skills?.filter((s) => s.id === localSkillId(original)).length,
    1,
  );
  assert.equal(
    result.skills?.find((s) => s.id === localSkillId(original))?.name,
    "Latest edited name",
  );
  assert.equal(
    (await f.catalog.get(localSkillId(original))).skill?.name,
    "Latest edited name",
  );
  assert.equal(saved[0]?.name, "My edited name");
  assert.equal(
    keepLocalDraft(saved, { ...original, markdown: "Unfinished local edit" })[0]
      ?.markdown,
    "Unfinished local edit",
  );
});
test("cloud access is reauthorized after logout and hidden from other accounts even if a skill was previously open", async () => {
  const f = fixture();
  f.signIn(true);
  const cloud = await f.catalog.load("library:cloud");
  assert.equal(cloud.readOnly, true);
  f.setDraft(cloud);
  assert.ok(
    (await f.catalog.list()).skills?.some((s) => s.id === "library:cloud"),
  );
  f.signIn(false);
  assert.equal(
    (await f.catalog.list()).skills?.some((s) => s.id === "library:cloud"),
    false,
  );
  await assert.rejects(f.catalog.get("library:cloud"), /Sign in/);
});
test("invalid or secret-containing instructions stay local and cannot be sent to the agent", async () => {
  const f = fixture();
  f.setDraft({
    ...exampleDraft,
    sourceRecordingId: "private",
    markdown: "invalid skill",
    dirty: true,
  });
  assert.equal(
    (await f.catalog.list()).skills?.some((s) => s.id === "local:private"),
    false,
  );
  await assert.rejects(f.catalog.get("local:private"));
  f.setDraft({
    ...exampleDraft,
    sourceRecordingId: "private",
    markdown: exampleDraft.markdown + "\napi_key=sk-abcdefghijk123456789",
  });
  assert.equal(
    (await f.catalog.list()).skills?.some((s) => s.id === "local:private"),
    false,
  );
  await assert.rejects(f.catalog.get("local:private"));
  await assert.rejects(f.catalog.get("local:unknown"), /not found/);
});

test('cloud draft caches keep the original library identity and version, replace only the same skill, and clear only successfully saved snapshots', () => {
  const first = { ...exampleDraft, sourceRecordingId: 'first-recording', remoteSkillId: 'cloud', ownerId: 'me', readOnly: false, savedVersion: 4, dirty: true, markdown: 'My unfinished edit' };
  const second = { ...first, sourceRecordingId: 'second-recording', remoteSkillId: 'other-cloud', markdown: 'Second edit' };
  const newest = { ...first, sourceRecordingId: 'reopened', markdown: 'Newer edit' };
  const cached = keepLocalDraft(keepLocalDraft(keepLocalDraft([], first), second), newest);
  assert.equal(cached.length, 2); assert.equal(cached[0], newest); assert.equal(cached[1], second);
  assert.equal(cached[0]?.remoteSkillId, 'cloud'); assert.equal(cached[0]?.savedVersion, 4);
  assert.equal(keepLocalDraft([], { ...first, dirty: false }).length, 0);
  assert.deepEqual(withoutSavedDraft(cached, first), cached); // An older save cannot erase newer work.
  assert.deepEqual(withoutSavedDraft(cached, newest), [second]);
  assert.deepEqual(withoutSavedDraft(cached, { ...newest, remoteSkillId: undefined }), cached);
});

test('recovering cloud edits always reauthorizes the original owner and shared users see only the saved version', async () => {
  let user: string | undefined = 'me', checks = 0;
  const pending = { ...exampleDraft, sourceRecordingId: 'cloud-edit', remoteSkillId: 'cloud', ownerId: 'me', name: 'private-working-name', description: 'Private working description.', readOnly: false, dirty: true, savedVersion: 3, markdown: exampleDraft.markdown + '\nPrivate working instructions' };
  const row = { id: 'cloud', title: 'Saved name', description: 'Saved description', ownerId: 'me', currentVersion: 3, versions: [{ markdown: exampleDraft.markdown }] };
  const catalog = new SkillCatalog({
    readLocal: async () => ({ skills: [pending] }),
    listLibrary: async () => user ? [row] : [],
    getLibrary: async () => { checks++; if (!user) throw new Error('Sign in to the library first.'); return row; },
    userId: async () => user,
  });
  assert.equal((await catalog.load('library:cloud')).markdown, pending.markdown);
  assert.equal(checks, 1);
  assert.equal((await catalog.list()).skills?.find(s => s.id === 'library:cloud')?.hasLocalEdits, true);
  user = undefined;
  assert.doesNotMatch(JSON.stringify(await catalog.list()), /private-working|cloud-edit|library:cloud/);
  await assert.rejects(catalog.load('library:cloud'), /Sign in/);
  user = 'recipient';
  const shared = await catalog.get('library:cloud');
  assert.equal(shared.skill?.name, row.title);
  assert.doesNotMatch(shared.skill!.markdown, /Private working/);
  assert.equal((await catalog.list()).skills?.find(s => s.id === 'library:cloud')?.hasLocalEdits, undefined);
  user = 'me';
  assert.equal((await catalog.load('library:cloud')).savedVersion, 3);
  assert.equal(checks, 4);
});
