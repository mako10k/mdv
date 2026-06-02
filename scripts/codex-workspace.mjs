import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const areaRules = [
  {
    name: 'Renderer UI',
    docs: ['README.md', 'src/App.tsx'],
    patterns: [/^src\/(?!ai-chat\/|settings\/|fetch-permissions\/)/, /^index\.html$/, /^vite\.config\.ts$/],
    validations: ['npm run lint', 'npm run build'],
  },
  {
    name: 'Assistant dock and AI tools',
    docs: ['docs/ai-chat-design.md', 'docs/ai-chat-feasibility.md', 'src/ai-chat/ChatApp.tsx'],
    patterns: [/^src\/ai-chat\//, /^electron\/openai-response-stream\.cjs$/],
    validations: ['npm run lint', 'npm run build'],
  },
  {
    name: 'Electron bridge and IPC',
    docs: ['electron/main.cjs', 'electron/preload.cjs', 'src/shims.d.ts'],
    patterns: [/^electron\//, /^src\/shims\.d\.ts$/],
    validations: ['npm run lint', 'npm run build'],
  },
  {
    name: 'Settings and fetch permissions',
    docs: ['docs/settings-design.md', 'src/settings/SettingsApp.tsx', 'electron/fetch-acl.cjs'],
    patterns: [/^src\/settings\//, /^src\/fetch-permissions\//, /^settings\.html$/, /^fetch-permissions\.html$/, /^electron\/fetch-acl\.cjs$/],
    validations: ['npm run lint', 'npm run build'],
  },
  {
    name: 'Managed client server',
    docs: ['server/mdv-server.cjs', 'README.md'],
    patterns: [/^server\//],
    validations: ['npm run lint', 'npm run build'],
  },
  {
    name: 'mdast submodule adapter',
    docs: ['docs/mdast-integration-design.md', 'electron/mdast-adapter.cjs', 'vendor/mdast-control/AGENTS.md'],
    patterns: [/^electron\/mdast-adapter\.cjs$/, /^vendor\/mdast-control/],
    validations: ['npm run mdast:check', 'npm run build'],
  },
  {
    name: 'Packaging and release',
    docs: ['DEVELOPMENT.md', 'docs/release-workflow.md', 'docs/adr/0013-windows-host-generate-deploy-promote-split.md'],
    patterns: [/^\.gitignore$/, /^package(-lock)?\.json$/, /^scripts\/build-win-host\./, /^scripts\/prepare-github-release\.mjs$/, /^scripts\/check-release-candidate\.mjs$/, /^scripts\/release-utils\.mjs$/, /^release\//, /^build\//],
    validations: ['npm run lint', 'npm run build', 'npm run test:release'],
    reviewAgents: ['packaging-review'],
  },
  {
    name: 'Release workflow tests',
    docs: ['DEVELOPMENT.md', 'docs/release-workflow.md', 'tests/release/'],
    patterns: [/^tests\/release\//],
    validations: ['npm run lint', 'npm run build', 'npm run test:release'],
    reviewAgents: ['packaging-review'],
  },
  {
    name: 'Renderer E2E tests',
    docs: ['DEVELOPMENT.md', 'tests/e2e/', 'playwright.config.ts'],
    patterns: [/^tests\/e2e\//, /^playwright\.config\.ts$/],
    validations: ['npm run lint', 'npm run build', 'npm test'],
  },
  {
    name: 'Electron E2E tests',
    docs: ['DEVELOPMENT.md', 'tests/e2e-electron/', 'playwright.electron.config.ts'],
    patterns: [/^tests\/e2e-electron\//, /^playwright\.electron\.config\.ts$/],
    validations: ['npm run lint', 'npm run build', 'npm run test:e2e:electron'],
  },
  {
    name: 'Shared test support',
    docs: ['DEVELOPMENT.md', 'tests/support/'],
    patterns: [/^tests\/support\//, /^tsconfig\.playwright\.json$/],
    validations: ['npm run lint', 'npm run build', 'npm test', 'npm run test:e2e:electron'],
  },
  {
    name: 'Agent and workflow guidance',
    docs: ['AGENTS.md', '.github/agents/consistency-review.agent.md', '.github/prompts/write-adr.prompt.md'],
    patterns: [/^AGENTS\.md$/, /^\.github\/agents\//, /^\.github\/prompts\//, /^docs\/adr\//, /^scripts\/codex-workspace\.mjs$/],
    validations: ['npm run lint', 'npm run build'],
  },
]

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

  if (result.status === 0) {
    return { ok: true, output }
  }

  if (result.error && output.length === 0) {
    return { ok: false, output: result.error.message }
  }

  return {
    ok: false,
    output,
  }
}

function getGitStatus() {
  const result = run('git', ['status', '--porcelain=v1'])

  if (!result.ok) {
    return { error: result.output, entries: [] }
  }

  const entries = result.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^(..) (.+)$/.exec(line) ?? /^([MADRCU?!]) (.+)$/.exec(line)

      if (!match) {
        return { status: '??', file: line }
      }

      return {
        status: match[1],
        file: match[2],
      }
    })

  return { entries }
}

function getSubmoduleStatus() {
  const result = run('git', ['submodule', 'status', '--recursive'])

  if (!result.ok) {
    return []
  }

  return result.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getPackageScripts() {
  const packageJsonPath = path.join(repoRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  return packageJson.scripts ?? {}
}

function matchesArea(file, area) {
  return area.patterns.some((pattern) => pattern.test(file))
}

function getRoutedFile(file) {
  const renameSeparator = ' -> '

  if (!file.includes(renameSeparator)) {
    return file
  }

  return file.slice(file.lastIndexOf(renameSeparator) + renameSeparator.length)
}

function unique(values) {
  return [...new Set(values)]
}

function getTouchedAreas(entries) {
  return areaRules
    .map((area) => ({
      ...area,
      files: entries
        .map((entry) => entry.file)
        .filter((file) => matchesArea(getRoutedFile(file), area)),
    }))
    .filter((area) => area.files.length > 0)
}

function printList(items, emptyText = '(none)') {
  if (items.length === 0) {
    console.log(`  ${emptyText}`)
    return
  }

  for (const item of items) {
    console.log(`  - ${item}`)
  }
}

function printWorkspaceMap() {
  const gitStatus = getGitStatus()
  const entries = gitStatus.entries
  const touchedAreas = getTouchedAreas(entries)
  const scripts = getPackageScripts()
  const submodules = getSubmoduleStatus()

  console.log('MDV Codex Workspace Map')
  console.log('')
  console.log('Start here:')
  printList([
    'AGENTS.md',
    'README.md',
    'DEVELOPMENT.md',
    'docs/current-backlog.md',
  ])

  console.log('')
  console.log('GitHub access rule:')
  printList([
    'Use "secdat exec git ..." for GitHub-facing git commands.',
    'Use "secdat exec gh ..." for GitHub CLI commands.',
    'Local git inspection such as status, diff, and log does not need secdat.',
  ])

  console.log('')
  console.log('Current worktree:')
  if (gitStatus.error) {
    console.log(`  git status failed: ${gitStatus.error}`)
  } else if (entries.length === 0) {
    console.log('  clean')
  } else {
    for (const entry of entries) {
      console.log(`  ${entry.status.trim() || 'M'} ${entry.file}`)
    }
  }

  console.log('')
  console.log('Touched areas:')
  if (touchedAreas.length === 0) {
    console.log('  No changed files. Use the task description to pick the area below.')
  } else {
    for (const area of touchedAreas) {
      console.log(`  - ${area.name}`)
      console.log(`    files: ${area.files.join(', ')}`)
      console.log(`    read: ${area.docs.filter((doc) => existsSync(path.join(repoRoot, doc.replace(/\/$/, '')))).join(', ')}`)
      console.log(`    validate: ${unique(area.validations).join(' && ')}`)
      if (area.reviewAgents) {
        console.log(`    extra review: ${area.reviewAgents.join(', ')}`)
      }
    }
  }

  console.log('')
  console.log('Validation baseline:')
  printList([
    'npm run build',
    'npm run lint when touching TypeScript, React, Electron, or build scripts',
    'npm test for broad renderer E2E regression coverage',
    'npm run test:e2e:electron for Electron integration behavior',
    'npm run test:release for release workflow changes',
  ])

  console.log('')
  console.log('Commit gate:')
  printList([
    'Run consistency-review on the exact diff before commit.',
    'Run packaging-review too when packaging, release artifacts, or Windows host scripts changed.',
    'Create or update an ADR for long-lived architecture, contract, packaging, or workflow decisions.',
  ])

  console.log('')
  console.log('Available npm scripts:')
  for (const [name, command] of Object.entries(scripts)) {
    console.log(`  ${name}: ${command}`)
  }

  console.log('')
  console.log('Submodules:')
  printList(submodules)
}

function printValidationPlan() {
  const gitStatus = getGitStatus()
  const touchedAreas = getTouchedAreas(gitStatus.entries)
  const validations = unique(touchedAreas.flatMap((area) => area.validations))
  const reviewAgents = unique(['consistency-review', ...touchedAreas.flatMap((area) => area.reviewAgents ?? [])])

  console.log('MDV Codex Validation Plan')
  console.log('')
  console.log('Recommended commands:')
  printList(validations.length > 0 ? validations : ['npm run build'])

  console.log('')
  console.log('Pre-commit review:')
  printList(reviewAgents)

  console.log('')
  console.log('Notes:')
  printList([
    'Do not overstate checks beyond commands actually run.',
    'Prefer root-cause contract fixes over accepting mixed payload shapes.',
    'Keep preload APIs, renderer callers, and src/shims.d.ts in sync.',
  ])
}

const command = process.argv[2] ?? 'map'

switch (command) {
  case 'map':
    printWorkspaceMap()
    break
  case 'validate':
    printValidationPlan()
    break
  default:
    console.error('Usage: node ./scripts/codex-workspace.mjs <map|validate>')
    process.exit(1)
}
