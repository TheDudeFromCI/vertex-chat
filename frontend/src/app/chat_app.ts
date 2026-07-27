import { ChatStore } from '../core/chat_store';
import { ConnectionManager } from '../core/connection_manager';
import { getOrCreateClientId, newMessageId, newRequestId, shortClientId } from '../core/client_identity';
import type { Persona, ToolDefinition } from '../types/domain';
import type { ServerEvent } from '../types/protocol';
import { ChatView } from '../ui/chat_view';

export class ChatApp {
    private readonly store = new ChatStore();
    private readonly clientId = getOrCreateClientId();
    private readonly connection: ConnectionManager;
    private readonly view: ChatView;
    private toolsCatalog: ToolDefinition[] = [];
    private personas: Persona[] = [];

    constructor(root: HTMLDivElement) {
        this.view = new ChatView(root);
        this.connection = new ConnectionManager(this.clientId, {
            onState: (label, variant) => this.view.setConnectionState(label, variant),
            onSession: () => { },
            onEvent: (payload) => this.handleServerEvent(payload),
            onLog: (entry) => console.log(entry),
        });
    }

    start(): void {
        this.view.setClientId(shortClientId(this.clientId));
        this.view.bind({
            onSelectConversation: (conversationId) => {
                this.store.setActiveConversation(conversationId);
                this.renderConversations();
                this.renderActiveConversation();
                this.connection.enqueue({ type: 'load_conversation', conversationId, requestId: newRequestId() });
            },
            onNewConversation: () => {
                this.createConversation();
            },
            onAddAssistant: (personaId) => this.addAssistantToConversation(personaId),
            onSetActiveAssistant: (participantId) => this.setActiveAssistant(participantId),
            onChangeParticipantPersona: (participantId, personaId) => this.changeParticipantPersona(participantId, personaId),
            onDeleteConversation: (conversationId) => {
                const confirmDelete = window.confirm('Delete this conversation? This cannot be undone.');
                if (!confirmDelete) {
                    return;
                }
                this.connection.enqueue({ type: 'delete_conversation', conversationId, requestId: newRequestId() });
            },
            onCloneConversation: (conversationId) => {
                this.connection.enqueue({ type: 'clone_conversation', conversationId, requestId: newRequestId() });
            },
            onSendMessage: (message) => this.sendMessage(message),
            onEditMessage: (messageId) => this.editMessage(messageId),
            onCopyMessage: (messageId) => {
                void this.copyMessage(messageId);
            },
            onPing: () => {
                this.connection.enqueue({ type: 'ping', requestId: newRequestId() });
            },
            onRunTool: () => this.runTool(),
            onRefreshTools: () => {
                void this.loadTools();
            },
        });

        this.renderConversations();
        this.renderActiveConversation();
        void this.loadTools();
        void this.loadPersonas();
        this.connection.connect();
    }

    private createConversation(personaId?: string): void {
        const requestId = newRequestId();
        const persona = personaId ? this.personas.find((item) => item.id === personaId) : undefined;
        const assistantDisplayName = persona?.name ?? 'Assistant';
        const participants = [
            { id: 'user', displayName: 'User', role: 'user', metadata: {} },
            {
                id: 'assistant',
                displayName: assistantDisplayName,
                role: 'assistant',
                metadata: persona ? { personaId: persona.id } : {},
            },
        ];

        this.connection.enqueue({
            type: 'create_conversation',
            name: persona ? `${assistantDisplayName} Session` : `Conversation ${new Date().toLocaleTimeString()}`,
            participants,
            metadata: persona ? { personaId: persona.id } : {},
            requestId,
        });
    }

    private addAssistantToConversation(personaId: string): void {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            console.error('No active conversation selected');
            return;
        }

        const persona = this.personas.find((item) => item.id === personaId);
        if (!persona) {
            console.error('No persona selected');
            return;
        }

        const participantId = `assistant_${persona.id}_${Math.random().toString(36).slice(2, 8)}`;
        this.connection.enqueue({
            type: 'add_participant',
            conversationId,
            participant: {
                id: participantId,
                displayName: persona.name,
                role: 'assistant',
                metadata: { personaId: persona.id },
            },
            requestId: newRequestId(),
        });
    }

    private setActiveAssistant(participantId: string): void {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            return;
        }

        this.connection.enqueue({
            type: 'set_active_assistant',
            conversationId,
            participantId,
            requestId: newRequestId(),
        });
    }

    private changeParticipantPersona(participantId: string, personaId: string): void {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            return;
        }

        const persona = this.personas.find((item) => item.id === personaId);
        if (!persona) {
            return;
        }

        this.connection.enqueue({
            type: 'update_participant_persona',
            conversationId,
            participantId,
            personaId,
            personaName: persona.name,
            requestId: newRequestId(),
        });
    }

    private sendMessage(message: string): void {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            console.error('No active conversation selected');
            return;
        }

        this.connection.enqueue({
            type: 'send_message',
            conversationId,
            sender: 'user',
            content: message,
            metadata: {},
            requestId: newRequestId(),
        });
    }

    private runTool(): void {
        const tool = this.toolsCatalog.find((item) => item.id === 'story.continue') ?? this.toolsCatalog[0];
        if (!tool) {
            console.error('No tools available yet');
            return;
        }

        const requestId = newRequestId();
        const conversationId = this.store.getActiveConversationId();
        this.store.mapRequestToConversation(requestId, conversationId);

        const inputText = this.view.getComposerText() || this.store.latestConversationText(conversationId);
        this.store.addMessage(conversationId, {
            id: newMessageId(),
            role: 'system',
            sender: 'system',
            text: `Invoking tool: ${tool.name}`,
            timestamp: new Date().toISOString(),
            status: 'pending',
            requestId,
        });

        this.connection.enqueue({
            type: 'invoke_tool',
            toolId: tool.id,
            input: {
                text: inputText || 'Start the scene at dawn.',
                tone: 'cinematic',
                selection: inputText || 'The door opened.',
                instruction: 'more vivid',
            },
            requestId,
        });

        this.renderActiveConversation();
    }

    private handleServerEvent(payload: ServerEvent): void {
        if (payload.type === 'welcome') {
            console.log(`Session resynced${formatRequestId(payload.requestId)}`);
            return;
        }

        if (payload.type === 'pong') {
            console.log(`Heartbeat acknowledged${formatRequestId(payload.requestId)}`);
            return;
        }

        if (payload.type === 'conversation_list') {
            this.store.setConversations(payload.conversations);
            this.renderConversations();
            this.renderActiveConversation();

            const activeId = this.store.getActiveConversationId();
            if (activeId) {
                this.connection.enqueue({ type: 'load_conversation', conversationId: activeId, requestId: newRequestId() });
            }
            console.log(`Loaded ${payload.conversations.length} conversations`);
            return;
        }

        if (payload.type === 'conversation_created') {
            this.store.upsertConversation(payload.conversation);
            this.store.setActiveConversation(payload.conversation.id);
            this.renderConversations();
            this.renderActiveConversation();
            console.log(`Conversation created: ${payload.conversation.name}`);
            return;
        }

        if (payload.type === 'conversation_loaded') {
            this.store.setConversationFromRecord(payload.conversation);
            if (!this.store.getActiveConversationId()) {
                this.store.setActiveConversation(payload.conversation.id);
            }
            this.renderConversations();
            this.renderActiveConversation();
            console.log(`Conversation loaded: ${payload.conversation.name}`);
            return;
        }

        if (payload.type === 'conversation_deleted') {
            this.store.removeConversation(payload.conversationId);
            this.renderConversations();
            this.renderActiveConversation();
            console.log(`Conversation deleted: ${payload.conversationId}`);
            return;
        }

        if (payload.type === 'message_appended') {
            this.store.addStoredMessage(payload.conversationId, payload.message);
            this.store.updateConversationPreview(payload.conversationId, payload.message.content);
            this.renderConversations();
            this.renderActiveConversation();
            return;
        }

        if (payload.type === 'message_updated') {
            this.store.updateStoredMessage(payload.conversationId, payload.message);
            this.store.updateConversationPreview(payload.conversationId, payload.message.content);
            this.renderConversations();
            this.renderActiveConversation();
            console.log(`Message edited in ${payload.conversationId}`);
            return;
        }

        if (payload.type === 'echo') {
            console.log(`Echoed${formatRequestId(payload.requestId)}`);
            return;
        }

        if (payload.type === 'tool_started') {
            const conversationId = this.store.resolveConversationId(payload.requestId);
            this.store.addMessage(conversationId, {
                id: newMessageId(),
                role: 'system',
                sender: 'system',
                text: `Tool started: ${payload.toolId}`,
                timestamp: new Date().toISOString(),
                status: 'pending',
                requestId: payload.requestId,
            });
            console.log(`Tool started: ${payload.toolId}${formatRequestId(payload.requestId)}`);
            this.renderActiveConversation();
            return;
        }

        if (payload.type === 'tool_result') {
            const conversationId = this.store.resolveConversationId(payload.requestId);
            const resultText = normalizeToolResult(payload.result);
            this.store.addMessage(conversationId, {
                id: newMessageId(),
                role: 'assistant',
                sender: 'assistant',
                text: resultText,
                timestamp: new Date().toISOString(),
                status: 'sent',
                requestId: payload.requestId,
            });
            this.store.updateConversationPreview(conversationId, resultText);
            console.log(`Tool result: ${payload.toolId}${formatRequestId(payload.requestId)}`);
            this.renderConversations();
            this.renderActiveConversation();
            return;
        }

        if (payload.type === 'tool_error') {
            const conversationId = this.store.resolveConversationId(payload.requestId);
            this.store.addMessage(conversationId, {
                id: newMessageId(),
                role: 'system',
                sender: 'system',
                text: `Tool error${payload.toolId ? ` (${payload.toolId})` : ''}: ${payload.message}`,
                timestamp: new Date().toISOString(),
                status: 'error',
                requestId: payload.requestId,
            });
            console.error(`Tool error: ${payload.message}${formatRequestId(payload.requestId)}`);
            this.renderActiveConversation();
            return;
        }

        if (payload.type === 'error') {
            const conversationId = this.store.resolveConversationId(payload.requestId);
            this.store.addMessage(conversationId, {
                id: newMessageId(),
                role: 'system',
                sender: 'system',
                text: `Server error: ${payload.message}`,
                timestamp: new Date().toISOString(),
                status: 'error',
                requestId: payload.requestId,
            });
            console.error(`Server error: ${payload.message}${formatRequestId(payload.requestId)}`);
            this.renderActiveConversation();
        }
    }

    private async loadTools(): Promise<void> {
        try {
            const response = await fetch('/api/tools');
            if (!response.ok) {
                throw new Error(`Tools endpoint failed with ${response.status}`);
            }

            const payload = (await response.json()) as { tools?: ToolDefinition[] };
            this.toolsCatalog = payload.tools ?? [];
            this.view.renderTools(this.toolsCatalog);
            console.log(`Loaded ${this.toolsCatalog.length} tools`);
        } catch (error) {
            console.error(`Failed to load tools: ${toErrorMessage(error)}`);
        }
    }

    private async loadPersonas(): Promise<void> {
        try {
            const response = await fetch('/api/personas');
            if (!response.ok) {
                throw new Error(`Personas endpoint failed with ${response.status}`);
            }

            const payload = (await response.json()) as { personas?: Persona[] };
            this.personas = payload.personas ?? [];
            this.view.renderPersonas(this.personas);
            console.log(`Loaded ${this.personas.length} personas`);
        } catch (error) {
            console.error(`Failed to load personas: ${toErrorMessage(error)}`);
        }
    }

    private editMessage(messageId: string): void {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            return;
        }

        const existing = this.store.findMessage(conversationId, messageId);
        if (!existing) {
            console.error(`Message not found: ${messageId}`);
            return;
        }

        const updatedText = window.prompt('Edit message', existing.text);
        if (!updatedText) {
            return;
        }

        this.connection.enqueue({
            type: 'edit_message',
            conversationId,
            messageId,
            content: updatedText,
            requestId: newRequestId(),
        });
    }

    private async copyMessage(messageId: string): Promise<void> {
        const conversationId = this.store.getActiveConversationId();
        if (!conversationId) {
            return;
        }

        const existing = this.store.findMessage(conversationId, messageId);
        if (!existing) {
            console.error(`Message not found: ${messageId}`);
            return;
        }

        try {
            await navigator.clipboard.writeText(existing.text);
            console.log('Message copied to clipboard');
        } catch (error) {
            console.error(`Copy failed: ${toErrorMessage(error)}`);
        }
    }

    private renderConversations(): void {
        this.view.renderConversations(this.store.getConversations(), this.store.getActiveConversationId());
    }

    private renderActiveConversation(): void {
        const active = this.store.getActiveConversation();
        const title = active?.title ?? 'Conversation';
        const conversationId = this.store.getActiveConversationId();
        const messages = conversationId ? this.store.getMessages(conversationId) : [];
        this.view.renderMessages(title, messages);
        const participants = conversationId ? this.store.getParticipants(conversationId) : [];
        const metadata = conversationId ? this.store.getConversationMetadata(conversationId) : {};
        const activeAssistantId =
            typeof metadata.activeAssistantId === 'string' && metadata.activeAssistantId
                ? metadata.activeAssistantId
                : findFirstAssistantId(participants);
        this.view.renderParticipants(participants, this.personas, activeAssistantId);
    }
}

function formatRequestId(requestId?: string): string {
    return requestId ? ` (#${requestId.slice(0, 8)})` : '';
}

function normalizeToolResult(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }

    if (typeof result === 'object' && result !== null && 'text' in result) {
        const textValue = (result as { text?: unknown }).text;
        if (typeof textValue === 'string') {
            return textValue;
        }
    }

    return JSON.stringify(result, null, 2);
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function findFirstAssistantId(participants: Array<{ id: string; role?: string }>): string {
    const assistant = participants.find((participant) => participant.role === 'assistant');
    return assistant?.id ?? '';
}
