import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * supabase/setup.sql: every migration in one file to paste into the Supabase SQL Editor, which
 * applies only the ones a database doesn't have yet. A hosted project gets its migrations pasted
 * by hand, so nothing records which ran; each migration is recognized by something only it
 * creates (PROBES), and the file records what it has seen in average_app.migrations so later
 * runs needn't guess. It is built from supabase/migrations by setup-sql.test.ts
 * (UPDATE_SETUP_SQL=1 rewrites it); a migration without a probe fails that test.
 */

const fn = (name: string) =>
  `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}')`;
const col = (table: string, column: string) =>
  `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`;
const tbl = (name: string) => `to_regclass('public.${name}') is not null`;

/** How to tell each migration already ran: something it made that nothing before it did. */
export const PROBES: Record<string, string> = {
  "20260923000000": tbl("desks"),
  "20260924000000": tbl("share_links"),
  "20260925000000": tbl("connector_links"),
  "20260926000000": fn("connector_write"),
  "20260927000000": fn("connector_app_system"),
  "20260928000000": tbl("desk_requests"),
  "20260929000000": fn("connector_watch"),
  "20260930000000": fn("set_piece_text_stats"),
  "20261001000000": tbl("profile_sections"),
  "20261002000000": col("connector_links", "counselor_version"),
  "20261003000000": col("connector_links", "replaces"),
  "20261004000000": col("connector_links", "counselor_model"),
  "20261005000000": tbl("recommenders"),
  "20261006000000": col("profiles", "class_rank"),
  "20261007000000": col("colleges", "submitted_at"),
  "20261008000000": tbl("trash"),
  "20261009000000": fn("forget_unconfirmed_password"),
  "20261010000000": tbl("share_passwords"),
  // It only drops 20261009's trigger: ran if that one did and the trigger is gone.
  "20261011000000": `${fn("forget_unconfirmed_password")} and not exists (select 1 from pg_trigger where tgname = 'forget_unconfirmed_password' and tgrelid = to_regclass('auth.users'))`,
  "20261012000000": `coalesce(position('Average App' in pg_get_functiondef(to_regprocedure('public.connector_link(text)'))) > 0, false)`,
  "20261013000000": col("share_passwords", "share_name"),
  "20261014000000": fn("desk_share_guesses"),
  "20261015000000": tbl("profile_files"),
  "20261016000000": `coalesce(position('desk:' in pg_get_functiondef(to_regprocedure('public.can_use_piece_topic(text)'))) > 0, false)`,
  "20261017000000": col("desk_requests", "counselor_link"),
  "20261018000000": fn("counselor_other_on"),
};

/**
 * What a migration defines, by name, whether it makes, changes or removes it: functions (and who
 * may run them), triggers, policies, constraints, tables, views, types, indexes, columns, tables
 * in realtime, and scheduled jobs. Running a migration after a later one that defines any of the
 * same things could put back the older version of it; one that shares nothing with the later
 * ones can run late. (Data a migration fills in isn't compared: run late, it fills it in then.)
 */
export function definitions(sql: string): Set<string> {
  const s = sql.replace(/--[^\n]*/g, "");
  const out = new Set<string>();
  const each = (re: RegExp, key: (m: RegExpMatchArray) => string | string[]) => {
    for (const m of s.matchAll(re)) for (const k of [key(m)].flat()) out.add(k.toLowerCase());
  };
  const ifx = String.raw`(?:if\s+(?:not\s+)?exists\s+)?`;
  const re = (src: string) => new RegExp(src, "gi");
  each(re(String.raw`\bfunction\s+${ifx}public\.(\w+)\s*\(`), (m) => `function ${m[1]}`);
  each(re(String.raw`\b(?:create(?:\s+or\s+replace)?|drop)\s+trigger\s+${ifx}(\w+)`), (m) => `trigger ${m[1]}`);
  each(re(String.raw`\b(?:create|drop)\s+policy\s+${ifx}(?:"([^"]+)"|(\w+))\s+on\s+(?:public\.)?([\w.]+)`), (m) => `policy "${m[1] ?? m[2]}" on ${m[3]}`);
  each(re(String.raw`\b(?:add|drop)\s+constraint\s+${ifx}(\w+)`), (m) => `constraint ${m[1]}`);
  each(re(String.raw`\b(?:create|(?<!supabase_realtime\s+)drop)\s+table\s+${ifx}public\.(\w+)`), (m) => `table ${m[1]}`);
  each(re(String.raw`\b(?:create(?:\s+or\s+replace)?|drop)\s+view\s+${ifx}public\.(\w+)`), (m) => `view ${m[1]}`);
  each(re(String.raw`\b(?:create|drop)\s+type\s+${ifx}public\.(\w+)`), (m) => `type ${m[1]}`);
  each(re(String.raw`\b(?:create\s+(?:unique\s+)?index|drop\s+index)\s+${ifx}(?:public\.)?(\w+)`), (m) => `index ${m[1]}`);
  // Columns belong to the table the statement alters.
  each(re(String.raw`\balter\s+table\s+${ifx}(?:only\s+)?public\.(\w+)([^;]*)`), (m) =>
    [...m[2].matchAll(re(String.raw`\b(?:add|alter|drop)\s+column\s+${ifx}(\w+)`))].map((c) => `column ${m[1]}.${c[1]}`),
  );
  each(re(String.raw`\balter\s+publication\s+supabase_realtime\s+(?:add|drop)\s+table\s+([^;]+);`), (m) =>
    m[1].split(",").map((t) => `realtime ${t.trim().replace(/^public\./, "")}`),
  );
  each(re(String.raw`\bcron\.(?:un)?schedule\s*\(\s*'([^']+)'`), (m) => `job ${m[1]}`);
  return out;
}

/**
 * For each migration (by position, from 1), the later ones that define some of the same things,
 * and what: {"2": {"3": "function connector_counselor_poll"}}.
 */
export function clashes(all: { sql: string }[]): Record<string, Record<string, string>> {
  const defs = all.map((m) => definitions(m.sql));
  const out: Record<string, Record<string, string>> = {};
  defs.forEach((mine, i) => {
    for (let j = i + 1; j < defs.length; j++) {
      const both = [...mine].filter((d) => defs[j].has(d)).sort();
      if (both.length) (out[i + 1] ??= {})[j + 1] = both.slice(0, 3).join(", ") + (both.length > 3 ? ` and ${both.length - 3} more` : "");
    }
  });
  return out;
}

export function migrationFiles(dir: string): { version: string; name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.slice(0, 14), name: f.replace(/\.sql$/, ""), sql: readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n") }));
}

export function buildSetupSql(dir: string): string {
  const all = migrationFiles(dir);
  const missing = all.filter((m) => !PROBES[m.version]).map((m) => m.name);
  if (missing.length) throw new Error(`No probe for ${missing.join(", ")}: add one to PROBES in src/lib/db/setup-sql.ts.`);
  for (const m of all) if (m.sql.includes(`$m${m.version}$`)) throw new Error(`${m.name} contains its own quote tag.`);
  const clash = JSON.stringify(clashes(all)).replace(/'/g, "''");

  const head = `-- Average App: set up (or bring up to date) the database.
--
-- Paste all of this into the Supabase SQL Editor (Database > SQL Editor > New query) and run it.
-- It works out which migrations your database already has and applies only the missing ones, in
-- order, all or nothing. Running it again is safe: it does nothing when everything is there.
-- At the end it lists every migration your database has.
--
-- A migration that was skipped (a later one is already here) is applied too, unless a later one
-- already here changes some of the same things: applying it then would put back their older
-- versions, so nothing is changed and it says what is in the way.
--
-- Built from supabase/migrations by src/lib/db/setup-sql.ts; don't edit it by hand.

create schema if not exists average_app;
revoke all on schema average_app from public;
create table if not exists average_app.migrations (version text primary key, name text not null, applied_at timestamptz not null default now());

do $setup$
declare
  names text[] := array[${all.map((m) => `'${m.name}'`).join(", ")}];
  marked text[];
  cli text[] := '{}';
  have boolean[];
  -- For each migration, the later ones that change some of the same things, and what.
  clash jsonb := '${clash}';
  late boolean[] := '{}';
  blocked text;
  applied int := 0;
begin
  select coalesce(array_agg(version), '{}') into marked from average_app.migrations;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(array_agg(version::text), ''{}'') from supabase_migrations.schema_migrations' into cli;
  end if;
  have := array[
${all.map((m) => `    ('${m.version}' = any(marked)) or ('${m.version}' = any(cli)) or (${PROBES[m.version]})`).join(",\n")}
  ];

  for i in 1 .. array_length(names, 1) loop
    late[i] := false;
    if not have[i] then
      for j in i + 1 .. array_length(names, 1) loop
        if have[j] then
          late[i] := true;
          if clash -> i::text ? j::text then
            blocked := coalesce(blocked || '; ', '') || format('%s is missing, and %s, already here, changes the same things (%s)',
              names[i], names[j], clash -> i::text ->> j::text);
          end if;
        end if;
      end loop;
    end if;
  end loop;
  if blocked is not null then
    raise exception 'Nothing was changed: %. Applying the missing one now would undo part of the later one, so get help first.', blocked;
  end if;

  -- Remember what is already here, so a later run needn't work it out again.
  for i in 1 .. array_length(names, 1) loop
    if have[i] then
      insert into average_app.migrations (version, name) values (left(names[i], 14), names[i]) on conflict (version) do nothing;
    end if;
  end loop;

${all
  .map(
    (m, i) => `  if not have[${i + 1}] then
    execute $m${m.version}$
${m.sql.trim()}
$m${m.version}$;
    insert into average_app.migrations (version, name) values ('${m.version}', '${m.name}');
    applied := applied + 1;
    raise notice 'Applied %', '${m.name}' || case when late[${i + 1}] then ' (it had been skipped)' else '' end;
  end if;
`,
  )
  .join("\n")}
  if applied = 0 then
    raise notice 'Your database is up to date: nothing to do.';
  else
    raise notice 'Done: applied % migration(s).', applied;
  end if;
end
$setup$;

select version, name, applied_at from average_app.migrations order by version;
`;
  return head;
}
