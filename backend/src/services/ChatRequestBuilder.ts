import type { ChatCompletionContentPart, ChatCompletionMessage, ChatCompletionRequest, Uuid } from 'vertex-common'
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
            const text = msg.content
                .filter((block) => block.type === 'text')
                .map((block) => block.content)
                .join('\n')
                .trim()
            const thinking = msg.content
                .filter((block) => block.type === 'thinking')
                .map((block) => block.content)
                .join('\n')
                .trim()
            if (!text && !thinking) continue

            messages.push({ role: 'assistant', content: text, thinking })
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
