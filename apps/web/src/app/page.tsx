export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8 inline-flex rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">Milestone 1 · Record</div>
      <h1 className="text-4xl font-semibold tracking-tight">Show Me Once</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Teach a browser task with one demonstration. The extension records a private timeline that can later become a reusable skill.</p>
      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-xl font-semibold">Start with the extension</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-slate-600">
          <li>Build the extension in this repository.</li>
          <li>Open <code className="rounded bg-slate-100 px-1">chrome://extensions</code>, enable Developer mode and load its unpacked build.</li>
          <li>Open a website, start recording, perform a task and stop. Review the timeline in the popup.</li>
        </ol>
      </section>
      <p className="mt-6 text-sm text-slate-500">The skill library, sign in, generation and replay are the next milestones.</p>
    </main>
  );
}
