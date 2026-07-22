import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const areaRules = [
  {
    name: 'Dependency and generated-runtime wiring',
    docs: ['DEVELOPMENT.md', 'docs/release-workflow.md', 'docs/adr/0026-toast-ui-sanitizer-build-binding.md'],
    patterns: [/^package(-lock)?\.json$/, /^vite\.config\.ts$/, /^scripts\/toast-ui-dompurify-transform\.ts$/, /^scripts\/check-renderer-security-bundle\.mjs$/],
    validations: ['npm audit --omit=dev', 'npm run lint', 'npm run build', 'npm run test:release'],
    reviewAgents: ['packaging-review'],
    earlyReview: {
      agents: ['consistency-review', 'packaging-review'],
      validations: ['npm audit --omit=dev', 'npm run build', 'npm run test:release'],
      checks: [
        'Trace dependency metadata through the actual runtime or generated bundle execution path.',
        'State what audit and lockfile evidence proves, and what it does not prove.',
        'Add a fail-closed runtime or generated-output check when source and shipped representations differ.',
      ],
    },
  },
  {
    name: 'Renderer UI',
    docs: ['README.md', 'src/App.tsx'],
    patterns: [/^src\/(?!ai-chat\/|settings\/|fetch-permissions\/|electron\/)/, /^index\.html$/, /^vite\.config\.ts$/],
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
    docs: ['src/electron/main.cts', 'electron/main.cjs', 'electron/preload.cjs', 'src/shims.d.ts'],
    patterns: [/^electron\//, /^src\/electron\//, /^src\/shims\.d\.ts$/],
    validations: ['npm run lint', 'npm run build', 'npm run test:node'],
    earlyReview: {
      agents: ['consistency-review'],
      validations: ['npm run electron:build', 'npm run test:node'],
      checks: [
        'Trace the contract across main, preload, renderer, and declared types before broad regression.',
        'Verify each boundary carries one explicit representation and fails closed on contract drift.',
      ],
    },
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
    docs: ['docs/mdast-integration-design.md', 'src/electron/mdast-adapter.cts', 'electron/mdast-adapter.cjs', 'vendor/mdast-control/AGENTS.md'],
    patterns: [/^src\/electron\/mdast-adapter\.cts$/, /^electron\/mdast-adapter\.cjs$/, /^vendor\/mdast-control/],
    validations: ['npm run mdast:check', 'npm run build'],
  },
  {
    name: 'Decision and design contracts',
    docs: ['docs/decision-governance.md', 'docs/current-backlog.md', 'docs/image-storage-design.md', 'docs/ai-chat-design.md', 'docs/ai-chat-feasibility.md'],
    patterns: [/^docs\/decision-governance\.md$/, /^docs\/current-backlog\.md$/, /^docs\/image-storage-design\.md$/, /^docs\/ai-chat-design\.md$/, /^docs\/ai-chat-feasibility\.md$/, /^docs\/local-asset-storage-design\.md$/, /^docs\/markdown-editor-fit-gap-backlog\.md$/],
    validations: ['npm run lint', 'npm run build'],
    reviewAgents: ['plain-eye-review'],
  },
  {
    name: 'Packaging and release',
    docs: ['DEVELOPMENT.md', 'docs/release-workflow.md', 'docs/image-storage-design.md', 'docs/adr/0018-untracked-windows-release-artifacts-and-history-rewrite.md', 'docs/git-history-rewrite-recovery.md'],
    patterns: [/^\.gitattributes$/, /^\.gitignore$/, /^package(-lock)?\.json$/, /^DEVELOPMENT\.md$/, /^docs\/release-workflow\.md$/, /^docs\/image-storage-design\.md$/, /^docs\/git-history-rewrite-recovery\.md$/, /^docs\/adr\/0018-untracked-windows-release-artifacts-and-history-rewrite\.md$/, /^scripts\/build-win-host\./, /^scripts\/prepare-github-release\.mjs$/, /^scripts\/check-release-candidate\.mjs$/, /^scripts\/release-utils\.mjs$/, /^release\//, /^build\//],
    validations: ['npm run lint', 'npm run build', 'npm run test:release'],
    reviewAgents: ['packaging-review'],
    earlyReview: {
      agents: ['consistency-review', 'packaging-review'],
      validations: ['npm run test:release'],
      checks: [
        'Trace source through candidate generation, validation, deploy, promotion, and publish inputs.',
        'Prove stale or partial artifacts cannot satisfy the evidence used to authorize promotion.',
      ],
    },
  },
  {
    name: 'Release workflow tests',
    docs: ['DEVELOPMENT.md', 'docs/release-workflow.md', 'tests/release/'],
    patterns: [/^tests\/release\//],
    validations: ['npm run lint', 'npm run build', 'npm run test:release'],
    reviewAgents: ['packaging-review'],
  },
  {
    name: 'Electron node tests',
    docs: ['DEVELOPMENT.md', 'tests/node/', 'src/electron/main.cts'],
    patterns: [/^tests\/node\//],
    validations: ['npm run lint', 'npm run build', 'npm run test:node'],
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
    docs: ['AGENTS.md', 'docs/decision-governance.md', 'docs/agent-judgment-hardening.md', 'docs/ai-development-settings.md', '.codex/agents/consistency-review.toml', '.codex/agents/plain-eye-review.toml', '.codex/agents/packaging-review.toml', '.agents/skills/write-adr/SKILL.md', '.github/agents/consistency-review.agent.md', '.github/agents/plain-eye-review.agent.md', '.github/agents/packaging-review.agent.md', '.github/prompts/write-adr.prompt.md'],
    patterns: [/^AGENTS\.md$/, /^docs\/decision-governance\.md$/, /^docs\/agent-judgment-hardening\.md$/, /^docs\/ai-development-settings\.md$/, /^\.codex\//, /^\.agents\//, /^\.github\/agents\//, /^\.github\/prompts\//, /^docs\/adr\//, /^scripts\/codex-workspace\.mjs$/],
    validations: ['npm run lint', 'npm run build'],
    reviewAgents: ['plain-eye-review'],
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

function getGitDiffEntries(args) {
  const result = run('git', ['diff', '--name-status', ...args])

  if (!result.ok) {
    return { error: result.output, entries: [] }
  }

  const entries = result.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status = 'M', ...rest] = line.split('\t')
      const file = rest.join(' -> ')
      return {
        status,
        file,
      }
    })

  return { entries }
}

function getValidationEntries(options = {}) {
  if (options.base) {
    const head = options.head ?? 'HEAD'
    const range = `${options.base}...${head}`
    const compared = getGitDiffEntries([range])

    return {
      source: 'range',
      sourceLabel: range,
      diffArgs: [range],
      ...compared,
    }
  }

  const staged = getGitDiffEntries(['--cached'])

  if (staged.error) {
    return { source: 'staged', sourceLabel: 'staged diff', diffArgs: ['--cached'], ...staged }
  }

  if (staged.entries.length > 0) {
    return { source: 'staged', sourceLabel: 'staged diff', diffArgs: ['--cached'], entries: staged.entries }
  }

  const worktree = getGitStatus()
  return { source: 'worktree', sourceLabel: 'full worktree', diffArgs: ['HEAD'], ...worktree }
}

function getDiffText(args, files) {
  const result = run('git', ['diff', '--unified=0', ...args, '--', ...files])
  return result.ok ? result.output : ''
}

function isVersionOnlyPackageDiff(diffText) {
  const changedLines = diffText
    .split(/\r?\n/)
    .filter((line) => /^[+-]/.test(line) && !/^\+\+\+|^---/.test(line))

  return changedLines.length > 0 && changedLines.every((line) => /^[+-]\s*"version":\s*"[^"]+",?\s*$/.test(line))
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

function getEarlyContractReviewPlan(entries, options = {}) {
  const packageVersionOnly = isVersionOnlyPackageDiff(options.packageDiff ?? '')
  const packageFiles = new Set(['package.json', 'package-lock.json'])
  const earlyAreas = areaRules.filter((area) => {
    if (!area.earlyReview) {
      return false
    }

    return entries.some((entry) => {
      const file = getRoutedFile(entry.file)
      return matchesArea(file, area) && !(packageVersionOnly && packageFiles.has(file))
    })
  })

  return {
    required: earlyAreas.length > 0,
    areas: earlyAreas.map((area) => area.name),
    agents: unique(earlyAreas.flatMap((area) => area.earlyReview.agents)),
    checks: unique(earlyAreas.flatMap((area) => area.earlyReview.checks)),
  }
}

function parseValidationOptions(args) {
  const options = { phase: 'all', base: null, head: null }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const [name, inlineValue] = arg.split('=', 2)

    if (!['--phase', '--base', '--head'].includes(name)) {
      throw new Error(`Unknown validate option: ${arg}`)
    }

    const value = inlineValue ?? args[index + 1]
    if (!value || (!inlineValue && value.startsWith('--'))) {
      throw new Error(`Missing value for ${name}`)
    }
    if (!inlineValue) {
      index += 1
    }

    options[name.slice(2)] = value
  }

  if (!['all', 'early'].includes(options.phase)) {
    throw new Error(`Unsupported validate phase: ${options.phase}`)
  }
  if (options.head && !options.base) {
    throw new Error('--head requires --base')
  }

  return options
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
    'If the Codex sandbox cannot see the secdat unlock session, use docs/codex-secure-github-access.md.',
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
    'npm run test:node for Electron main-process node tests',
    'npm test for broad renderer E2E regression coverage',
    'npm run test:e2e:electron for Electron integration behavior',
    'npm run test:release for release workflow changes',
  ])

  console.log('')
  console.log('Commit gate:')
  printList([
    'Run consistency-review on the exact diff before commit.',
    'Run plain-eye-review too when the diff changes RCA guidance, architecture or workflow policy, agent instructions, major countermeasure comparisons, or important user-facing reasoning.',
    'Run packaging-review too when packaging, release artifacts, or Windows host scripts changed.',
    'Codex project custom agents live in .codex/agents; Copilot-compatible review agents remain in .github/agents.',
    'Use docs/ai-development-settings.md to keep Copilot-compatible settings and Codex settings paired.',
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

function printValidationPlan(options = {}) {
  const validationEntries = getValidationEntries(options)
  if (validationEntries.error) {
    throw new Error(`Could not inspect validation target ${validationEntries.sourceLabel}: ${validationEntries.error}`)
  }

  const touchedAreas = getTouchedAreas(validationEntries.entries)
  const packageDiff = getDiffText(validationEntries.diffArgs, ['package.json', 'package-lock.json'])
  const earlyReview = getEarlyContractReviewPlan(validationEntries.entries, { packageDiff })
  const broadValidations = unique(touchedAreas.flatMap((area) => area.validations))
  const earlyValidations = unique(touchedAreas.flatMap((area) => area.earlyReview?.validations ?? []))
  const validations = options.phase === 'early' ? earlyValidations : broadValidations
  const reviewAgents = unique(['consistency-review', ...touchedAreas.flatMap((area) => area.reviewAgents ?? [])])

  console.log('MDV Codex Validation Plan')
  console.log('')
  console.log(options.phase === 'early'
    ? 'Early targeted commands (before broad regression):'
    : 'Recommended commands:')
  printList(validations.length > 0 ? validations : options.phase === 'early' ? [] : ['npm run build'], '(none; no early contract review is routed)')

  console.log('')
  console.log(`Validation source: ${validationEntries.sourceLabel}`)

  console.log('')
  console.log('Early contract review (before broad regression or Windows packaging):')
  if (earlyReview.required) {
    console.log('  Required areas:')
    printList(earlyReview.areas)
    console.log('  Review agents:')
    printList(earlyReview.agents)
    console.log('  Evidence focus:')
    printList(earlyReview.checks)
    console.log('  Completion contract:')
    printList([
      'Block only on an actual contract mismatch, a false or missing primary evidence path, or a missing fail-closed targeted check.',
      'Defer candidate results, broad regression, release-doc integration, and exact-diff polish to the final checkpoint when they are not expected yet.',
      'Run one initial pass and at most one confirmation pass after blocker fixes; defer non-blocking improvements to final review or backlog.',
      'Record the exact target, evidence, and verdict in the release work memo.',
      'Invalidate the pass only when reviewed dependency, runtime/build wiring, cross-process contract, or packaging-path files change.',
    ])
  } else {
    console.log('  Not auto-routed for this diff.')
  }

  if (options.phase !== 'early') {
    console.log('')
    console.log('Pre-commit review:')
    printList(reviewAgents)
  }

  console.log('')
  console.log('Notes:')
  printList([
    'Stage the intended commit subset first when you need exact-diff validation for a partial commit.',
    'Review agents listed here are auto-routed from file patterns; AGENTS.md can still require additional review for high-judgment diffs outside those auto-triggers.',
    'An early contract review is a pre-validation checkpoint and never replaces the final exact-diff pre-commit review.',
    'Do not overstate checks beyond commands actually run.',
    'Prefer root-cause contract fixes over accepting mixed payload shapes.',
    'Keep preload APIs, renderer callers, and src/shims.d.ts in sync.',
  ])
}

export { getEarlyContractReviewPlan, isVersionOnlyPackageDiff, parseValidationOptions }

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const command = process.argv[2] ?? 'map'

  switch (command) {
    case 'map':
      printWorkspaceMap()
      break
    case 'validate':
      try {
        printValidationPlan(parseValidationOptions(process.argv.slice(3)))
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
      break
    default:
      console.error('Usage: node ./scripts/codex-workspace.mjs <map|validate>')
      process.exit(1)
  }
}
