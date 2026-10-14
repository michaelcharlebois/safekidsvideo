import Link from "next/link";
import { BrandMark } from "@/components/logo";

/** A kid page that doesn't exist, or a video this child can't watch (the player's gate says no). */
export default function KidNotFound() {
  return (
    <div className="kid-bf touch flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <BrandMark tone="dark" size={56} />
      <h1 className="mt-6 text-3xl font-extrabold">This one isn&apos;t here</h1>
      <p className="mt-2 text-lg font-semibold text-[var(--kmuted)]">Let&apos;s find something else to watch.</p>
      <Link href="/watch" autoFocus className="bigbtn mt-8 flex h-14 items-center rounded-full bg-[var(--kfocus)] px-8 text-lg font-extrabold text-[#2a1206]">Go Home</Link>
    </div>
  );
}
