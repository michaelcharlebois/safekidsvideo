// Saving a settings form: validate the child, then write only the fields the form's sections own.
// Takes the store as a parameter so tests run it against a temporary local database.
import type { Store } from "@/lib/db/store";
import { hashPin, newPinProblem } from "@/lib/pin";
import { childSectionsOf, sectionsOf, settingsPatch, type SettingsSection } from "@/lib/settings-form";

export class SettingsError extends Error {}

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

/**
 * - Any child section requires `profileId` naming an existing child of THIS family. Missing, stale or
 *   foreign ids are refused before anything is read or written (never "the first child").
 * - A family-only form ("family" section) never writes a profile, whatever else it contains.
 * - Only the named sections' fields are written, so saves of different sections don't overwrite each other.
 */
export async function saveSettingsForm(store: Store, familyId: string, form: FormLike): Promise<{ sections: SettingsSection[]; profileId?: string }> {
  const sections = sectionsOf(form);
  const childSections = childSectionsOf(sections);
  const profileId = String(form.get("profileId") ?? "").trim() || undefined;
  if (childSections.length) {
    if (!profileId) throw new SettingsError("Choose which child these settings are for.");
    const p = await store.getProfile(profileId);
    if (!p || p.familyId !== familyId) throw new SettingsError("That child isn't in this family any more. Reload the page and try again.");
  }
  const pin = String(form.get("pin") ?? "").trim();
  if (pin && sections.includes("family")) {
    const problem = newPinProblem(pin); // 4 digits, and never the old default 1234
    if (problem) throw new SettingsError(problem);
  }
  // Family-only: read the family's fields without choosing a child to write to.
  const current = await store.getSettings(familyId, childSections.length ? profileId : undefined);
  const { child, family } = settingsPatch(current, form, sections, pin && sections.includes("family") ? hashPin(pin) : undefined);
  if (childSections.length && Object.keys(child).length) await store.updateProfileSettings(familyId, profileId!, child);
  if (Object.keys(family).length) await store.updateFamilySettings(familyId, family);
  return { sections, profileId: childSections.length ? profileId : undefined };
}
