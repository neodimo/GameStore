import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = JSON.parse(readFileSync(join(root, 'config/media-light.json'), 'utf8'))
const mode = process.argv[2] ?? 'source'
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg'])
const videoExtensions = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v'])
const archiveExtensions = new Set(['.zip', '.7z', '.rar', '.tar', '.gz'])
const excludedPrefixes = ['node_modules/', '.git/', 'release/', 'dist/', 'dist-electron/']
const failures = []

const normalize = (path) => path.split(sep).join('/')
const bytes = (value) => `${(value / 1024 / 1024).toFixed(2)} MiB`

function walk(directory, includeBuildOutput = false) {
  if (!statSafe(directory)?.isDirectory()) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    const name = normalize(relative(root, path))
    if (!includeBuildOutput && entry.isDirectory() && excludedPrefixes.some((prefix) => `${name}/`.startsWith(prefix))) return []
    return entry.isDirectory() ? walk(path, includeBuildOutput) : [path]
  })
}

function statSafe(path) {
  try { return statSync(path) } catch { return undefined }
}

function directorySize(directory) {
  return walk(directory, true).reduce((total, file) => total + statSync(file).size, 0)
}

function checkSource() {
  let trackedBytes = 0
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
    .toString().split('\0').filter(Boolean)
  for (const name of tracked) trackedBytes += statSync(join(root, name)).size
  if (trackedBytes > config.maxTrackedCoreBytes) {
    failures.push(`Tracked core is ${bytes(trackedBytes)}; budget is ${bytes(config.maxTrackedCoreBytes)}.`)
  }

  for (const file of walk(root)) {
    const name = normalize(relative(root, file))
    const extension = extname(name).toLowerCase()
    if (videoExtensions.has(extension)) failures.push(`Bundled video is forbidden: ${name}`)
    if (archiveExtensions.has(extension) && /(^|\/)(data|public|media|assets)\//i.test(name)) {
      failures.push(`Bundled catalog/media archive is forbidden: ${name}`)
    }
    if (!mediaExtensions.has(extension)) continue
    const allowed = config.allowedUiAssetPrefixes.some((prefix) => name.startsWith(prefix))
    if (!allowed) failures.push(`Media asset is outside an app-owned UI allowlist: ${name}`)
    else if (statSync(file).size > config.maxUiAssetBytes) {
      failures.push(`UI asset exceeds ${bytes(config.maxUiAssetBytes)}: ${name}`)
    }
  }
  console.log(`Tracked app core: ${bytes(trackedBytes)} / ${bytes(config.maxTrackedCoreBytes)}`)
}

function checkBuild() {
  for (const [directory, limit] of [['dist', config.maxWebBundleBytes], ['dist-electron', config.maxElectronBundleBytes]]) {
    const size = directorySize(join(root, directory))
    if (!size) failures.push(`Build output is missing: ${directory}/`)
    else if (size > limit) failures.push(`${directory}/ is ${bytes(size)}; budget is ${bytes(limit)}.`)
    console.log(`${directory}/: ${bytes(size)} / ${bytes(limit)}`)
  }
}

function checkArtifacts() {
  const directory = join(root, 'release')
  const artifacts = statSafe(directory)?.isDirectory()
    ? readdirSync(directory).filter((name) => config.artifactBudgets[extname(name)]).map((name) => join(directory, name))
    : []
  if (!artifacts.length) failures.push('No release artifact found to size-check.')
  for (const artifact of artifacts) {
    const extension = extname(artifact)
    const size = statSync(artifact).size
    const limit = config.artifactBudgets[extension]
    if (size > limit) failures.push(`${relative(root, artifact)} is ${bytes(size)}; budget is ${bytes(limit)}.`)
    console.log(`${relative(root, artifact)}: ${bytes(size)} / ${bytes(limit)}`)
  }
}

if (mode === 'source' || mode === 'all') checkSource()
if (mode === 'build' || mode === 'all') checkBuild()
if (mode === 'artifacts' || mode === 'all') checkArtifacts()
if (!['source', 'build', 'artifacts', 'all'].includes(mode)) failures.push(`Unknown mode: ${mode}`)

if (failures.length) {
  console.error('\nMedia-light policy failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('Media-light policy passed.')
