import type {
    ChatCompletionContentPart,
    ChatCompletionMessage,
    ChatCompletionRequest,
    MessageContent,
    Uuid,
} from 'vertex-common'
import type { ConversationStore } from './ConversationStore.js'
import type { PersonaStore } from './PersonaStore.js'

function tryParseToolContent(
    content: string,
): { type: 'image' | 'file_attachment'; content: string; name?: string } | null {
    try {
        const parsed = JSON.parse(content)
        if (!parsed || typeof parsed !== 'object') return null
        if ((parsed.type === 'image' || parsed.type === 'file_attachment') && typeof parsed.content === 'string') {
            return {
                type: parsed.type,
                content: parsed.content,
                name: typeof parsed.name === 'string' ? parsed.name : undefined,
            }
        }
    } catch {
        // Plain text tool responses are ignored.
    }
    return null
}

// Tool call IDs aren't persisted, so they are derived from the message ID and call position.
export function buildAssistantMessages(content: MessageContent, messageId: Uuid): ChatCompletionMessage[] {
    const out: ChatCompletionMessage[] = []
    let thinking: string[] = []
    let text: string[] = []
    let calls: { name: string; args: string }[] = []
    let results: string[] = []
    let callCounter = 0

    const flush = () => {
        const answered = calls.slice(0, results.length)
        const joinedText = text.join('\n').trim()
        const joinedThinking = thinking.join('\n').trim()
        if (answered.length > 0) {
            const ids = answered.map(() => `call_${messageId}_${callCounter++}`)
            out.push({
                role: 'assistant',
                content: joinedText,
                thinking: joinedThinking,
                tool_calls: answered.map((c, i) => ({
                    id: ids[i]!,
                    type: 'function',
                    function: { name: c.name, arguments: c.args },
                })),
            })
            answered.forEach((_, i) => out.push({ role: 'tool', tool_call_id: ids[i]!, content: results[i]! }))
        } else if (joinedText || joinedThinking) {
            out.push({ role: 'assistant', content: joinedText, thinking: joinedThinking })
        }
        thinking = []
        text = []
        calls = []
        results = []
    }

    for (const block of content) {
        if (block.type === 'thinking' || block.type === 'text') {
            // Text after tool results starts a new assistant turn.
            if (calls.length > 0) flush()
            ;(block.type === 'thinking' ? thinking : text).push(block.content)
        } else if (block.type === 'tool_call') {
            try {
                const parsed = JSON.parse(block.content)
                if (typeof parsed?.tool === 'string') {
                    calls.push({ name: parsed.tool, args: JSON.stringify(parsed.args ?? {}) })
                }
            } catch {
                // Malformed call blocks are skipped.
            }
        } else if (block.type.startsWith('tool_response')) {
            if (results.length < calls.length) results.push(block.content)
        }
    }
    flush()
    return out
}

// Mirrors the frontend's ChatManager so server-side generations see the same context.
export function buildChatCompletionRequest(
    conversationStore: ConversationStore,
    personaStore: PersonaStore,
    conversationId: Uuid,
    agentId: Uuid,
): ChatCompletionRequest {
    const conversation = conversationStore.getConversation(conversationId)
    if (!conversation) throw new Error(`Conversation with ID ${conversationId} not found`)
    const agent = personaStore.getPersona(agentId)
    if (!agent) throw new Error(`Agent with ID ${agentId} not found`)

    const messages: ChatCompletionMessage[] = []

    for (const msg of conversation.messages) {
        if (msg.sender === agentId) {
            messages.push(...buildAssistantMessages(msg.content, msg.id))
            continue
        }

        const name = personaStore.getPersona(msg.sender)?.name ?? 'Unknown'
        const parts: ChatCompletionContentPart[] = []

        for (const block of msg.content) {
            if (block.type === 'text') {
                const content = block.content.trim()
                if (content) parts.push({ type: 'text', text: `${name}: ${content}` })
            } else if (block.type === 'image') {
                parts.push({ type: 'image_url', image_url: { url: block.content } })
            } else if (block.type === 'file_attachment') {
                const filename = block.name ?? 'attachment'
                parts.push({ type: 'text', text: `${name} attached file: ${filename}` })
                parts.push({ type: 'file', file: { filename, file_data: block.content } })
            } else if (block.type === 'tool_response_json' || block.type === 'tool_response_text') {
                const parsed = tryParseToolContent(block.content)
                if (parsed?.type === 'image') {
                    parts.push({ type: 'image_url', image_url: { url: parsed.content } })
                } else if (parsed?.type === 'file_attachment') {
                    const filename = parsed.name ?? 'attachment'
                    parts.push({ type: 'text', text: `${name} attached file: ${filename}` })
                    parts.push({ type: 'file', file: { filename, file_data: parsed.content } })
                }
            }
        }

        if (parts.length > 0) messages.push({ role: 'user', content: parts })
    }

    return { prompt: agent.prompt, messages, toolContext: { conversationId, agentId } }
}
