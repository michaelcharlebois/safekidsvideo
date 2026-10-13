// Which child is this screen for? Pure, so the rule is testable and identical everywhere.
import type { Profile } from "@/lib/types";

/**
 *  1. A device assigned to a child is always that child (and can't switch).
 *  2. A family with exactly one child: that child.
 *  3. A shared device: the child a parent picked with the PIN (server-stored), if still in the family.
 *  4. Otherwise: nobody — kid surfaces fail closed and show "Who's watching?".
 */
export function pickKid(profiles: Pick<Profile, "id">[], assignedId?: string | null, activeId?: string | null): string | undefined {
  const has = (id?: string | null) => !!id && profiles.some((p) => p.id === id);
  if (has(assignedId)) return assignedId!;
  if (profiles.length === 1) return profiles[0].id;
  if (has(activeId)) return activeId!;
  return undefined;
}
