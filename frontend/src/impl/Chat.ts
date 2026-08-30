import type { ChatCompletionMessage, ChatCompletionRequest, Uuid } from 'vertex-common'
import { fetchConversation } from '../api/ConversationsAPI'
import type { App } from '../App'

export class ChatManager {
    private readonly app: App

    constructor(app: App) {
        this.app = app
    }

    async generateChatCompletionRequest(conversationId: Uuid, agentId: Uuid): Promise<ChatCompletionRequest> {
        const conversation = await fetchConversation(conversationId)
        const agent = await this.app.getPersona(agentId)
        const messages: ChatCompletionMessage[] = []

        if (!agent) {
            throw new Error(`Agent with ID ${agentId} not found`)
        }

        const getPersonaName = async (personaId: Uuid): Promise<string> => {
            const persona = await this.app.getPersona(personaId)
            if (!persona) return 'Unknown'
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

                text = text.trim()
                thinking = thinking.trim()
                if (!text && !thinking) continue

                messages.push({ role: 'assistant', content: text, thinking: thinking ?? null })
            } else {
                const name = await getPersonaName(msg.sender)

                for (const block of msg.content) {
                    if (block.type === 'text') {
                        const content = block.content.trim()
                        if (!content) continue
                        messages.push({ role: 'user', content: `${name}: ${content}` })
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
}
