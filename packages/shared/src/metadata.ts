import { Document, Scalar, isMap, isScalar, parseDocument } from 'yaml';

export type SkillMetadata = { name: string; description: string };

function frontmatter(markdown: string, optional = false) {
  if (markdown.length > 200_000) throw new Error('The skill is too large.');
  const match = /^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(\r?\n|$)/m.exec(markdown);
  if (!match || match.index !== 0) {
    if (optional && !/^(?:\uFEFF)?---(?:\s|$)/.test(markdown))
      return { doc: new Document({}), body: markdown, eol: '\n', bom: '' };
    throw new Error('Add a complete YAML header between --- lines at the top of SKILL.md.');
  }
  const doc = parseDocument(match[2]!, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents))
    throw new Error('Fix the YAML header at the top of SKILL.md.');
  // Do not expand aliases from imported, untrusted documents.
  try { doc.toJS({ maxAliasCount: 0 }); }
  catch { throw new Error('Use plain values without aliases in the SKILL.md header.'); }
  return { doc, body: markdown.slice(match[0].length), eol: match[0].includes('\r\n') ? '\r\n' : '\n', bom: match[1] ?? '' };
}

export function readSkillMetadata(markdown: string): SkillMetadata {
  const { doc } = frontmatter(markdown);
  const name = doc.get('name'), description = doc.get('description');
  if (typeof name !== 'string' || typeof description !== 'string')
    throw new Error('The SKILL.md header needs a text name and description.');
  return { name, description };
}

export function readSkillStartUrl(markdown: string): string | undefined {
  const { doc } = frontmatter(markdown);
  const value = doc.get('start_url');
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('The start_url header must be a public starting address.');
  return value;
}

export function writeSkillStartUrl(markdown: string, startUrl: string): string {
  const { doc, body, eol, bom } = frontmatter(markdown);
  doc.set('start_url', startUrl);
  return `${bom}---${eol}${doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol)}---${eol}${body}`;
}

/** Update only the header. Recorded instructions and the executable plan stay byte-for-byte intact. */
export function writeSkillMetadata(markdown: string, metadata: SkillMetadata): string {
  const { doc, body, eol, bom } = frontmatter(markdown, true);
  if (doc.get('name') === metadata.name && doc.get('description') === metadata.description) return markdown;
  doc.set('name', metadata.name);
  const existing = doc.get('description', true);
  const description = isScalar(existing) ? existing : new Scalar(metadata.description);
  description.value = metadata.description;
  description.type = Scalar.QUOTE_DOUBLE;
  doc.set('description', description);
  const header = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol);
  return `${bom}---${eol}${header}---${eol}${body}`;
}

export function validateSkillMetadata(metadata: SkillMetadata) {
  if (metadata.name.trim().length < 3 || metadata.name.length > 80)
    throw new Error('Use a skill name between 3 and 80 characters.');
  if (metadata.description.trim().length < 3 || metadata.description.length > 300)
    throw new Error('Use a description between 3 and 300 characters.');
}

/** Shared by both editors; incomplete YAML remains editable and is never replaced. */
export function editSkillDocument<T extends SkillMetadata & { markdown: string }>(draft: T, field: keyof SkillMetadata | 'markdown', value: string): T {
  if (field === 'markdown') {
    try { return { ...draft, markdown: value, ...readSkillMetadata(value) }; }
    catch { return { ...draft, markdown: value }; }
  }
  const edited = { ...draft, [field]: value };
  try { return { ...edited, markdown: writeSkillMetadata(draft.markdown, edited) }; }
  catch { return edited; }
}

export function checkedSkillDocument<T extends SkillMetadata & { markdown: string }>(draft: T): T {
  const metadata = { name: draft.name.trim(), description: draft.description.trim() };
  validateSkillMetadata(metadata);
  return { ...draft, ...metadata, markdown: writeSkillMetadata(draft.markdown, metadata) };
}
