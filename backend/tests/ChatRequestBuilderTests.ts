import test from 'node:test'
import assert from 'node:assert/strict'

import type { MessageContent, Uuid } from 'vertex-common'
import { buildAssistantMessages } from '../src/services/ChatRequestBuilder.js'

const id = 'msg-1' as Uuid

test('buildAssistantMessages replays thinking, tool calls and results in order', () => {
    const content: MessageContent = [
        { type: 'thinking', content: 'Need the time.' },
        { type: 'text', content: 'Checking.' },
        { type: 'tool_call', content: JSON.stringify({ tool: 'get_time', args: { tz: 'UTC' } }) },
        { type: 'tool_response_text', content: 'noon' },
        { type: 'thinking', content: 'Got it.' },
        { type: 'text', content: 'It is noon.' },
    ]

    const messages = buildAssistantMessages(content, id)

    assert.equal(messages.length, 3)
    const [first, tool, last] = messages as any[]
    assert.equal(first.thinking, 'Need the time.')
    assert.equal(first.content, 'Checking.')
    assert.equal(first.tool_calls[0].function.name, 'get_time')
    assert.equal(first.tool_calls[0].function.arguments, '{"tz":"UTC"}')
    assert.equal(tool.role, 'tool')
    assert.equal(tool.tool_call_id, first.tool_calls[0].id)
    assert.equal(tool.content, 'noon')
    assert.equal(last.thinking, 'Got it.')
    assert.equal(last.content, 'It is noon.')
    assert.equal(last.tool_calls, undefined)
})

test('buildAssistantMessages drops tool calls that never received a result', () => {
    const messages = buildAssistantMessages(
        [
            { type: 'thinking', content: 'Hmm.' },
            { type: 'tool_call', content: JSON.stringify({ tool: 'x', args: {} }) },
        ],
        id,
    ) as any[]

    assert.equal(messages.length, 1)
    assert.equal(messages[0].thinking, 'Hmm.')
    assert.equal(messages[0].tool_calls, undefined)
})
