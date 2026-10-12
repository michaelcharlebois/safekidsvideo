import { ExitButton } from "./exit-button";

export default function WatchLayout({ children }: LayoutProps<"/watch">) {
  return (
    <div className="kid-mode flex-1 flex flex-col bg-sky/40">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="font-extrabold text-xl"><span className="text-accent">●</span> My Videos</span>
        <ExitButton />
      </header>
      {children}
    </div>
  );
}
