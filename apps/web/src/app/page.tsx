'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Download, LogOut, Plus, Save, Share2, Trash2 } from 'lucide-react';
import { editSkillDocument, readSkillMetadata, checkedSkillDocument, validateSkillMetadata } from '@show-me-once/shared';

type User = { id: string; email: string; name: string | null };
type SkillSummary = { id: string; title: string; description: string; ownerId: string; currentVersion: number; updatedAt: string; owner: { email: string; name: string | null } };
type SkillDetail = SkillSummary & { versions: { id: string; number: number; markdown: string; createdAt: string }[] };
type Run = { id: string; status: string; createdAt: string; skill: { title: string }; steps: { sequence: number; stepNumber: number; kind: string; status: string }[] };

async function rpc<T>(path: string, input: object = {}): Promise<T> {
  const response = await fetch(`/api/rpc/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }), cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.json?.message ?? 'The request failed.');
  return payload.json as T;
}

const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  let metadataError = '';
  if (markdown || title || description) {
    try {
      const metadata = readSkillMetadata(markdown);
      validateSkillMetadata(metadata);
      if ((!selected || selected.ownerId === user?.id) && (metadata.name !== title || metadata.description !== description))
        throw new Error('Name and description must match the SKILL.md header. Edit either field to sync it.');
    } catch (error) { metadataError = error instanceof Error ? error.message : 'Check the skill header.'; }
  }

  function editDocument(field: 'name' | 'description' | 'markdown', value: string) {
    const next = editSkillDocument({ name: title, description, markdown }, field, value);
    setTitle(next.name); setDescription(next.description); setMarkdown(next.markdown);
  }

  async function refreshLibrary() {
    const [skillList, runList] = await Promise.all([
      rpc<SkillSummary[]>('skill/list'), rpc<Run[]>('run/list'),
    ]);
    setSkills(skillList);
    setRuns(runList);
  }

  useEffect(() => {
    void (async () => {
      try {
        const result = await rpc<{ user: User | null }>('auth/me');
        setUser(result.user);
        if (result.user) await refreshLibrary();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Could not load the library.');
      } finally { setLoading(false); }
    })();
  }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: authMode, email, password, name: displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Sign in failed.');
      setUser(result.user); setPassword('');
      await refreshLibrary();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setNotice('');
    try {
      await fetch('/api/session', { method: 'DELETE' });
      setUser(null); setSkills([]); setRuns([]); setSelected(null);
    } finally { setBusy(false); }
  }

  async function openSkill(skillId: string) {
    setBusy(true); setNotice('');
    try {
      const detail = await rpc<SkillDetail>('skill/get', { id: skillId });
      setSelected(detail); setTitle(detail.title); setDescription(detail.description);
      const original = detail.versions[0]?.markdown ?? '';
      let document = original;
      if (detail.ownerId === user?.id) {
        try {
          document = checkedSkillDocument({ name: detail.title, description: detail.description, markdown: original }).markdown;
        } catch { /* Keep incomplete documents editable. */ }
      }
      setMarkdown(document);
      if (document !== original) setNotice('Name and description synchronized. Save a new version to update your library.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open the skill.'); }
    finally { setBusy(false); }
  }

  async function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setSaving(true); setNotice('');
    try {
      const document = checkedSkillDocument({ name: title, description, markdown });
      const input = { title: document.name, description: document.description, markdown: document.markdown };
      const result = selected
        ? await rpc<{ id: string }>('skill/update', { id: selected.id, ...input })
        : await rpc<{ id: string }>('skill/create', input);
      await refreshLibrary();
      await openSkill(result.id);
      setNotice(selected ? 'New version saved.' : 'Skill saved to your library.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save the skill.'); }
    finally { setBusy(false); setSaving(false); }
  }

  async function shareSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setSharing(true); setNotice('');
    try {
      await rpc('skill/share', { id: selected.id, email: shareEmail });
      setNotice(`Shared with ${shareEmail}.`); setShareEmail('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not share the skill.'); }
    finally { setBusy(false); setSharing(false); }
  }

  async function deleteSkill() {
    if (!selected || selected.ownerId !== user?.id || busy) return;
    const snapshot = selected;
    if (!window.confirm(`Delete “${snapshot.title}”?\n\nThis permanently removes every version, sharing access, and run history for this skill, including other users’ runs. Unsaved edits will also be discarded. This cannot be undone.`)) return;
    setBusy(true); setDeleting(true); setNotice('');
    try {
      await rpc('skill/delete', { id: snapshot.id, version: snapshot.currentVersion, confirm: true });
      newSkill();
      setSkills(current => current.filter(skill => skill.id !== snapshot.id));
      setRuns([]);
      setNotice(`“${snapshot.title}” deleted.`);
      try { await refreshLibrary(); }
      catch { setNotice(`“${snapshot.title}” deleted. Refresh the page to reload your remaining library and history.`); }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete the skill.'); }
    finally { setBusy(false); setDeleting(false); }
  }

  function newSkill() {
    setSelected(null); setTitle(''); setDescription(''); setMarkdown(''); setNotice('');
  }

  function importMarkdown(file: File | undefined) {
    if (!file) return;
    void file.text().then(text => {
      setMarkdown(text);
      try {
        const metadata = readSkillMetadata(text);
        setTitle(metadata.name); setDescription(metadata.description); setNotice('');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Check the imported header.'); }
    });
  }

  function downloadSkill() {
    if (!selected || metadataError) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = 'SKILL.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-7">
        <div>
          <div className="mb-3 inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-800">Record once · Run again</div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Show Me Once</h1>
          <p className="mt-3 max-w-2xl text-slate-600">Save browser skills, keep every version, and share them with another account. Record and run tasks in the Chrome extension.</p>
        </div>
        {user && <div className="flex items-center gap-3 text-sm"><span>{user.email}</span><Button variant="outline" disabled={busy} onClick={() => void signOut()}><LogOut />Sign out</Button></div>}
      </header>

      {notice && <p className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" role="status">{notice}</p>}
      {loading ? <p className="mt-10 text-slate-600">Loading your library…</p> : !user ? (
        <section className="mt-10 max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-semibold">{authMode === 'login' ? 'Sign in' : 'Create an account'}</h2>
          <p className="mt-2 text-sm text-slate-600">Your browser recordings stay local until you choose to save a generated skill.</p>
          <form onSubmit={event => void authenticate(event)} className="mt-6 space-y-4">
            {authMode === 'register' && <label className="block text-sm font-medium">Name (optional)<input className={`${fieldClass} mt-1`} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>}
            <label className="block text-sm font-medium">Email<input className={`${fieldClass} mt-1`} type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="block text-sm font-medium">Password<input className={`${fieldClass} mt-1`} type="password" required minLength={authMode === 'register' ? 12 : 1} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
            <Button disabled={busy} type="submit">{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight /></Button>
          </form>
          <button className="mt-5 text-sm font-medium text-blue-700 underline" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setNotice(''); }}>
            {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
          </button>
        </section>
      ) : (
        <div className="mt-8 grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">Skill library</h2><Button size="sm" disabled={busy} onClick={newSkill}><Plus />New skill</Button></div>
              <p className="mt-2 text-sm text-slate-600">Owned and shared skills appear here.</p>
              <div className="mt-4 space-y-2">{skills.length === 0 ? <p className="text-sm text-slate-500">No skills yet. Import a SKILL.md to begin.</p> : skills.map(skill => (
                <button key={skill.id} disabled={busy} onClick={() => void openSkill(skill.id)} className={`w-full rounded-xl border p-3 text-left text-sm transition hover:border-blue-400 ${selected?.id === skill.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                  <strong className="block text-slate-900">{skill.title}</strong>
                  <span className="mt-1 block text-slate-500">v{skill.currentVersion} · {skill.ownerId === user.id ? 'Owned by you' : `Shared by ${skill.owner.email}`}</span>
                </button>
              ))}</div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Run history</h2>
              <p className="mt-2 text-sm text-slate-600">Only step type and status are stored. Parameter values are excluded.</p>
              <div className="mt-4 space-y-3">{runs.length === 0 ? <p className="text-sm text-slate-500">No saved runs yet.</p> : runs.map(run => (
                <div key={run.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <strong className="block">{run.skill.title}</strong>
                  <span className="text-slate-500">{run.status.toLowerCase()} · {run.steps.length} log entries</span>
                  <details className="mt-3"><summary className="text-xs font-medium text-blue-700">View steps</summary><ol className="mt-2 space-y-1 text-xs text-slate-600">{run.steps.map(step => <li key={step.sequence}>Step {step.stepNumber}: {step.kind} · {step.status.toLowerCase().replaceAll('_', ' ')}</li>)}</ol></details>
                </div>
              ))}</div>
            </section>
          </aside>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-semibold">{selected ? 'Skill details' : 'Add a skill'}</h2>
              <p className="mt-2 text-sm text-slate-600">Import the SKILL.md generated by the extension. Saving an edit creates a new version.</p>
              {selected && <p className="mt-3 text-sm text-slate-500">Current version: {selected.currentVersion} · Owner: {selected.owner.email}</p>}
              <form onSubmit={event => void saveSkill(event)} className="mt-6 space-y-4">
                <label className="block text-sm font-medium">Name<input className={`${fieldClass} mt-1`} required maxLength={80} value={title} disabled={busy || (!!selected && selected.ownerId !== user.id)} onChange={event => editDocument('name', event.target.value)} /></label>
                <label className="block text-sm font-medium">Description<input className={`${fieldClass} mt-1`} required maxLength={300} value={description} disabled={busy || (!!selected && selected.ownerId !== user.id)} onChange={event => editDocument('description', event.target.value)} /></label>
                {(!selected || selected.ownerId === user.id) && <label className="block text-sm font-medium">Import SKILL.md<input className="mt-2 block w-full text-sm" type="file" disabled={busy} accept=".md,text/markdown,text/plain" onChange={event => importMarkdown(event.target.files?.[0])} /></label>}
                <label className="block text-sm font-medium">SKILL.md<textarea className={`${fieldClass} mt-1 min-h-72 font-mono text-xs`} required value={markdown} readOnly={busy || (!!selected && selected.ownerId !== user.id)} onChange={event => editDocument('markdown', event.target.value)} /></label>
                {metadataError && <p className="text-sm text-red-700" role="status">{metadataError}</p>}
                <div className="flex flex-wrap gap-2">
                  {(!selected || selected.ownerId === user.id) && <Button type="submit" disabled={busy || !!metadataError}><Save />{saving ? 'Saving…' : selected ? 'Save new version' : 'Save skill'}</Button>}
                  {selected && <Button type="button" variant="outline" disabled={!!metadataError} onClick={downloadSkill}><Download />Download SKILL.md</Button>}
                  {selected?.ownerId === user.id && <Button type="button" variant="destructive" disabled={busy} onClick={() => void deleteSkill()}><Trash2 />{deleting ? 'Deleting…' : 'Delete skill'}</Button>}
                </div>
              </form>
              {selected && <div className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-semibold">Versions</h3><p className="mt-2 text-sm text-slate-600">{selected.versions.map(version => `v${version.number}`).join(' · ')}</p></div>}
            </section>
            {selected?.ownerId === user.id && <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Share this skill</h2>
              <p className="mt-2 text-sm text-slate-600">The recipient needs an account. Sharing gives them read access to the skill and its versions.</p>
              <form onSubmit={event => void shareSkill(event)} className="mt-4 flex flex-wrap gap-2">
                <input className={`${fieldClass} min-w-56 flex-1`} type="email" required placeholder="Recipient email" aria-label="Recipient email" value={shareEmail} onChange={event => setShareEmail(event.target.value)} />
                <Button type="submit" disabled={busy}><Share2 />{sharing ? 'Sharing…' : 'Share skill'}</Button>
              </form>
            </section>}
          </div>
        </div>
      )}
    </main>
  );
}
