// @ts-check

/** @typedef {import('openai').default} OpenAIClient */
/** @typedef {import('openai/resources/responses/responses.js').ResponseCreateParamsBase} ResponseCreateParamsBase */
/** @typedef {import('openai/lib/responses/ResponseStream.js').ResponseStream<null>} OpenAIResponseStream */

/**
 * Create the evented OpenAI response stream used by the main-process chat orchestration.
 * Keeping this boundary in a TS-checked module makes SDK contract drift fail fast in build.
 *
 * @param {OpenAIClient} client
 * @param {Omit<ResponseCreateParamsBase, 'stream'>} params
 * @returns {OpenAIResponseStream}
 */
function createOpenAiResponseStream(client, params) {
  return client.responses.stream(params)
}

module.exports = {
  createOpenAiResponseStream,
}