#!/usr/bin/env node
// Generate the agent-catalog from _build/personas.mjs:
//   <key>/ape-agent.yaml   — the recipe troop fetches + validates
//   <key>/README.md        — human description of the persona
//   README.md              — catalog index
//   catalog.json           — machine index (used by docs / cross-checks)
// and the ORG persona catalog (single source of truth for the spawn UI):
//   <monorepo>/apps/openape-org/server/utils/persona-catalog.ts
//
// Run:  node _build/generate.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCapabilities, buildIntent, buildParams, buildSchedules, buildTools,
  CATALOG_REPO, CATALOG_VERSION, CATEGORIES, PERSONAS,
} from './personas.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG_DIR = join(HERE, '..')
const ORG_PERSONA_TS = join(
  CATALOG_DIR, '..', 'openape-monorepo', 'apps', 'openape-org',
  'server', 'utils', 'persona-catalog.ts',
)

function recipeRef(key) {
  return `${CATALOG_REPO}/${key}@${CATALOG_VERSION}`
}

// ─── tiny YAML emitter tailored to the recipe shape ─────────────────────────
function blockScalar(key, text, indent) {
  const pad = ' '.repeat(indent)
  const lines = text.replace(/\n+$/, '').split('\n')
  const body = lines.map(l => (l.length ? `${pad}  ${l}` : '')).join('\n')
  return `${pad}${key}: |\n${body}\n`
}
// JSON double-quote is valid YAML flow-scalar — safe for colons/quotes.
const q = s => JSON.stringify(String(s))

function recipeYaml(p) {
  let out = ''
  out += `name: ${p.key}\n`
  out += `kind: agent\n`
  out += blockScalar('intent', buildIntent(p), 0)

  const caps = buildCapabilities(p)
  out += 'capabilities:\n'
  for (const c of caps) {
    out += `  - env: ${c.env}\n`
    if (c.prefer) out += `    prefer: ${c.prefer}\n`
    out += `    optional: ${c.optional ? 'true' : 'false'}\n`
    if (c.description) out += `    description: ${q(c.description)}\n`
  }
  if (caps.length === 0) out = out.replace('capabilities:\n', 'capabilities: []\n')

  out += 'params:\n'
  for (const pr of buildParams(p)) {
    out += `  - name: ${pr.name}\n`
    out += `    type: ${pr.type}\n`
    out += `    required: ${pr.required ? 'true' : 'false'}\n`
    if (pr.default !== undefined) out += `    default: ${q(pr.default)}\n`
    if (pr.description) out += `    description: ${q(pr.description)}\n`
  }

  out += 'schedules:\n'
  for (const s of buildSchedules(p)) {
    out += `  - cron: ${q(s.cron)}\n`
    if (s.description) out += blockScalar('description', s.description, 4)
    if (s.command) out += blockScalar('command', s.command, 4)
  }

  out += `user_addendum: true\n`
  out += 'tools:\n'
  for (const t of buildTools(p)) out += `  - ${t}\n`
  return out
}

function personaReadme(p) {
  const cat = CATEGORIES.find(c => c.key === p.category)?.label ?? p.category
  return `# ${p.title}

> ${p.summary}

- **Persona key:** \`${p.key}\`
- **Category:** ${cat}
- **ORG chart role:** \`${p.role}\`
- **Recipe ref:** \`${recipeRef(p.key)}\`
- **Schedule:** \`${p.cadence}\`${p.coding ? '\n- **Touches code:** yes (Forgejo at `git.openape.ai`, optional `FORGEJO_TOKEN`)' : ''}

## Mandate
${p.mandate}

## How this agent works
${p.works}

## Autonomy
On every schedule tick the agent runs the shared **operating protocol**: it pulls
its assigned tasks from [tasks.openape.ai](https://tasks.openape.ai)${p.coding ? ' and issues from [git.openape.ai](https://git.openape.ai)' : ''},
does exactly one, reports the result back onto the task, and closes it. No
hand-written prompt is ever required — assign it work in the UI and it picks it up.

## Deploy
\`\`\`bash
apes agent deploy ${recipeRef(p.key)} \\
  --param org_id=<your-org-id> \\
  --param org_name="<Your Org>"${p.coding ? ' \\\n  --secret FORGEJO_TOKEN=<forgejo-token>' : ''}
\`\`\`
Or spawn it from the org chart in ORG by picking the **${p.title}** persona.
`
}

function rootReadme() {
  let md = `# OpenApe Agent Catalog

A catalog of ready-to-deploy **agent personas**. Each persona is a pinned
recipe (\`ape-agent.yaml\`) that troop fetches, validates and deploys. Together
they let an Owner assemble a whole virtual company in
[ORG](https://org.openape.ai) — every member a real agent with its own DDISA
identity that **polls its own work** from
[tasks.openape.ai](https://tasks.openape.ai) and
[git.openape.ai](https://git.openape.ai) and processes it autonomously. You
never write per-task prompts: you assign work in the UI, the agents pick it up.

- **Repo ref form:** \`${CATALOG_REPO}/<persona>@${CATALOG_VERSION}\`
- **Personas:** ${PERSONAS.length}

## How autonomy works
Every persona shares one **operating protocol**. When its schedule fires it:
\`apes whoami\` → list its assigned \`open,doing\` tasks across its teams → pick the
single highest-priority one → mark it \`doing\` → do the work with its tools →
write the result back onto the task → \`done\`. Blocked work is reassigned to the
Owner with a note, never faked. Coding personas additionally pull issues from
Forgejo, branch → edit → verify → open a PR (never self-merge).

## Personas
`
  for (const cat of CATEGORIES) {
    const members = PERSONAS.filter(p => p.category === cat.key)
    if (!members.length) continue
    md += `\n### ${cat.label}\n\n| Persona | Role | Polls code | Recipe |\n|---|---|---|---|\n`
    for (const p of members) {
      md += `| [${p.title}](${p.key}/) | \`${p.role}\` | ${p.coding ? 'yes' : '—'} | \`${recipeRef(p.key)}\` |\n`
    }
  }
  md += `
### Infrastructure recipes
Not org personas, but shipped in this catalog for direct deploy:

| Recipe | Purpose |
|---|---|
| [service-agent](service-agent/) | Drains a service provider's A2A task queue (\`/api/agent/tasks/next\`) every minute. |
| [bluesky-summary](bluesky-summary/) | Twice-daily Bluesky timeline digest. |

## Go live
1. Push this directory to \`${CATALOG_REPO}\`.
2. Tag the release: \`git tag ${CATALOG_VERSION} && git push --tags\`.
3. ORG's persona catalog already pins \`@${CATALOG_VERSION}\`, so spawning any
   persona from the org chart works immediately.

## Regenerate
Edit \`_build/personas.mjs\`, then \`node _build/generate.mjs\`.
Validate against the real troop parser: \`apps/openape-troop\` →
\`pnpm tsx scripts/validate-catalog.ts\`.
`
  return md
}

function catalogJson() {
  return `${JSON.stringify({
    version: CATALOG_VERSION,
    repo: CATALOG_REPO,
    categories: CATEGORIES,
    personas: PERSONAS.map(p => ({
      key: p.key, title: p.title, role: p.role, category: p.category,
      icon: p.icon, summary: p.summary, coding: !!p.coding,
      cadence: p.cadence, recipeRef: recipeRef(p.key),
    })),
  }, null, 2)}\n`
}

// The ORG persona catalog — single source of truth for the spawn UI + spawn
// endpoint. Generated so it never drifts from the recipes. Emitted in the
// repo's @antfu/eslint-config style (single quotes, spaced objects) so it
// passes lint without a --fix pass.
//
// sq: emit a single-quoted TS string literal, escaping backslashes + quotes.
// The repo's lint rule enforces single quotes even when the value contains an
// apostrophe (no avoidEscape), so we escape rather than fall back to "..".
const sq = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`

function orgPersonaTs() {
  const rows = PERSONAS.map((p) => {
    const pairs = ['org_id: \'{{org_id}}\'', 'org_name: \'{{org_name}}\'']
    if (p.coding) pairs.push('forge_base: \'https://git.openape.ai\'')
    return `  {
    key: ${sq(p.key)},
    title: ${sq(p.title)},
    role: ${sq(p.role)},
    category: ${sq(p.category)},
    icon: ${sq(p.icon)},
    summary: ${sq(p.summary)},
    coding: ${p.coding ? 'true' : 'false'},
    recipeRef: ${sq(recipeRef(p.key))},
    recipeParams: { ${pairs.join(', ')} },
  },`
  }).join('\n')

  const cats = CATEGORIES.map(c => `  { key: ${sq(c.key)}, label: ${sq(c.label)} },`).join('\n')

  return `// AUTO-GENERATED by agent-catalog/_build/generate.mjs — do not edit by hand.
// Single source of truth for the company personas the Owner can spawn from the
// org chart. Each persona maps to a pinned recipe in ${CATALOG_REPO}
// and carries the structural ORG \`role\` it occupies on the chart.

export interface PersonaCategory {
  key: string
  label: string
}

export interface Persona {
  /** kebab-case catalog key, also the recipe subdir + agent slug seed */
  key: string
  /** human title shown in the chart + picker */
  title: string
  /** ORG structural chart role this persona occupies */
  role: 'ceo' | 'teamlead' | 'specialist' | 'sanierer' | 'other'
  /** picker grouping */
  category: string
  /** lucide icon name */
  icon: string
  /** one-line description for the picker */
  summary: string
  /** whether the persona works on code (Forgejo) */
  coding: boolean
  /** pinned recipe ref troop deploys */
  recipeRef: string
  /** recipe params; {{org_id}} / {{org_name}} are substituted at spawn time */
  recipeParams: Record<string, string>
}

export const PERSONA_CATEGORIES: PersonaCategory[] = [
${cats}
]

export const PERSONAS: Persona[] = [
${rows}
]

export const PERSONA_BY_KEY: Record<string, Persona>
  = Object.fromEntries(PERSONAS.map(p => [p.key, p]))

export function getPersona(key: string | null | undefined): Persona | undefined {
  if (!key) return undefined
  return PERSONA_BY_KEY[key]
}
`
}

// ─── write everything ───────────────────────────────────────────────────────
let count = 0
for (const p of PERSONAS) {
  const dir = join(CATALOG_DIR, p.key)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ape-agent.yaml'), recipeYaml(p))
  writeFileSync(join(dir, 'README.md'), personaReadme(p))
  count++
}
writeFileSync(join(CATALOG_DIR, 'README.md'), rootReadme())
writeFileSync(join(CATALOG_DIR, 'catalog.json'), catalogJson())

try {
  mkdirSync(dirname(ORG_PERSONA_TS), { recursive: true })
  writeFileSync(ORG_PERSONA_TS, orgPersonaTs())
  console.log(`Wrote ORG persona catalog → ${ORG_PERSONA_TS}`)
}
catch (e) {
  console.warn(`Skipped ORG persona catalog (${e.message})`)
}

console.log(`Generated ${count} persona recipes into ${CATALOG_DIR}`)
