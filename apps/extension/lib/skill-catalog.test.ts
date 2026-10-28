import test from "node:test";
import assert from "node:assert/strict";
import {
  SkillCatalog,
  EXAMPLE_ID,
  exampleDraft,
  keepLocalDraft,
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
  assert.equal(result.skill?.startUrl, "https://www.wikipedia.org");
  assert.deepEqual(parseSkillPlan(result.skill!.markdown).parameters, [
    { name: "search_1", type: "string" },
  ]);
  assert.match(result.skill!.markdown, /show-me-once-mcp/);
  assert.doesNotMatch(result.skill!.markdown, /Grace Hopper/);
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
