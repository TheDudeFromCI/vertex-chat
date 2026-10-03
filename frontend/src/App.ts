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
import { GenerationManager, type GenerationTask } from './impl/GenerationManager.js'
import { AGENT_RESPONSE_MODE_KEY, LoadedConversation, type AgentResponseMode } from './impl/LoadedConversation.js'
import { PersonaCache } from './impl/Personas.js'

export type { AgentResponseMode }

export class App {
    private readonly chatHistory: ChatHistory
    private readonly workspaces: Workspaces
    private readonly contextPanel: ContextPanel
    private readonly personaCache: PersonaCache
    private readonly chatManager: ChatManager
    private _userId: Uuid | null = null
    private _conversationId: Uuid | null = null
    private readonly loadedConversations = new Map<Uuid, LoadedConversation>()
    private readonly generations: GenerationManager
    private automationQueue: Promise<void> = Promise.resolve()

    constructor() {
        this.chatHistory = new ChatHistory(this)
        this.workspaces = new Workspaces(this)
        this.contextPanel = new ContextPanel(this)
        this.personaCache = new PersonaCache()
        this.chatManager = new ChatManager(this)
        this.generations = new GenerationManager((task) => this.runGeneration(task))
        this.generations.onChange(() => {
            this.workspaces.refreshGenerationIndicators()
            this.chatHistory.refreshInputState()
        })
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
        if (conversationId && !this.loadedConversations.has(conversationId)) {
            const conversation = await fetchConversation(conversationId)
            this.loadedConversations.set(conversationId, new LoadedConversation(conversation))
            await this.chatHistory.loadConversation(conversation)
        }

        this._conversationId = conversationId

        await this.chatHistory.showConversation()
        await this.contextPanel.reloadParticipants()
    }

    async deleteConversation(conversationId: Uuid): Promise<void> {
        if (this._conversationId === conversationId) {
            this._conversationId = null
        }

        this.generations.cancel(conversationId)
        this.loadedConversations.delete(conversationId)
        this.chatHistory.unloadConversation(conversationId)

        await deleteConversation(conversationId)
        await this.chatHistory.showConversation()
        await this.contextPanel.reloadParticipants()
        await this.workspaces.reloadWorkspaces()
    }

    isGenerating(conversationId: Uuid): boolean {
        return this.generations.isGenerating(conversationId)
    }

    cancelGeneration(conversationId: Uuid): void {
        this.generations.cancel(conversationId)
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

    generateAgentMessage(conversationId: Uuid, agentId: Uuid): Promise<void> {
        return this.generations.enqueue(conversationId, agentId)
    }

    redoMessage(conversationId: Uuid, agentId: Uuid, messageId: Uuid): Promise<void> {
        return this.generations.enqueue(conversationId, agentId, messageId)
    }

    private async runGeneration(task: GenerationTask): Promise<void> {
        const { conversationId, agentId, redoMessageId } = task
        if (redoMessageId) {
            await this.runRedo(task, redoMessageId)
            return
        }

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
            const generated = await generateMessageContent(request, callback, task.controller.signal)
            await updateMessage(messagePlaceholder.id, generated)
            await this.chatHistory.updateMessage(messagePlaceholder.id, generated)
            this.enqueueAutoResponse(conversationId, agentId)
        } catch (error) {
            await this.deleteMessage(messagePlaceholder.id)
            throw error
        }
    }

    private async runRedo(task: GenerationTask, messageId: Uuid): Promise<void> {
        const { conversationId, agentId } = task
        const previous = this.chatHistory.getMessageContent(messageId)
        if (!previous) return

        const request = await this.chatManager.generateChatCompletionRequest(conversationId, agentId, messageId)
        await this.chatHistory.updateMessage(messageId, [])

        const callback = async (event: StreamedLLMEvent) => {
            if (event.type === 'tool_permission_request') {
                await this.chatHistory.showToolPermissionRequest(messageId, event)
                return
            }

            await this.chatHistory.streamMessageContent(messageId, event)
        }

        try {
            const generated = await generateMessageContent(request, callback, task.controller.signal)
            await updateMessage(messageId, generated)
            await this.chatHistory.updateMessage(messageId, generated)
            this.enqueueAutoResponse(conversationId, agentId)
        } catch (error) {
            await this.chatHistory.updateMessage(messageId, previous)
            throw error
        }
    }

    async setUserId(userId: Uuid | null): Promise<void> {
        this._userId = userId
        await this.chatHistory.reloadAll()
    }

    async setAgentResponseMode(mode: AgentResponseMode): Promise<void> {
        const loaded = this._conversationId ? this.loadedConversations.get(this._conversationId) : undefined
        if (!loaded) {
            return
        }

        const conversation = await fetchConversation(loaded.id)
        loaded.setAgentResponseMode(mode)
        await updateConversationMetadata(loaded.id, { ...conversation.metadata, [AGENT_RESPONSE_MODE_KEY]: mode })
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
        const loaded = this._conversationId ? this.loadedConversations.get(this._conversationId) : undefined
        return loaded?.agentResponseMode ?? 'manual'
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
                if (error instanceof DOMException && error.name === 'AbortError') return
                console.error('Automatic response generation failed:', error)
            })
    }

    private async generateAutoResponse(conversationId: Uuid, sender: Uuid): Promise<void> {
        const loaded = this.loadedConversations.get(conversationId)
        if (!loaded) {
            return
        }

        const userId = this._userId
        if (!userId) {
            return
        }

        const mode = loaded.agentResponseMode
        if (mode === 'manual') {
            return
        }

        if (mode === 'automatic' && sender !== userId) {
            return
        }

        const conversation = await fetchConversation(conversationId)
        const nonSelectedParticipants = conversation.participants.filter((participantId) => participantId !== userId)

        const eligibleParticipants =
            mode === 'collaborative'
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
}
