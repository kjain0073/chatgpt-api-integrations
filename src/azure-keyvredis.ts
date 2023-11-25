import dotenv from 'dotenv-safe'
import EventEmitter from 'events'
import Keyv from 'keyv'
import redis, { RedisClientType, SetOptions } from 'redis'

import * as types from './types'

export class AzureRedisAdapter extends EventEmitter {
  private redis: RedisClientType
  private namespace: string

  constructor(options: any) {
    super()
    const { cacheHostName, cachePassword } = options
    this.redis = redis.createClient({
      // rediss for TLS
      url: `rediss://${cacheHostName}:6380`,
      password: cachePassword
    })
  }
  async connect() {
    return await this.redis.connect()
  }

  async disconnect() {
    return await this.redis.disconnect()
  }

  async get(key) {
    return await this.redis.get(key)
  }

  async set(key, value, ttl) {
    /*
        if (typeof value === 'object' && value !== null) { 
           value = JSON.stringify(value)
        }
        */
    console.log(value)

    if (typeof ttl === 'number') {
      return await this.redis.set(key, value, { PX: ttl })
    } else return await this.redis.set(key, value, { EX: 86400 })
  }

  async delete(key) {
    return await this.redis.del(key)
  }

  async flushAll() {
    return await this.redis.flushAll(redis.RedisFlushModes.ASYNC)
  }
}

//dotenv.config()

async function testCache() {
  const cacheHostName = process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME
  const cachePassword = process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY

  if (!cacheHostName) throw Error('AZURE_CACHE_FOR_REDIS_HOST_NAME is empty')
  if (!cachePassword) throw Error('AZURE_CACHE_FOR_REDIS_ACCESS_KEY is empty')
  // Connection configuration
  const cacheConnection = redis.createClient({
    // rediss for TLS
    url: `rediss://${cacheHostName}:6380`,
    password: cachePassword
  })

  let message: types.ChatMessage = {
    role: 'user',
    id: '12345',
    parentMessageId: '67890',
    text: 'hello world'
  }
  // Connect to Redis
  await cacheConnection.connect()

  // PING command
  console.log('\nCache command: PING')
  console.log('Cache response : ' + (await cacheConnection.ping()))

  // GET
  console.log('\nCache command: GET Message')
  console.log('Cache response : ' + (await cacheConnection.get('Message')))

  // SET
  console.log('\nCache command: SET Message')
  console.log(
    'Cache response : ' +
      (await cacheConnection.set('Message', JSON.stringify(message), {
        PX: 100
      }))
  )

  //Duplicate SET
  console.log('\nCache command: SET Message Again')
  console.log(
    'Cache response : ' +
      (await cacheConnection.set('Message', JSON.stringify(message), {
        PX: 10000
      }))
  )

  // GET again
  console.log('\nCache command: GET Message')
  console.log('Cache response : ' + (await cacheConnection.get('Message')))
  message = JSON.parse(await cacheConnection.get('Message'))
  console.log(message.text)

  //DELETE
  console.log('\nCache command: DELETE Message')
  console.log('Cache response : ' + (await cacheConnection.del('Message')))

  // Client list, useful to see if connection list is growing...
  console.log('\nCache command: CLIENT LIST')
  console.log(
    'Cache response : ' +
      (await cacheConnection.sendCommand(['CLIENT', 'LIST']))
  )

  // Disconnect
  cacheConnection.disconnect()

  return 'Done'
}

async function keyvAzureRedisTest() {
  // Environment variables for cache
  const cacheHostName = process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME
  const cachePassword = process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY

  if (!cacheHostName) throw Error('AZURE_CACHE_FOR_REDIS_HOST_NAME is empty')
  if (!cachePassword) throw Error('AZURE_CACHE_FOR_REDIS_ACCESS_KEY is empty')

  let azureRedis = new AzureRedisAdapter({
    cacheHostName: cacheHostName,
    cachePassword: cachePassword
  })

  await azureRedis.connect()

  const redis = new Keyv<types.ChatMessage, any>({
    store: azureRedis
  })

  let message1: types.ChatMessage = {
    role: 'user',
    id: '12345',
    parentMessageId: '67890',
    text: 'hello world 1'
  }

  let message2: types.ChatMessage = {
    role: 'user',
    id: '12345',
    parentMessageId: '67890',
    text: 'hello world 123'
  }

  await redis.set('1', message1)
  await redis.set('2', message2)

  let obj = await redis.get('1')
  console.log(obj?.text)
  obj = await redis.get('2')
  console.log(obj?.text)

  await redis.delete('1')
  await redis.delete('2')

  await azureRedis.disconnect()

  return 'Done'
}
if (process.env.USE_CACHE?.toLowerCase() === 'azureredistest') {
  keyvAzureRedisTest()
    .then((result) => console.log(result))
    .catch((ex) => console.log(ex))

  testCache()
    .then((result) => console.log(result))
    .catch((ex) => console.log(ex))
}
