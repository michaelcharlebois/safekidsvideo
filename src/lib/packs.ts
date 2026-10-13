import packs from "../../data/packs.json";

export type Pack = { id: string; title: string; ages: string; blurb: string; emoji: string; channels: string[] };
export const PACKS: Pack[] = (packs as { packs: Pack[] }).packs;
export const packById = (id: string) => PACKS.find((p) => p.id === id);
