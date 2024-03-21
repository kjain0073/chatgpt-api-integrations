import Keyv from 'keyv'
import pTimeout from 'p-timeout'
import QuickLRU from 'quick-lru'
import { v4 as uuidv4 } from 'uuid'

import * as tokenizer from './tokenizer'
import * as types from './types'
import { fetch as globalFetch } from './fetch'
import { fetchSSE } from './fetch-sse'

const CHATGPT_MODEL = 'codellama:7b'

const USER_LABEL_DEFAULT = 'User'
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT'

export class OllamaChatGPTAPI {
  protected _apiKey: string
  protected _apiBaseUrl: string
  protected _debug: boolean

  protected _systemMessage: string
  protected _completionParams: Omit<
    types.openai.CreateChatCompletionRequest,
    'messages' | 'n'
  >
  protected _maxModelTokens: number
  protected _maxResponseTokens: number
  protected _fetch: types.FetchFn

  protected _getMessageById: types.GetMessageByIdFunction
  protected _upsertMessage: types.UpsertMessageFunction

  protected _messageStore: Keyv<types.ChatMessage>
  protected _deployModel: string
  protected _requestBodyType: string

  /**
   * Creates a new client wrapper around Azure OpenAI's chat completion API, mimicing the official ChatGPT webapp's functionality as closely as possible.
   *
   * @param apiKey - Ollama API key (optional).
   * @param apiBaseUrl - Ollama API base URL (required).
   * @param debug - Optional enables logging debugging info to stdout.
   * @param completionParams - Param overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `frequency_penalty` can be tweaked to change the personality of the assistant.
   * @param maxModelTokens - Optional override for the maximum number of tokens allowed by the model's context. Defaults to 4096.
   * @param maxResponseTokens - Optional override for the minimum number of tokens allowed for the model's response. Defaults to 1000.
   * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
   * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
   * @param deployModel - specify ollama model to use (default: codellama:7b)
   */
  constructor(
    opts: types.ChatGPTAPIOptions,
    deployModel: string,
    requestType: string
  ) {
    const {
      apiKey,
      apiBaseUrl,
      debug = false,
      messageStore,
      completionParams,
      systemMessage,
      maxModelTokens = 4000,
      maxResponseTokens = 1000,
      getMessageById,
      upsertMessage,
      fetch = globalFetch
    } = opts

    this._apiKey = apiKey
    this._apiBaseUrl = apiBaseUrl
    this._debug = !!debug
    this._fetch = fetch
    this._deployModel = deployModel
    this._requestBodyType = requestType

    this._completionParams = {
      model: this._deployModel || CHATGPT_MODEL,
      ...completionParams
    }
    console.log(
      `\r\n Completion Params: ${JSON.stringify(this._completionParams)}`
    )
    this._systemMessage = systemMessage

    if (this._systemMessage === undefined) {
      const currentDate = new Date().toISOString().split('T')[0]
      this._systemMessage = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.\nKnowledge cutoff: 2021-09-01\nCurrent date: ${currentDate}`
    }

    this._maxModelTokens = maxModelTokens
    this._maxResponseTokens = maxResponseTokens

    this._getMessageById = getMessageById ?? this._defaultGetMessageById
    this._upsertMessage = upsertMessage ?? this._defaultUpsertMessage

    if (messageStore) {
      this._messageStore = messageStore
    } else {
      this._messageStore = new Keyv<types.ChatMessage, any>({
        store: new QuickLRU<string, types.ChatMessage>({ maxSize: 10000 })
      })
    }

    if (!this._apiKey) {
      throw new Error('OpenAI missing required apiKey')
    }

    if (!this._fetch) {
      throw new Error('Invalid environment; fetch is not defined')
    }

    if (typeof this._fetch !== 'function') {
      throw new Error('Invalid "fetch" is not a function')
    }
  }

  /**
   * Sends a message to the OpenAI chat completions endpoint, waits for the response
   * to resolve, and returns the response.
   *
   * If you want your response to have historical context, you must provide a valid `parentMessageId`.
   *
   * If you want to receive a stream of partial responses, use `opts.onProgress`.
   *
   * Set `debug: true` in the `ChatGPTAPI` constructor to log more info on the full prompt sent to the OpenAI chat completions API. You can override the `systemMessage` in `opts` to customize the assistant's instructions.
   *
   * @param message - The prompt message to send
   * @param opts.parentMessageId - Optional ID of the previous message in the conversation (defaults to `undefined`)
   * @param opts.messageId - Optional ID of the message to send (defaults to a random UUID)
   * @param opts.systemMessage - Optional override for the chat "system message" which acts as instructions to the model (defaults to the ChatGPT system message)
   * @param opts.timeoutMs - Optional timeout in milliseconds (defaults to no timeout)
   * @param opts.onProgress - Optional callback which will be invoked every time the partial response is updated
   * @param opts.abortSignal - Optional callback used to abort the underlying `fetch` call using an [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
   *
   * @returns The response from ChatGPT
   */
  async sendMessage(
    text: string,
    opts: types.SendMessageOptions = {}
  ): Promise<types.ChatMessage> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false
    } = opts

    let { abortSignal } = opts

    let abortController: AbortController = null
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController()
      abortSignal = abortController.signal
    }

    const message: types.ChatMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      text
    }
    await this._upsertMessage(message)

    const { messages, prompt, maxTokens, numTokens } =
      await this._buildMessages(text, opts)

    const result: types.ChatMessage = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      text: ''
    }

    const responseP = new Promise<types.ChatMessage>(
      async (resolve, reject) => {
        const endpoint =
          this._requestBodyType === types.RequestBodyType.Chat
            ? `api/chat`
            : `api/generate`
        const url = `${this._apiBaseUrl}/${endpoint}`

        console.log(`\r\n API URL: ${url}`)

        const headers = {
          'Content-Type': 'application/json',
          'api-key': this._apiKey || 'ollama'
        }

        // console.log(`\r\n API KEY: ${this._apiKey || 'ollama'}`)

        console.log(`\r\n Content: ${messages[1].content}`)

        // console.log(`\r\n Name: ${messages[1].name}`)

        // console.log(`\r\n Role: ${messages[1].role}`)

        // console.log(`\r\n Is streaming?: ${stream}`)

        const options = {
          temperature: this._completionParams?.temperature || 0.8,
          top_p: this._completionParams?.top_p || 0.9,
          repeat_penalty: this._completionParams?.frequency_penalty || 1.1,
          stop: this._completionParams?.stop || ['<|im_end|>'],
          num_predict: maxTokens
        }

        const requestBodyType = this._requestBodyType
        console.log(`\r\n Request Body Type: ${requestBodyType}`)
        let prompt_v1: string = ''

        messages.forEach((e) => {
          prompt_v1 = `${prompt_v1}\n<|im_start|>${e.role}\n${e.content}\n<|im_end|>`
        })

        prompt_v1 = `${prompt_v1}\n<|im_start|>assistant\n`
        const ollamaChatBody = {
          model: this._deployModel || CHATGPT_MODEL,
          messages,
          options,
          stream: false
        }

        const ollamaPromptBody = {
          model: this._deployModel || CHATGPT_MODEL,
          prompt:
            requestBodyType === types.RequestBodyType.PromptV1
              ? prompt_v1
              : prompt,
          options,
          stream: false
        }

        if (this._debug) {
          console.log(`sendMessage (${numTokens} tokens)`, ollamaChatBody)
        }

        if (stream) {
          fetchSSE(
            url,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(
                requestBodyType === types.RequestBodyType.Chat
                  ? ollamaChatBody
                  : ollamaPromptBody
              ),
              signal: abortSignal,
              onMessage: (data: string) => {
                try {
                  const response = JSON.parse(data)

                  if (response.id) {
                    result.id = response.id
                  }

                  if (response.message || response.response) {
                    result.role = response.message.role || 'assistant'
                    result.text += response.message.content || response.response
                  }

                  if (response.done) {
                    result.text = result.text.trim()
                    return resolve(result)
                  }

                  onProgress?.(result)
                } catch (err) {
                  console.warn('OpenAI stream SSE event unexpected error', err)
                  return reject(err)
                }
              }
            },
            this._fetch
          ).catch(reject)
        } else {
          try {
            console.log(
              `\r\n request: ${JSON.stringify(
                requestBodyType === types.RequestBodyType.Chat
                  ? ollamaChatBody
                  : ollamaPromptBody
              )}`
            )

            const res = await this._fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(
                requestBodyType === types.RequestBodyType.Chat
                  ? ollamaChatBody
                  : ollamaPromptBody
              ),
              signal: abortSignal
            })

            if (!res.ok) {
              const reason = await res.text()
              const msg = `Ollama error ${
                res.status || res.statusText
              }: ${reason}`
              const error = new types.ChatGPTError(msg, { cause: res })
              error.statusCode = res.status
              error.statusText = res.statusText
              return reject(error)
            }

            const response: any = await res.json()
            if (this._debug) {
              console.log(
                `\r\n debug is true and response: ${JSON.stringify(response)}`
              )
            }

            console.log(
              `\r\n debug is false and response: ${JSON.stringify(response)}`
            )

            if (response?.id) {
              result.id = response.id
            }

            if (response?.message || response?.response) {
              const message = response.message || response.response
              result.text = message.content || message
              if (message.role) {
                result.role = message.role || 'assistant'
              }
            } else {
              const res = response as any
              return reject(
                new Error(
                  `Ollama error: ${
                    res?.detail?.message || res?.detail || 'unknown'
                  }`
                )
              )
            }

            result.detail = response

            return resolve(result)
          } catch (err) {
            return reject(err)
          }
        }
      }
    ).then((message) => {
      return this._upsertMessage(message).then(() => message)
    })

    if (timeoutMs) {
      if (abortController) {
        // This will be called when a timeout occurs in order for us to forcibly
        // ensure that the underlying HTTP request is aborted.
        ;(responseP as any).cancel = () => {
          abortController.abort()
        }
      }

      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'OpenAI timed out waiting for response'
      })
    } else {
      return responseP
    }
  }

  get apiKey(): string {
    return this._apiKey
  }

  set apiKey(apiKey: string) {
    this._apiKey = apiKey
  }

  protected async _buildMessages(text: string, opts: types.SendMessageOptions) {
    const { systemMessage = this._systemMessage } = opts
    let { parentMessageId } = opts

    const userLabel = USER_LABEL_DEFAULT
    const assistantLabel = ASSISTANT_LABEL_DEFAULT

    const maxNumTokens = this._maxModelTokens - this._maxResponseTokens
    let messages: types.openai.ChatCompletionRequestMessage[] = []

    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage
      })
    }

    const systemMessageOffset = messages.length
    let nextMessages = text
      ? messages.concat([
          {
            role: 'user',
            content: text,
            name: opts.name
          }
        ])
      : messages
    let numTokens = 0
    let prompt = ''

    do {
      prompt = nextMessages
        .reduce((prompt, message) => {
          switch (message.role) {
            case 'system':
              return prompt.concat([`Instructions:\n${message.content}`])
            case 'user':
              return prompt.concat([`${userLabel}:\n${message.content}`])
            default:
              return prompt.concat([`${assistantLabel}:\n${message.content}`])
          }
        }, [] as string[])
        .join('\n\n')

      const nextNumTokensEstimate = await this._getTokenCount(prompt)
      const isValidPrompt = nextNumTokensEstimate <= maxNumTokens

      if (prompt && !isValidPrompt) {
        break
      }

      messages = nextMessages
      numTokens = nextNumTokensEstimate

      if (!isValidPrompt) {
        break
      }

      if (!parentMessageId) {
        break
      }

      const parentMessage = await this._getMessageById(parentMessageId)
      if (!parentMessage) {
        break
      }

      const parentMessageRole = parentMessage.role || 'user'

      nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
        {
          role: parentMessageRole,
          content: parentMessage.text,
          name: parentMessage.name
        },
        ...nextMessages.slice(systemMessageOffset)
      ])

      parentMessageId = parentMessage.parentMessageId
    } while (true)

    // Use up to 4096 tokens (prompt + response), but try to leave 1000 tokens
    // for the response.
    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens)
    )

    return { messages, prompt, maxTokens, numTokens }
  }

  protected async _getTokenCount(text: string) {
    // TODO: use a better fix in the tokenizer
    text = text.replace(/<|im_end|>/g, '')

    return tokenizer.encode(text).length
  }

  protected async _defaultGetMessageById(
    id: string
  ): Promise<types.ChatMessage> {
    const res = await this._messageStore.get(id)
    return res
  }

  protected async _defaultUpsertMessage(
    message: types.ChatMessage
  ): Promise<void> {
    await this._messageStore.set(message.id, message)
  }
}
