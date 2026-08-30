import type { ChatCompletionMessage, ChatCompletionRequest, Uuid } from 'vertex-common'
import { fetchConversation, fetchPersona } from '../api/ConversationsAPI'

export async function generateChatCompletionRequest(
    conversationId: Uuid,
    agentId: Uuid,
): Promise<ChatCompletionRequest> {
    const conversation = await fetchConversation(conversationId)
    const agent = await fetchPersona(agentId)
    const messages: ChatCompletionMessage[] = []

    const personaCache = new Map<Uuid, string>()

    const getPersonaName = async (personaId: Uuid): Promise<string> => {
        if (personaCache.has(personaId)) {
            return personaCache.get(personaId)!
        }

        const persona = await fetchPersona(personaId)
        personaCache.set(personaId, persona.name)
        return persona.name
    }

    for (const msg of conversation.messages) {
        if (msg.sender === agentId) {
            let text = ''
            let thinking = ''

            for (const block of msg.content) {
                if (block.type === 'text') {
                    if (text) text += '\n'
                    text += block.content
                } else if (block.type === 'thinking') {
                    if (thinking) thinking += '\n'
                    thinking += block.content
                }
            }

            messages.push({ role: 'assistant', content: text, thinking: thinking ?? null })
        } else {
            const name = await getPersonaName(msg.sender)

            for (const block of msg.content) {
                if (block.type === 'text') {
                    messages.push({ role: 'user', content: `${name}: ${block.content}` })
                }
            }
        }
    }

    const request: ChatCompletionRequest = {
        prompt: agent.prompt,
        messages,
    }

    return request
}
