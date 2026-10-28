import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedSkillDocument, editSkillDocument, readSkillMetadata, writeSkillMetadata } from './metadata.ts';

const body = '\n# Instructions\nKeep my edited instructions.\n```json show-me-once\n{"schemaVersion":1,"parameters":[],"steps":[]}\n```\n';
const markdown = '---\nname: github-task\ndescription: "Original description."\ncustom: preserve-me # keep this comment\n---\n' + body;

test('renaming a saved skill and changing its description preserve every workflow byte', () => {
  const edited = editSkillDocument({ name: 'github-task', description: 'Original description.', markdown }, 'name', 'github-issue-triage-test-61');
  const next = editSkillDocument(edited, 'description', 'Find "bugs": use new inputs.');
  assert.deepEqual(readSkillMetadata(next.markdown), { name: next.name, description: next.description });
  assert.ok(next.markdown.endsWith(body));
  assert.match(next.markdown, /custom: preserve-me # keep this comment/);
  assert.equal(writeSkillMetadata(next.markdown, next), next.markdown);
});

test('direct YAML edits update the editor fields, including quotes and multiline descriptions', () => {
  const raw = '---\nname: "123"\ndescription: |\n  Find bugs.\n  Review results.\n---\n' + body;
  const next = editSkillDocument({ name: 'old', description: 'Old description.', markdown }, 'markdown', raw);
  assert.equal(next.name, '123');
  assert.equal(next.description, 'Find bugs.\nReview results.\n');
  assert.equal(next.markdown, raw);
  assert.deepEqual(readSkillMetadata(writeSkillMetadata(raw, { name: '456', description: 'A "quote" and: colon' })), { name: '456', description: 'A "quote" and: colon' });
});

test('incomplete YAML and partial typing are preserved until the user finishes editing', () => {
  const draft = { name: 'github-task', description: 'Original description.', markdown };
  const incomplete = editSkillDocument(draft, 'markdown', '---\nname: "unfinished');
  assert.equal(incomplete.markdown, '---\nname: "unfinished');
  assert.throws(() => checkedSkillDocument(incomplete), /header/);
  const partial = editSkillDocument(draft, 'name', '');
  assert.equal(partial.name, '');
  assert.equal(readSkillMetadata(partial.markdown).name, '');
  assert.throws(() => checkedSkillDocument(partial), /name/);
});

test('CRLF and BOM survive metadata repair; duplicate keys and aliases are rejected', () => {
  const original = '\uFEFF' + markdown.replaceAll('\n', '\r\n');
  const repaired = writeSkillMetadata(original, { name: 'new-name', description: 'New description.' });
  assert.ok(repaired.startsWith('\uFEFF---\r\n'));
  assert.ok(repaired.endsWith(body.replaceAll('\n', '\r\n')));
  for (const header of ['name: one\nname: two\ndescription: desc', 'name: &a hello\ndescription: *a'])
    assert.throws(() => readSkillMetadata(`---\n${header}\n---\n${body}`));
});
