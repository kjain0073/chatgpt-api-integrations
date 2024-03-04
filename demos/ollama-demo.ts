import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'
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
  const api = new OllamaChatGPTAPI(
    {
      apiKey: process.env.OLLAMA_OPENAI_API_KEY,
      apiBaseUrl: process.env.OLLAMA_OPENAI_API_BASE,
      debug: false
    },
    'codellama:70b'
  )

  const prompt = 'can you understand "this" pointer. Explain in brief.'

  const res = await oraPromise(api.sendMessage(prompt), {
    text: prompt
  })
  console.log(res.text)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
