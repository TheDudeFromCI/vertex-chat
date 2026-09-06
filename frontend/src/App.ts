import type { Message, MessageContent, Persona, StreamedLLMEvent, Uuid } from 'vertex-common'
import { ChatHistory } from './ui/ChatHistory.js'
import { ContextPanel } from './ui/ContextPanel.js'
import { Workspaces } from './ui/Workspaces.js'
import {
    createMessage,
    deleteConversation,
    deleteMessage as deleteMessageApi,
    fetchConversation,
    renameConversation,
    updateConversationMetadata,
    updateMessage,
} from './api/ConversationsAPI.js'
import { generateMessageContent } from './api/ChatGenerationAPI.js'
import { ChatManager } from './impl/Chat.js'
import { PersonaCache } from './impl/Personas.js'

export type AgentResponseMode = 'manual' | 'automatic' | 'collaborative'

const AGENT_RESPONSE_MODE_KEY = 'agentResponseMode'

export class App {
    private readonly chatHistory: ChatHistory
    private readonly workspaces: Workspaces
    private readonly contextPanel: ContextPanel
    private readonly personaCache: PersonaCache
    private readonly chatManager: ChatManager
    private _userId: Uuid | null = null
    private _conversationId: Uuid | null = null
    private _agentResponseMode: AgentResponseMode = 'manual'
    private automationQueue: Promise<void> = Promise.resolve()

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

        if (!conversationId) {
            this._agentResponseMode = 'manual'
        } else {
            const conversation = await fetchConversation(conversationId)
            this._agentResponseMode = this.parseAgentResponseMode(conversation.metadata[AGENT_RESPONSE_MODE_KEY])
        }

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
        options?: { suppressAutomation?: boolean },
    ): Promise<Message> {
        const message = await createMessage(conversationId, sender, content, metadata)
        await this.chatHistory.appendMessage(message)

        if (!options?.suppressAutomation) {
            this.enqueueAutoResponse(conversationId, sender)
        }

        return message
    }

    async deleteMessage(messageId: Uuid): Promise<void> {
        await deleteMessageApi(messageId)
        await this.chatHistory.removeMessage(messageId)
    }

    async generateAgentMessage(conversationId: Uuid, agentId: Uuid, signal?: AbortSignal): Promise<void> {
        const messagePlaceholder = await this.sendMessage(conversationId, agentId, [], undefined, {
            suppressAutomation: true,
        })
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
            this.enqueueAutoResponse(conversationId, agentId)
        } catch (error) {
            await this.deleteMessage(messagePlaceholder.id)
            throw error
        }
    }

    async setUserId(userId: Uuid | null): Promise<void> {
        this._userId = userId
        await this.chatHistory.reloadConversation()
    }

    async setAgentResponseMode(mode: AgentResponseMode): Promise<void> {
        this._agentResponseMode = mode

        if (!this._conversationId) {
            return
        }

        const conversation = await fetchConversation(this._conversationId)
        const nextMetadata = {
            ...conversation.metadata,
            [AGENT_RESPONSE_MODE_KEY]: mode,
        }

        await updateConversationMetadata(this._conversationId, nextMetadata)
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

    get agentResponseMode(): AgentResponseMode {
        return this._agentResponseMode
    }

    get personaList(): Readonly<Persona[]> {
        return this.personaCache.list
    }

    private enqueueAutoResponse(conversationId: Uuid, sender: Uuid): void {
        this.automationQueue = this.automationQueue
            .then(async () => {
                await this.generateAutoResponse(conversationId, sender)
            })
            .catch((error) => {
                console.error('Automatic response generation failed:', error)
            })
    }

    private async generateAutoResponse(conversationId: Uuid, sender: Uuid): Promise<void> {
        if (this._conversationId !== conversationId) {
            return
        }

        const userId = this._userId
        if (!userId) {
            return
        }

        if (this._agentResponseMode === 'manual') {
            return
        }

        if (this._agentResponseMode === 'automatic' && sender !== userId) {
            return
        }

        const conversation = await fetchConversation(conversationId)
        const nonSelectedParticipants = conversation.participants.filter((participantId) => participantId !== userId)

        const eligibleParticipants =
            this._agentResponseMode === 'collaborative'
                ? nonSelectedParticipants.filter((participantId) => participantId !== sender)
                : nonSelectedParticipants

        if (eligibleParticipants.length === 0) {
            return
        }

        const randomIndex = Math.floor(Math.random() * eligibleParticipants.length)
        const responderId = eligibleParticipants[randomIndex]
        if (!responderId) {
            return
        }

        await this.generateAgentMessage(conversationId, responderId)
    }

    private parseAgentResponseMode(mode: unknown): AgentResponseMode {
        if (mode === 'automatic' || mode === 'collaborative') {
            return mode
        }

        return 'manual'
    }
}
