/**
 * Regenerate tsconfig.paths.json from a local deepseek-harness checkout.
 *
 * The plugin typechecks against the repo's built declaration files
 * (packages/<group>/<pkg>/lib/types) without installing the @deepseek-ai
 * scope: every package and every exports subpath becomes one `paths` entry,
 * so transitive d.ts imports inside the repo resolve as well.
 *
 * Usage: pnpm run sync:paths   (DSH_REPO=/path/to/deepseek-harness overrides
 * the default ../../GitHub/deepseek-harness location.)
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(process.env.DSH_REPO ?? join(root, '../../GitHub/deepseek-harness'))
if (!existsSync(join(repo, 'packages'))) {
  throw new Error(`deepseek-harness checkout not found at ${repo} (set DSH_REPO)`)
}

/** Extract the declaration file of one exports entry (string or conditions). */
function typesOf(entry) {
  if (typeof entry === 'string') return entry.endsWith('.d.ts') ? entry : undefined
  if (entry !== null && typeof entry === 'object') return typesOf(entry.types)
  return undefined
}

const paths = {}
const manifests = [
  ...globSync('packages/*/*/package.json', { cwd: repo }),
  ...globSync('vendor/*/package.json', { cwd: repo }),
]
for (const manifestPath of manifests) {
  const dir = join(repo, dirname(manifestPath))
  const manifest = JSON.parse(readFileSync(join(repo, manifestPath), 'utf8'))
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) continue
  const exports = manifest.exports ?? { '.': manifest.types }
  for (const [subpath, entry] of Object.entries(exports)) {
    const types = typesOf(entry)
    if (types === undefined) continue
    const target = join(dir, types)
    if (!existsSync(target)) continue
    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`
    paths[specifier] = [target]
  }
}

writeFileSync(
  join(root, 'tsconfig.paths.json'),
  `${JSON.stringify({ compilerOptions: { paths } }, null, 2)}\n`,
)
console.log(`tsconfig.paths.json: ${Object.keys(paths).length} specifiers from ${repo}`)
