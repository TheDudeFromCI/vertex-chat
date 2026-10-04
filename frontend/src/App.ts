import type {
    Message,
    MessageContent,
    NewConversation,
    NewWorkspace,
    Persona,
    StreamedLLMEvent,
    SubagentGenerationCompleted,
    SubagentGenerationTriggered,
    Uuid,
} from 'vertex-common'
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
import { generateMessageContent, fetchContextWindow } from './api/ChatGenerationAPI.js'
import { ChatManager } from './impl/Chat.js'
import { GenerationManager, type GenerationTask } from './impl/GenerationManager.js'
import { AGENT_RESPONSE_MODE_KEY, LoadedConversation, type AgentResponseMode } from './impl/LoadedConversation.js'
import { PersonaCache } from './impl/Personas.js'

export type { AgentResponseMode }

type SubagentEvent = NewWorkspace | NewConversation | SubagentGenerationTriggered | SubagentGenerationCompleted

const CONTEXT_TOKENS_KEY = 'contextTokens'

export interface ContextUsage {
    used: number
    promptTokens: number
    totalTokens: number
}

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
    private contextWindow = 0
    private readonly contextTokens = new Map<Uuid, ContextUsage>()

    constructor() {
        fetchContextWindow()
            .then((max) => {
                this.contextWindow = max
                this.chatHistory.refreshInputState()
            })
            .catch((error) => console.error('Failed to load context window size:', error))
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
        if (conversationId) await this.ensureConversationLoaded(conversationId)

        this._conversationId = conversationId

        await this.chatHistory.showConversation()
        await this.contextPanel.reloadParticipants()
    }

    private async ensureConversationLoaded(conversationId: Uuid): Promise<void> {
        if (this.loadedConversations.has(conversationId)) return

        const conversation = await fetchConversation(conversationId)
        this.loadedConversations.set(conversationId, new LoadedConversation(conversation))
        const saved = conversation.metadata[CONTEXT_TOKENS_KEY] as Partial<ContextUsage> | undefined
        if (saved && typeof saved === 'object' && typeof saved.used === 'number') {
            this.contextTokens.set(conversationId, {
                used: saved.used,
                promptTokens: saved.promptTokens ?? 0,
                totalTokens: saved.totalTokens ?? saved.used,
            })
        }
        await this.chatHistory.loadConversation(conversation)
    }

    private isSubagentEvent(event: StreamedLLMEvent): event is SubagentEvent {
        return (
            event.type === 'new_workspace' ||
            event.type === 'new_conversation' ||
            event.type === 'subagent_generation_triggered' ||
            event.type === 'subagent_generation_completed'
        )
    }

    private async handleSubagentEvent(event: SubagentEvent): Promise<void> {
        switch (event.type) {
            case 'new_workspace':
            case 'new_conversation':
            case 'subagent_generation_triggered':
                await this.workspaces.reloadWorkspaces()
                return
            case 'subagent_generation_completed':
                // Drop any stale cached view so the reply shows up.
                if (this.loadedConversations.has(event.conversationId)) {
                    this.loadedConversations.delete(event.conversationId)
                    this.chatHistory.unloadConversation(event.conversationId)
                    await this.ensureConversationLoaded(event.conversationId)
                    if (this._conversationId === event.conversationId) await this.chatHistory.showConversation()
                }
                await this.workspaces.reloadWorkspaces()
                return
        }
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
            this.trackContext(conversationId, event)
            if (event.type === 'begin_llm_generation') return
            if (event.type === 'rename_conversation') {
                await this.renameConversation(conversationId, event.name)
                return
            }
            if (this.isSubagentEvent(event)) {
                await this.handleSubagentEvent(event)
                return
            }
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
            const partial = task.controller.signal.aborted
                ? this.chatHistory.getMessageContent(messagePlaceholder.id)
                : null
            if (partial && partial.length > 0) {
                await updateMessage(messagePlaceholder.id, partial)
            } else {
                await this.deleteMessage(messagePlaceholder.id)
            }
            throw error
        } finally {
            await this.persistContextTokens(conversationId)
        }
    }

    private async runRedo(task: GenerationTask, messageId: Uuid): Promise<void> {
        const { conversationId, agentId } = task
        const previous = this.chatHistory.getMessageContent(messageId)
        if (!previous) return

        const request = await this.chatManager.generateChatCompletionRequest(conversationId, agentId, messageId)
        await this.chatHistory.updateMessage(messageId, [])

        const callback = async (event: StreamedLLMEvent) => {
            this.trackContext(conversationId, event)
            if (event.type === 'begin_llm_generation') return
            if (event.type === 'rename_conversation') {
                await this.renameConversation(conversationId, event.name)
                return
            }
            if (this.isSubagentEvent(event)) {
                await this.handleSubagentEvent(event)
                return
            }
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
            const partial = task.controller.signal.aborted ? this.chatHistory.getMessageContent(messageId) : null
            if (partial && partial.length > 0) {
                await updateMessage(messageId, partial)
            } else {
                await this.chatHistory.updateMessage(messageId, previous)
            }
            throw error
        } finally {
            await this.persistContextTokens(conversationId)
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

    get contextUsage(): ContextUsage & { max: number } {
        const usage = (this._conversationId && this.contextTokens.get(this._conversationId)) || {
            used: 0,
            promptTokens: 0,
            totalTokens: 0,
        }
        return { ...usage, max: this.contextWindow }
    }

    private async persistContextTokens(conversationId: Uuid): Promise<void> {
        const tokens = this.contextTokens.get(conversationId)
        if (tokens === undefined) return

        try {
            const conversation = await fetchConversation(conversationId)
            await updateConversationMetadata(conversationId, { ...conversation.metadata, [CONTEXT_TOKENS_KEY]: tokens })
        } catch (error) {
            console.error('Failed to save context token count:', error)
        }
    }

    // Context usage is the post-truncation prompt size plus tokens streamed since.
    private trackContext(conversationId: Uuid, event: StreamedLLMEvent): void {
        if (event.type === 'begin_llm_generation') {
            this.contextTokens.set(conversationId, {
                used: event.truncatedTokens,
                promptTokens: event.promptTokens,
                totalTokens: event.totalTokens,
            })
        } else if (
            event.type !== 'tool_permission_request' &&
            event.type !== 'rename_conversation' &&
            event.type !== 'new_workspace' &&
            event.type !== 'new_conversation' &&
            event.type !== 'subagent_generation_triggered' &&
            event.type !== 'subagent_generation_completed'
        ) {
            const current = this.contextTokens.get(conversationId) ?? { used: 0, promptTokens: 0, totalTokens: 0 }
            this.contextTokens.set(conversationId, { ...current, used: current.used + event.tokens })
        } else {
            return
        }
        if (conversationId === this._conversationId) this.chatHistory.refreshInputState()
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
