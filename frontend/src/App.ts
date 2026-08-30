import type { Message, MessageContent, Uuid } from 'vertex-common'
import { ChatHistory } from './ui/ChatHistory.js'
import { ContextPanel } from './ui/ContextPanel.js'
import { Workspaces } from './ui/Workspaces.js'
import { Header } from './ui/Header.js'
import { createMessage, updateMessage } from './api/ConversationsAPI.js'
import { generateChatCompletionRequest } from './impl/Chat.js'
import { generateMessageContent } from './api/LLM.js'

export class App {
    private readonly header: Header
    private readonly chatHistory: ChatHistory
    private readonly workspaces: Workspaces
    private readonly contextPanel: ContextPanel
    private _userId: Uuid | null = null
    private _conversationId: Uuid | null = null

    constructor() {
        this.header = new Header(this)
        this.chatHistory = new ChatHistory(this)
        this.workspaces = new Workspaces(this)
        this.contextPanel = new ContextPanel()
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'app'

        const verticalLayout = document.createElement('div')
        verticalLayout.classList.add('vertical-layout')
        div.appendChild(verticalLayout)

        const headerDiv = this.header.build()
        verticalLayout.appendChild(headerDiv)

        const horizontalLayout = document.createElement('div')
        horizontalLayout.classList.add('horizontal-layout')
        verticalLayout.appendChild(horizontalLayout)

        const workspacesDiv = this.workspaces.build()
        horizontalLayout.appendChild(workspacesDiv)

        const chatHistoryDiv = this.chatHistory.build()
        horizontalLayout.appendChild(chatHistoryDiv)

        const contextPanelDiv = this.contextPanel.build()
        horizontalLayout.appendChild(contextPanelDiv)

        return div
    }

    async reloadWorkspaces(): Promise<void> {
        await this.workspaces.reloadWorkspaces()
    }

    async loadConversation(conversationId: Uuid | null): Promise<void> {
        this._conversationId = conversationId
        await this.chatHistory.reloadConversation()
    }

    async sendMessage(
        conversationId: Uuid,
        sender: Uuid,
        content: MessageContent,
        metadata?: Record<string, unknown>,
    ): Promise<Message> {
        const message = await createMessage(conversationId, sender, content, metadata)
        await this.chatHistory.appendMessage(message)
        return message
    }

    async generateAgentMessage(conversationId: Uuid, agentId: Uuid): Promise<void> {
        const messagePlaceholder = await this.sendMessage(conversationId, agentId, [])
        const request = await generateChatCompletionRequest(conversationId, agentId)

        const callback = async (messageContent: MessageContent) => {
            // await updateMessage(messagePlaceholder.id, messageContent)
            await this.chatHistory.updateMessage(messagePlaceholder.id, messageContent)
        }

        const generated = await generateMessageContent(request, callback)
        await updateMessage(messagePlaceholder.id, generated)
        await this.chatHistory.updateMessage(messagePlaceholder.id, generated)
    }

    async setUserId(userId: Uuid | null): Promise<void> {
        this._userId = userId
        await this.chatHistory.reloadConversation()
    }

    async reloadPersonas(): Promise<void> {
        await this.header.reloadPersonas()
    }

    get userId(): Uuid | null {
        return this._userId
    }

    get conversationId(): Uuid | null {
        return this._conversationId
    }
}
