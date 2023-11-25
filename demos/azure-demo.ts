import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'

import { AzureChatGPTAPI } from '../src'

dotenv.config()

/**
 * Demo CLI for testing basic functionality.
 *
 * ```
 * npx tsx demos/azure-demo.ts
 * ```
 */
async function main() {
  const api = new AzureChatGPTAPI(
    {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiBaseUrl: process.env.AZURE_OPENAI_API_BASE,
      debug: false
    },
    'chatgpt'
  )

  const prompt = 'can you understand "this" pointer'

  const res = await oraPromise(api.sendMessage(prompt), {
    text: prompt
  })
  console.log(res.text)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
