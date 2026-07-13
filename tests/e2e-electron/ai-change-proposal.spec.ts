import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectronApp as launchElectronAppBase } from './support/electron-launch'
import {
  startOpenAiResponsesServer,
  type OpenAiFunctionCall,
  type OpenAiResponsesServer,
} from './support/openai-responses-server'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baselineMarkdown = '# Proposal\n\nalpha\none\ntwo\nthree\nfour\nfive\neight\nnine\nlambda\nomega\n'
const discardedProposalSecret = 'RAW_PROPOSAL_DISCARDED_SECRET'
const appliedProposalSecret = 'RAW_PROPOSAL_APPLIED_SECRET'
const manualEditSecret = 'RAW_MANUAL_HUNK_EDIT_SECRET'
const siblingSideEffectSecret = 'RAW_SIBLING_SIDE_EFFECT_SECRET'
const provisionalReplySecret = 'RAW_PROVISIONAL_TOOL_ITERATION_SECRET'
const noAutomaticContinuationObservationMs = 500
const proposedMarkdown = baselineMarkdown
  .replace('alpha', discardedProposalSecret)
  .replace('lambda', appliedProposalSecret)

type ProposalObservation = {
  opens: MdvAiChangeProposalSummary[]
  resolutions: MdvAiChangeProposalResolution[]
  streamEvents: MdvAiChatStreamEvent[]
}

type ProposalObservationWindow = Window & {
  __mdvProposalObservation?: ProposalObservation
}

function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function buildProposalFunctionCalls(): OpenAiFunctionCall[] {
  return [
    {
      name: 'write_target',
      arguments: {
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [{ type: 'literal', text: `\n${siblingSideEffectSecret}\n` }],
        mode: 'append',
        dryRun: false,
      },
    },
    {
      name: 'write_target',
      arguments: {
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [{ type: 'literal', text: proposedMarkdown }],
        mode: 'replace',
        title: 'Two separated updates',
        dryRun: true,
      },
    },
  ]
}

async function launchElectronApp(options: {
  userDataDir: string
  filePath: string
  openAiBaseUrl: string
}) {
  return launchElectronAppBase({
    repoRoot,
    args: ['.', options.filePath],
    env: {
      MDV_FORCE_STATIC_RENDERER: '1',
      MDV_E2E_USER_DATA_DIR: options.userDataDir,
      MDV_E2E_DIALOG_RESPONSES: JSON.stringify({}),
      MDV_OPENAI_BASE_URL: options.openAiBaseUrl,
      OPENAI_API_KEY: 'mdv-e2e-fake',
    },
  })
}

async function forceCloseApp(app: import('playwright').ElectronApplication) {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy()
      }
    })
    .catch(() => {})
}

async function openWritePanel(page: Page) {
  await page.locator('.view-switch button').nth(0).click()
  await expect(page.locator('.view-switch button').nth(0)).toHaveClass(/active/)
}

async function openAiDock(page: Page) {
  await page.getByRole('button', { name: /AI Chat/ }).click()
  await expect(page.locator('.assistant-dock')).toBeVisible()
}

async function installProposalObservation(page: Page) {
  await page.evaluate(() => {
    const observed: ProposalObservation = {
      opens: [],
      resolutions: [],
      streamEvents: [],
    }
    const observationWindow = window as ProposalObservationWindow
    observationWindow.__mdvProposalObservation = observed
    window.mdvDesktop?.onAiChangeProposalOpen((proposal) => observed.opens.push(proposal))
    window.mdvDesktop?.onAiChangeProposalResolved((resolution) => observed.resolutions.push(resolution))
    window.mdvDesktop?.onAiChatStreamEvent((event) => observed.streamEvents.push(event))
  })
}

async function readProposalObservation(page: Page) {
  return page.evaluate(() => {
    return (window as ProposalObservationWindow).__mdvProposalObservation ?? {
      opens: [],
      resolutions: [],
      streamEvents: [],
    }
  })
}

async function readActiveMarkdown(page: Page) {
  return page.evaluate(async () => {
    const result = await window.mdvDesktop?.readAiActiveDocument()
    return result?.text ?? null
  })
}

async function sendProposalPrompt(page: Page) {
  const composer = page.getByPlaceholder(/アシスタントにメッセージを送る|Message the assistant/)
  await composer.fill('Propose two separated document updates')
  await composer.press('Enter')
}

async function expectOpenAiRequestCountToRemain(
  server: OpenAiResponsesServer,
  expectedCount: number,
) {
  expect(server.requests).toHaveLength(expectedCount)
  await new Promise<void>((resolve) => setTimeout(resolve, noAutomaticContinuationObservationMs))
  expect(server.requests).toHaveLength(expectedCount)
}

async function setupProposalTest() {
  const tempRoot = await makeTempDir('mdv-electron-ai-change-proposal-')
  const userDataDir = path.join(tempRoot, 'user-data')
  const filePath = path.join(tempRoot, 'proposal.md')
  const openAiServer = await startOpenAiResponsesServer({
    functionCalls: buildProposalFunctionCalls(),
    outputText: provisionalReplySecret,
  })

  try {
    await fs.mkdir(userDataDir, { recursive: true })
    await fs.writeFile(filePath, baselineMarkdown, 'utf8')

    const app = await launchElectronApp({
      userDataDir,
      filePath,
      openAiBaseUrl: openAiServer.baseUrl,
    })

    return {
      app,
      openAiServer,
      tempRoot,
      userDataDir,
    }
  } catch (error) {
    await openAiServer.close().catch(() => {})
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

test('revalidates a manual hunk edit through real Electron IPC and applies only that selected hunk', async () => {
  const fixture = await setupProposalTest()

  try {
    const page = await fixture.app.firstWindow()
    await expect.poll(async () => page.title()).toMatch(/proposal\.md - MDV/i)
    await openWritePanel(page)
    await expect.poll(() => readActiveMarkdown(page)).toBe(baselineMarkdown)
    await installProposalObservation(page)
    await openAiDock(page)
    await sendProposalPrompt(page)

    const dialog = page.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    const transcript = page.locator('.assistant-dock .ai-chat-transcript')
    const hunkToggles = page.locator('.change-preview-toggle input')
    await expect(dialog).toBeVisible()
    await expect(hunkToggles).toHaveCount(2)
    await expect(dialog).toContainText(discardedProposalSecret)
    await expect(dialog).toContainText(appliedProposalSecret)
    await expect.poll(() => readActiveMarkdown(page)).toBe(baselineMarkdown)
    await expect(transcript).toContainText('Two separated updates')
    await expect(transcript).not.toContainText(discardedProposalSecret)
    await expect(transcript).not.toContainText(appliedProposalSecret)
    await expect(transcript).not.toContainText(siblingSideEffectSecret)
    await expect(transcript).not.toContainText(provisionalReplySecret)
    expect(fixture.openAiServer.requests).toHaveLength(1)

    const pendingObservation = await readProposalObservation(page)
    const proposalOpen = pendingObservation.opens.at(-1)
    const pendingEvent = pendingObservation.streamEvents.find((event) => event.type === 'proposal-pending')
    expect(proposalOpen).toBeTruthy()
    expect(pendingEvent?.type).toBe('proposal-pending')
    if (!proposalOpen || pendingEvent?.type !== 'proposal-pending') {
      throw new Error('Expected proposal open and proposal-pending events')
    }
    expect(proposalOpen.proposalId).toBe(pendingEvent.proposal.proposalId)
    expect(proposalOpen.originRequestId).toBe(pendingEvent.requestId)
    expect(pendingObservation.streamEvents.some((event) => event.type === 'completed')).toBe(false)
    const genericToolEventContent = pendingObservation.streamEvents
      .filter((event) => event.type === 'tool-event')
      .map((event) => event.content)
      .join('\n')
    expect(pendingObservation.streamEvents.filter((event) => event.type === 'tool-event')).toHaveLength(2)
    expect(genericToolEventContent).not.toContain(discardedProposalSecret)
    expect(genericToolEventContent).not.toContain(appliedProposalSecret)
    expect(genericToolEventContent).not.toContain(siblingSideEffectSecret)
    expect(genericToolEventContent).not.toContain(provisionalReplySecret)

    await dialog.getByRole('button', { name: /(変更 2\/2 を編集|Edit change 2 of 2)/ }).click()
    const editTextarea = dialog.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    await editTextarea.fill(manualEditSecret)
    await expect(page.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ })).toBeDisabled()
    await expect.poll(() => readActiveMarkdown(page)).toBe(baselineMarkdown)
    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()
    await expect(editTextarea).toHaveCount(0)
    await expect(dialog).toContainText(manualEditSecret)

    await hunkToggles.nth(0).click()
    await page.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ }).click()

    const expectedAppliedMarkdown = baselineMarkdown.replace('lambda', manualEditSecret)
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => readActiveMarkdown(page)).toBe(expectedAppliedMarkdown)
    await expect(transcript.locator('.chat-tool-entry').last()).toContainText(/適用しました|Applied/i)
    await expect(transcript).not.toContainText(discardedProposalSecret)
    await expect(transcript).not.toContainText(appliedProposalSecret)
    await expect(transcript).not.toContainText(manualEditSecret)
    await expect(transcript).not.toContainText(siblingSideEffectSecret)
    await expect(transcript).not.toContainText(provisionalReplySecret)

    const appliedObservation = await readProposalObservation(page)
    const resolution = appliedObservation.resolutions.at(-1)
    expect(resolution).toMatchObject({
      proposalId: proposalOpen.proposalId,
      originRequestId: proposalOpen.originRequestId,
      status: 'applied',
      revision: 2,
      appliedHunkCount: 1,
      selectedHunkIds: [`${proposalOpen.proposalId}:hunk:2`],
    })
    expect(resolution?.proposalFingerprint).not.toBe(proposalOpen.proposalFingerprint)
    expect(typeof resolution?.proposalFingerprint).toBe('string')
    expect(JSON.stringify(appliedObservation.streamEvents)).not.toContain(manualEditSecret)
    expect(JSON.stringify(resolution)).not.toContain(manualEditSecret)
    await expectOpenAiRequestCountToRemain(fixture.openAiServer, 1)

    const outgoingRequest = fixture.openAiServer.requests[0]
    expect(outgoingRequest.method).toBe('POST')
    expect(outgoingRequest.url).toBe('/v1/responses')
    expect(outgoingRequest.body).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'none' },
    })
    expect(outgoingRequest.rawBody).toContain('write_target')
    expect(outgoingRequest.rawBody).not.toContain(discardedProposalSecret)
    expect(outgoingRequest.rawBody).not.toContain(appliedProposalSecret)
    expect(outgoingRequest.rawBody).not.toContain(siblingSideEffectSecret)
    expect(outgoingRequest.rawBody).not.toContain(provisionalReplySecret)
    expect(outgoingRequest.rawBody).not.toContain(manualEditSecret)

    const logText = await fs.readFile(path.join(fixture.userDataDir, 'logs', 'mdv.log'), 'utf8')
    expect(logText).not.toContain(discardedProposalSecret)
    expect(logText).not.toContain(appliedProposalSecret)
    expect(logText).not.toContain(siblingSideEffectSecret)
    expect(logText).not.toContain(provisionalReplySecret)
    expect(logText).not.toContain(manualEditSecret)
  } finally {
    await forceCloseApp(fixture.app)
    await fixture.app.close().catch(() => {})
    await fixture.openAiServer.close().catch(() => {})
    await fs.rm(fixture.tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('fails Apply closed when the live document drifts after proposal capture', async () => {
  const fixture = await setupProposalTest()

  try {
    const page = await fixture.app.firstWindow()
    await expect.poll(async () => page.title()).toMatch(/proposal\.md - MDV/i)
    await openWritePanel(page)
    await expect.poll(() => readActiveMarkdown(page)).toBe(baselineMarkdown)
    await installProposalObservation(page)
    await openAiDock(page)
    await sendProposalPrompt(page)

    const dialog = page.getByRole('dialog', { name: /(AI の変更提案を確認|Review AI change proposal)/ })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.change-preview-toggle input')).toHaveCount(2)

    await dialog.getByRole('button', { name: /(変更 2\/2 を編集|Edit change 2 of 2)/ }).click()
    const editTextarea = dialog.getByRole('textbox', { name: /(この変更の Markdown|Markdown for this change)/ })
    await editTextarea.fill(manualEditSecret)
    await dialog.getByRole('button', { name: /^(編集を保存|Save edit)$/ }).click()
    await expect(editTextarea).toHaveCount(0)
    await expect(dialog).toContainText(manualEditSecret)

    const driftMarkdown = '\nLIVE_BASELINE_DRIFT\n'
    await page.evaluate(async (drift) => {
      await window.mdvDesktop?.writeAiTarget({
        destination: {
          editorId: 'editor:active',
          span: { kind: 'document' },
        },
        sources: [{ type: 'literal', text: drift }],
        mode: 'append',
      })
    }, driftMarkdown)
    await expect.poll(() => readActiveMarkdown(page)).toBe(`${baselineMarkdown}${driftMarkdown}`)

    await page.getByRole('button', { name: /(選択した.*適用|Apply .* selected)/ }).click()

    await expect(dialog).toHaveCount(0)
    await expect.poll(() => readActiveMarkdown(page)).toBe(`${baselineMarkdown}${driftMarkdown}`)
    expect((await readActiveMarkdown(page)) ?? '').not.toContain(manualEditSecret)
    await expect(page.locator('.statusbar-status')).toContainText(/(文書が変更されたため|document changed)/i)
    await expect(page.locator('.assistant-dock .chat-tool-entry').last()).toContainText(/適用しませんでした|Did not apply/i)

    const observation = await readProposalObservation(page)
    const proposalOpen = observation.opens.at(-1)
    expect(observation.resolutions.at(-1)).toMatchObject({
      proposalId: proposalOpen?.proposalId,
      originRequestId: proposalOpen?.originRequestId,
      status: 'stale',
      reason: 'baseline-changed',
      revision: 2,
    })
    expect(observation.resolutions.at(-1)?.proposalFingerprint).not.toBe(proposalOpen?.proposalFingerprint)
    expect(observation.streamEvents.some((event) => event.type === 'completed')).toBe(false)
    expect(JSON.stringify(observation)).not.toContain(manualEditSecret)
    await expectOpenAiRequestCountToRemain(fixture.openAiServer, 1)

    const logText = await fs.readFile(path.join(fixture.userDataDir, 'logs', 'mdv.log'), 'utf8')
    expect(logText).not.toContain(manualEditSecret)
  } finally {
    await forceCloseApp(fixture.app)
    await fixture.app.close().catch(() => {})
    await fixture.openAiServer.close().catch(() => {})
    await fs.rm(fixture.tempRoot, { recursive: true, force: true }).catch(() => {})
  }
})
