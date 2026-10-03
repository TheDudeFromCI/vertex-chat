import type { ChatCompletionContentPart, ChatCompletionMessage, ChatCompletionRequest, Uuid } from 'vertex-common'
import { fetchConversation } from '../api/ConversationsAPI'
import type { App } from '../App'

export class ChatManager {
    private readonly app: App

    constructor(app: App) {
        this.app = app
    }

    private tryParseToolContent(
        content: string,
    ): { type: 'image' | 'file_attachment'; content: string; name?: string } | null {
        try {
            const parsed = JSON.parse(content)
            if (!parsed || typeof parsed !== 'object') {
                return null
            }

            if (parsed.type === 'image' && typeof parsed.content === 'string') {
                return {
                    type: 'image',
                    content: parsed.content,
                    name: typeof parsed.name === 'string' ? parsed.name : undefined,
                }
            }

            if (parsed.type === 'file_attachment' && typeof parsed.content === 'string') {
                return {
                    type: 'file_attachment',
                    content: parsed.content,
                    name: typeof parsed.name === 'string' ? parsed.name : undefined,
                }
            }
        } catch {
            // Tool responses that are plain text remain plain text.
        }

        return null
    }

    async generateChatCompletionRequest(
        conversationId: Uuid,
        agentId: Uuid,
        excludeMessageId?: Uuid,
    ): Promise<ChatCompletionRequest> {
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
            if (msg.id === excludeMessageId) continue

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

                    if (block.type === 'tool_response_json' || block.type === 'tool_response_text') {
                        const parsed = this.tryParseToolContent(block.content)
                        if (parsed?.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: {
                                    url: parsed.content,
                                },
                            })
                        }
                        if (parsed?.type === 'file_attachment') {
                            contentParts.push({
                                type: 'text',
                                text: `${name} attached file: ${parsed.name ?? 'attachment'}`,
                            })
                            contentParts.push({
                                type: 'file',
                                file: {
                                    filename: parsed.name ?? 'attachment',
                                    file_data: parsed.content,
                                },
                            })
                        }
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
            toolContext: {
                conversationId,
            },
        }

        return request
    }
}
