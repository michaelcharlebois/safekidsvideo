/** Shown while a parent page loads: the page's shape in quiet placeholders, so nothing jumps. */
export default function Loading() {
  const block = "animate-pulse rounded-[var(--radius-card)] bg-sand-soft motion-reduce:animate-none";
  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-sand-soft motion-reduce:animate-none" />
        <div className="space-y-2"><div className={`${block} h-8 w-40`} /><div className={`${block} h-4 w-72`} /></div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-24`} />)}</div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6"><div className={`${block} h-56`} /><div className={`${block} h-64`} /></div>
        <div className="space-y-6"><div className={`${block} h-48`} /><div className={`${block} h-40`} /></div>
      </div>
      <p className="sr-only">Loading…</p>
    </main>
  );
}
