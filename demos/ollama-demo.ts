import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'
import pRetry from 'p-retry'
import { OllamaChatGPTAPI } from 'src/ollama-chatgpt-integration'

dotenv.config()

/**
 * Demo CLI for testing basic functionality.
 *
 * ```
 * npx tsx demos/ollama-demo.ts
 * ```
 */

async function main() {
  const start = Date.now()
  const systemMessage =
    'You are `@coderabbitai` (aka `github-actions[bot]`), a language model \ntrained by OpenAI. Your purpose is to act as a highly experienced \nsoftware engineer and provide a thorough review of the code hunks\nand suggest code snippets to improve key areas such as:\n  - Logic\n  - Security\n  - Performance\n  - Data races\n  - Consistency\n  - Error handling\n  - Maintainability\n  - Modularity\n  - Complexity\n  - Optimization\n  - Best practices: DRY, SOLID, KISS\n\nDo not comment on minor code style issues, missing \ncomments/documentation. Identify and resolve significant \nconcerns to improve overall code quality while deliberately \ndisregarding minor issues. \nKnowledge cutoff: 2021-09-01\nCurrent date: 2024-03-12\n\nIMPORTANT: Entire response must be in the language with ISO code: en-US\n'
  const ollamaChat = new OllamaChatGPTAPI(
    {
      apiKey: process.env.OLLAMA_OPENAI_API_KEY,
      apiBaseUrl: process.env.OLLAMA_OPENAI_API_BASE,
      systemMessage,
      debug: false,
      maxModelTokens: 4096,
      maxResponseTokens: 1000
    },
    'codellama:7b',
    'chat'
  )

  const ollamaPromptV1 = new OllamaChatGPTAPI(
    {
      apiKey: process.env.OLLAMA_OPENAI_API_KEY,
      apiBaseUrl: process.env.OLLAMA_OPENAI_API_BASE,
      systemMessage,
      debug: false,
      maxModelTokens: 4096,
      maxResponseTokens: 1000
    },
    'codellama:7b',
    'prompt_v1'
  )

  const ollamaPromptV2 = new OllamaChatGPTAPI(
    {
      apiKey: process.env.OLLAMA_OPENAI_API_KEY,
      apiBaseUrl: process.env.OLLAMA_OPENAI_API_BASE,
      systemMessage,
      completionParams: {
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 1.1
      },
      debug: false,
      maxModelTokens: 4096,
      maxResponseTokens: 1000
    },
    'codellama:7b',
    'prompt_v2'
  )

  const message = 'why is the sky blue?'

  const chatResponse = await oraPromise(
    ollamaChat.sendMessage(message, { timeoutMs: 360000 }),
    {
      text: message
    }
  )

  const promptV1Response = await oraPromise(
    ollamaPromptV1.sendMessage(message, { timeoutMs: 360000 }),
    {
      text: message
    }
  )

  const promptV2Response = await oraPromise(
    ollamaPromptV2.sendMessage(message, { timeoutMs: 360000 }),
    {
      text: message
    }
  )

  const end = Date.now()
  console.log('time taken in ms:', end - start)
  console.log('chat response:', JSON.stringify(chatResponse))
  console.log('prompt v1 response :', JSON.stringify(promptV1Response))
  console.log('prompt v2 response:', JSON.stringify(promptV2Response))
  console.log('api url', process.env.OLLAMA_OPENAI_API_BASE)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
