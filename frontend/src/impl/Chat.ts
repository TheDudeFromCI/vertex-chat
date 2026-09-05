import type { ChatCompletionContentPart, ChatCompletionMessage, ChatCompletionRequest, Uuid } from 'vertex-common'
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
                const contentParts: ChatCompletionContentPart[] = []

                for (const block of msg.content) {
                    if (block.type === 'text') {
                        const content = block.content.trim()
                        if (!content) continue
                        contentParts.push({
                            type: 'text',
                            text: `${name}: ${content}`,
                        })
                    }

                    if (block.type === 'image') {
                        contentParts.push({
                            type: 'image_url',
                            image_url: {
                                url: block.content,
                            },
                        })
                    }

                    if (block.type === 'file_attachment') {
                        const attachmentName = block.name ?? 'attachment'
                        contentParts.push({
                            type: 'text',
                            text: `${name} attached file: ${attachmentName}`,
                        })
                        contentParts.push({
                            type: 'file',
                            file: {
                                filename: attachmentName,
                                file_data: block.content,
                            },
                        })
                    }
                }

                if (contentParts.length === 0) continue
                messages.push({
                    role: 'user',
                    content: contentParts,
                })
            }
        }

        const request: ChatCompletionRequest = {
            prompt: agent.prompt,
            messages,
        }

        return request
    }
}
