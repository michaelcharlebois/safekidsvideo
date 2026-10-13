// Shared setup for tests that run the real SQL migrations: Supabase stand-ins and the migration list.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const MIG_DIR = path.resolve(import.meta.dirname, "../supabase/migrations");
export const ROLLBACK_DIR = path.resolve(import.meta.dirname, "../supabase/rollbacks");
export const migrationFiles = readdirSync(MIG_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
export const sql = (file: string) => readFileSync(path.join(MIG_DIR, file), "utf8");
export const rollbackSql = (file: string) => readFileSync(path.join(ROLLBACK_DIR, file), "utf8");

/** The bits of Supabase the migrations reference (auth schema, auth.uid(), API roles). */
export const SUPABASE_STUBS = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
`;

/** Apply stubs + migrations up to and including `through` (e.g. "0019"). */
export async function migrate(exec: (q: string) => Promise<unknown>, through = "9999") {
  await exec(SUPABASE_STUBS);
  for (const f of migrationFiles.filter((f) => f.slice(0, 4) <= through)) await exec(sql(f));
}
