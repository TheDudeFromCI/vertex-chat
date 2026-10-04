import test, { type TestContext } from 'node:test'
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
        toolContext: {
            conversationId: null,
            agentId: null,
        },
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
        toolContext: {
            conversationId: null,
            agentId: null,
        },
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
        toolContext: {
            conversationId: null,
            agentId: null,
        },
    }

    const optimized = await (service as any).optimizeTokenCount(request)

    assert.equal(optimized.request.messages.length, 2)
    assert.deepEqual(
        optimized.request.messages.map((message: any) => message.content),
        ['reply 2', 'message 3'],
    )
    assert.equal(optimized.totalTokens, 150)
    assert.equal(optimized.truncatedTokens, 60)
})

const textChunk = (content: string) => ({ choices: [{ delta: { content } }] })
const toolChunk = (name: string, args: string) => ({
    choices: [
        { delta: { tool_calls: [{ index: 0, function: { name, arguments: args } }] }, finish_reason: 'tool_calls' },
    ],
})

const sseResponse = (lines: string[]) =>
    new Response(lines.map((l) => `data: ${l}\n`).join('') + 'data: [DONE]\n', { status: 200 })
const sseJson = (chunks: object[]) => sseResponse(chunks.map((c) => JSON.stringify(c)))

const makeService = (createChatCompletion: LLMConnection['createChatCompletion']) => {
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion,
        countInputTokens: async () => 1,
    }
    return new LLMService(connection, { model: 'test-model' })
}

const request = (): ChatCompletionRequest => ({
    messages: [{ role: 'user', content: 'hi' }],
    toolContext: {
        conversationId: null,
        agentId: null,
    },
})

const quiet = (t: TestContext) => {
    t.mock.method(console, 'error', () => {})
    t.mock.method(console, 'log', () => {})
}

test('chatCompletion skips malformed stream lines and keeps the rest', async (t) => {
    quiet(t)
    const service = makeService(async () =>
        sseResponse([JSON.stringify(textChunk('Hello')), '{not json', JSON.stringify(textChunk(' world'))]),
    )

    const result = await service.chatCompletion(request())

    assert.deepEqual(result, [{ type: 'text', content: 'Hello world' }])
})

test('chatCompletion retries a failed request and then succeeds', async (t) => {
    quiet(t)
    let calls = 0
    const service = makeService(async () => {
        calls++
        if (calls === 1) return new Response(JSON.stringify({ error: 'No user query found' }), { status: 400 })
        if (calls === 2) throw new Error('network down')
        return sseJson([textChunk('recovered')])
    })

    const result = await service.chatCompletion(request())

    assert.equal(calls, 3)
    assert.deepEqual(result, [{ type: 'text', content: 'recovered' }])
})

test('chatCompletion throws when the provider fails before any text is generated', async (t) => {
    quiet(t)
    let calls = 0
    const service = makeService(async () => {
        calls++
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    })

    await assert.rejects(service.chatCompletion(request()), /500/)
    assert.equal(calls, 3)
})

test('chatCompletion returns partial text when the provider fails after a tool call', async (t) => {
    quiet(t)
    let calls = 0
    const service = makeService(async () => {
        calls++
        if (calls === 1) return sseJson([textChunk('Let me check. '), toolChunk('echo', '{"a":1}')])
        return new Response(JSON.stringify({ error: 'No user query found' }), { status: 400 })
    })
    service.registerTool({
        name: 'echo',
        description: 'echo',
        params: [],
        needsPermission: false,
        execute: async () => 'tool output',
    })

    const result = await service.chatCompletion(request())

    assert.equal(calls, 4)
    assert.equal(result[0]?.type, 'text')
    assert.equal(result[0]?.content, 'Let me check. ')
    assert.ok(result.some((b) => b.type === 'tool_response_text' && b.content === 'tool output'))
})

test('chatCompletion returns partial text when the stream errors mid-read', async (t) => {
    quiet(t)
    const service = makeService(async () => {
        const encoder = new TextEncoder()
        let pulls = 0
        const body = new ReadableStream({
            // Erroring in start() would discard the queued chunk, so fail on the second read.
            pull(controller) {
                if (pulls++ === 0) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk('partial'))}\n`))
                } else {
                    controller.error(new Error('connection reset'))
                }
            },
        })
        return new Response(body, { status: 200 })
    })

    const result = await service.chatCompletion(request())

    assert.deepEqual(result, [{ type: 'text', content: 'partial' }])
})

test('chatCompletion falls back to an unoptimized request when token counting fails', async (t) => {
    quiet(t)
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion: async () => sseJson([textChunk('ok')]),
        countInputTokens: async () => {
            throw new Error('count endpoint missing')
        },
    }
    const service = new LLMService(connection, { model: 'test-model' })
    service.maxTokens = 100
    service.maxOutputTokens = 20

    const result = await service.chatCompletion(request())

    assert.deepEqual(result, [{ type: 'text', content: 'ok' }])
})

test('chatCompletion reports invalid tool JSON to the model and continues', async (t) => {
    quiet(t)
    let calls = 0
    const req = request()
    const service = makeService(async () => {
        calls++
        if (calls === 1) return sseJson([toolChunk('echo', '{"a": ')])
        return sseJson([textChunk('fixed')])
    })

    const result = await service.chatCompletion(req)

    assert.equal(calls, 2)
    const toolMessage = req.messages.find((m) => m.role === 'tool') as any
    assert.match(toolMessage.content, /invalid JSON/)
    assert.ok(result.some((b) => b.type === 'text' && b.content === 'fixed'))
})

test('chatCompletion stops after repeated invalid tool JSON instead of looping forever', async (t) => {
    quiet(t)
    let calls = 0
    const service = makeService(async () => {
        calls++
        return sseJson([textChunk('x'), toolChunk('echo', '{bad')])
    })

    const result = await service.chatCompletion(request())

    assert.equal(calls, 4)
    assert.equal(result[0]?.type, 'text')
})

test('chatCompletion resets the invalid tool JSON budget after a successful tool call', async (t) => {
    quiet(t)
    let calls = 0
    // Two failures, a success, then two more failures: 5 failures total but never 3 in a row.
    const script = ['{bad', '{bad', '{}', '{bad', '{bad']
    const service = makeService(async () => {
        const args = script[calls++]
        return args === undefined ? sseJson([textChunk('done')]) : sseJson([toolChunk('echo', args)])
    })
    service.registerTool({
        name: 'echo',
        description: 'echo',
        params: [],
        needsPermission: false,
        execute: async () => 'ok',
    })

    const result = await service.chatCompletion(request())

    assert.equal(calls, 6)
    assert.ok(result.some((b) => b.type === 'text' && b.content === 'done'))
})

test('chatCompletion rethrows aborts without retrying', async (t) => {
    quiet(t)
    let calls = 0
    const controller = new AbortController()
    const service = makeService(async () => {
        calls++
        controller.abort()
        throw new DOMException('Request aborted', 'AbortError')
    })

    await assert.rejects(service.chatCompletion(request(), undefined, controller.signal), { name: 'AbortError' })
    assert.equal(calls, 1)
})

const sse = (...chunks: unknown[]) =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 })

test('chatCompletion keeps pre-tool thinking and text in the follow-up request', async () => {
    const payloads: any[] = []
    const streams = [
        sse(
            { choices: [{ delta: { reasoning_content: 'I should check the time.' } }] },
            { choices: [{ delta: { content: 'Let me look.' } }] },
            {
                choices: [
                    {
                        delta: { tool_calls: [{ index: 0, function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }] },
                    },
                ],
            },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ),
        sse({ choices: [{ delta: { content: 'It is noon.' }, finish_reason: 'stop' }] }),
    ]
    const connection: LLMConnection = {
        listModels: async () => ['test-model'],
        createChatCompletion: async (payload) => {
            payloads.push(structuredClone(payload))
            return streams.shift()!
        },
        countInputTokens: async () => 1,
    }
    const service = new LLMService(connection, { model: 'test-model' })
    service.registerTool({
        name: 'get_time',
        description: 'time',
        params: [],
        needsPermission: false,
        execute: async () => 'noon',
    })

    const result = await service.chatCompletion({
        messages: [{ role: 'user', content: 'What time is it?' }],
        toolContext: { conversationId: null, agentId: null },
    })

    assert.equal(payloads.length, 2)
    const followUp = payloads[1].messages
    assert.equal(followUp.length, 3)
    assert.equal(followUp[1].role, 'assistant')
    assert.equal(followUp[1].thinking, 'I should check the time.')
    assert.equal(followUp[1].content, 'Let me look.')
    assert.equal(followUp[1].tool_calls.length, 1)
    assert.equal(followUp[1].tool_calls[0].function.name, 'get_time')
    assert.equal(followUp[1].tool_calls[0].function.arguments, '{"tz":"UTC"}')
    assert.equal(followUp[2].role, 'tool')
    assert.equal(followUp[2].tool_call_id, followUp[1].tool_calls[0].id)

    assert.deepEqual(
        result.map((b) => b.type),
        ['thinking', 'text', 'tool_call', 'tool_response_text', 'text'],
    )
})
