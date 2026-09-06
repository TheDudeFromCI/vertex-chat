import test from 'node:test'
import assert from 'node:assert/strict'

import type { ChatCompletionRequest } from 'vertex-common'
import { LLMService } from '../src/services/LLMService.js'
import type { LLMConnection } from '../src/services/LLMConnection.js'

test('prepareRequest preserves reasoning and unique tool call IDs for modern streams', async () => {
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion: async () => new Response('ok', { status: 200 }),
        countInputTokens: async () => 128,
    }

    const service = new LLMService(connection, { model: 'test-model' })

    const request: ChatCompletionRequest = {
        messages: [
            {
                role: 'assistant',
                content: 'First answer',
                thinking: 'First internal reasoning',
            },
            {
                role: 'tool',
                tool_call_id: 'call_123',
                content: 'Tool result',
            },
            {
                role: 'assistant',
                content: 'Second answer',
                thinking: 'Follow-up reasoning',
            },
        ],
    }

    const prepared = await service.prepareRequest(request)

    assert.deepEqual(prepared.messages[0], {
        role: 'assistant',
        content: 'First answer',
        thinking: 'First internal reasoning',
    })

    assert.deepEqual(prepared.messages[1], {
        role: 'tool',
        tool_call_id: 'call_123',
        content: 'Tool result',
    })

    assert.deepEqual(prepared.messages[2], {
        role: 'assistant',
        content: 'Second answer',
        thinking: 'Follow-up reasoning',
    })
})

test('countTokens delegates to the injected connection with the prepared request', async () => {
    let receivedPayload: unknown = null
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion: async () => new Response('ok', { status: 200 }),
        countInputTokens: async (payload) => {
            receivedPayload = payload
            return 321
        },
    }

    const service = new LLMService(connection, { model: 'test-model' })

    const request: ChatCompletionRequest = {
        prompt: 'You are a helpful assistant.',
        messages: [
            {
                role: 'user',
                content: 'Hello there',
            },
        ],
    }

    const tokenCount = await (service as any).countTokens(request)

    assert.equal(tokenCount, 321)
    assert.ok(receivedPayload)
    assert.equal((receivedPayload as any).model, 'test-model')
    assert.deepEqual((receivedPayload as any).messages[0], {
        role: 'system',
        content: 'You are a helpful assistant.',
    })
    assert.deepEqual((receivedPayload as any).messages[1], {
        role: 'user',
        content: 'Hello there',
    })
})

test('optimizeTokenCount trims the oldest conversation when it exceeds the model context window', async () => {
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion: async () => new Response('ok', { status: 200 }),
        countInputTokens: async (payload) => {
            return payload.messages.length * 30
        },
    }

    const service = new LLMService(connection, { model: 'test-model' })
    service.maxTokens = 100
    service.maxOutputTokens = 20

    const request: ChatCompletionRequest = {
        messages: [
            { role: 'user', content: 'message 1' },
            { role: 'assistant', content: 'reply 1', thinking: 'reasoning 1' },
            { role: 'user', content: 'message 2' },
            { role: 'assistant', content: 'reply 2', thinking: 'reasoning 2' },
            { role: 'user', content: 'message 3' },
        ],
    }

    const optimized = await (service as any).optimizeTokenCount(request)

    assert.equal(optimized.messages.length, 2)
    assert.deepEqual(
        optimized.messages.map((message: any) => message.content),
        ['reply 2', 'message 3'],
    )
})
