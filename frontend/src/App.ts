import type { Message, MessageContent, Persona, StreamedLLMEvent, Uuid } from 'vertex-common'
import { ChatHistory } from './ui/ChatHistory.js'
import { ContextPanel } from './ui/ContextPanel.js'
import { Workspaces } from './ui/Workspaces.js'
import {
    createMessage,
    deleteConversation,
    deleteMessage as deleteMessageApi,
    renameConversation,
    updateMessage,
} from './api/ConversationsAPI.js'
import { generateMessageContent } from './api/ChatGenerationAPI.js'
import { ChatManager } from './impl/Chat.js'
import { PersonaCache } from './impl/Personas.js'

export class App {
    private readonly chatHistory: ChatHistory
    private readonly workspaces: Workspaces
    private readonly contextPanel: ContextPanel
    private readonly personaCache: PersonaCache
    private readonly chatManager: ChatManager
    private _userId: Uuid | null = null
    private _conversationId: Uuid | null = null

    constructor() {
        this.chatHistory = new ChatHistory(this)
        this.workspaces = new Workspaces(this)
        this.contextPanel = new ContextPanel(this)
        this.personaCache = new PersonaCache()
        this.chatManager = new ChatManager(this)
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'app'

        const verticalLayout = document.createElement('div')
        verticalLayout.classList.add('vertical-layout')
        div.appendChild(verticalLayout)

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
        await this.contextPanel.reloadParticipants()
    }

    async deleteConversation(conversationId: Uuid): Promise<void> {
        if (this._conversationId === conversationId) {
            this._conversationId = null
        }

        await deleteConversation(conversationId)
        await this.chatHistory.reloadConversation()
        await this.contextPanel.reloadParticipants()
        await this.workspaces.reloadWorkspaces()
    }

    async renameConversation(conversationId: Uuid, newName: string): Promise<void> {
        await renameConversation(conversationId, newName)
        await this.workspaces.reloadWorkspaces()
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

    async deleteMessage(messageId: Uuid): Promise<void> {
        await deleteMessageApi(messageId)
        await this.chatHistory.removeMessage(messageId)
    }

    async generateAgentMessage(conversationId: Uuid, agentId: Uuid, signal?: AbortSignal): Promise<void> {
        const messagePlaceholder = await this.sendMessage(conversationId, agentId, [])
        const request = await this.chatManager.generateChatCompletionRequest(conversationId, agentId)

        const callback = async (event: StreamedLLMEvent) => {
            if (event.type === 'tool_permission_request') {
                await this.chatHistory.showToolPermissionRequest(messagePlaceholder.id, event)
                return
            }

            await this.chatHistory.streamMessageContent(messagePlaceholder.id, event)
        }

        try {
            const generated = await generateMessageContent(request, callback, signal)
            await updateMessage(messagePlaceholder.id, generated)
            await this.chatHistory.updateMessage(messagePlaceholder.id, generated)
        } catch (error) {
            await this.deleteMessage(messagePlaceholder.id)
            throw error
        }
    }

    async setUserId(userId: Uuid | null): Promise<void> {
        this._userId = userId
        await this.chatHistory.reloadConversation()
    }

    async reloadPersonas(): Promise<void> {
        await this.personaCache.reloadAllPersonas()
        await this.contextPanel.reloadParticipants()
    }

    async getPersona(id: Uuid): Promise<Persona | null> {
        return await this.personaCache.getPersona(id)
    }

    get userId(): Uuid | null {
        return this._userId
    }

    get conversationId(): Uuid | null {
        return this._conversationId
    }

    get personaList(): Readonly<Persona[]> {
        return this.personaCache.list
    }
}
