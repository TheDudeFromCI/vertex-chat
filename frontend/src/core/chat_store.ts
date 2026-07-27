import type {
    ChatMessage,
    ConversationIndexEntry,
    ConversationMeta,
    ConversationRecord,
    Participant,
    StoredMessage,
} from '../types/domain';

export class ChatStore {
    private conversations: ConversationMeta[];
    private readonly messageStore: Record<string, ChatMessage[]>;
    private readonly participantStore: Record<string, Participant[]>;
    private readonly conversationMetadataStore: Record<string, Record<string, unknown>>;
    private readonly requestConversation = new Map<string, string>();
    private activeConversationId: string;

    constructor() {
        this.conversations = [];
        this.messageStore = {};
        this.participantStore = {};
        this.conversationMetadataStore = {};
        this.activeConversationId = '';
    }

    getConversations(): ConversationMeta[] {
        return this.conversations;
    }

    getActiveConversationId(): string {
        return this.activeConversationId;
    }

    setActiveConversation(conversationId: string): void {
        this.activeConversationId = conversationId;
    }

    hasConversation(conversationId: string): boolean {
        return this.conversations.some((item) => item.id === conversationId);
    }

    getActiveConversation(): ConversationMeta | undefined {
        return this.conversations.find((item) => item.id === this.activeConversationId);
    }

    setConversations(indexEntries: ConversationIndexEntry[]): void {
        this.conversations = indexEntries.map((entry) => ({
            id: entry.id,
            title: entry.name,
            preview: entry.preview ?? 'No messages yet',
            updatedAt: entry.updatedAt ? new Date(entry.updatedAt * 1000).toISOString() : new Date().toISOString(),
        }));

        if (!this.activeConversationId || !this.hasConversation(this.activeConversationId)) {
            this.activeConversationId = this.conversations[0]?.id ?? '';
        }
    }

    upsertConversation(entry: ConversationIndexEntry): void {
        const mapped: ConversationMeta = {
            id: entry.id,
            title: entry.name,
            preview: entry.preview ?? 'No messages yet',
            updatedAt: entry.updatedAt ? new Date(entry.updatedAt * 1000).toISOString() : new Date().toISOString(),
        };

        const existingIndex = this.conversations.findIndex((item) => item.id === entry.id);
        if (existingIndex >= 0) {
            this.conversations[existingIndex] = mapped;
            return;
        }

        this.conversations.unshift(mapped);
        if (!this.activeConversationId) {
            this.activeConversationId = mapped.id;
        }
    }

    setConversationFromRecord(conversation: ConversationRecord): void {
        this.upsertConversation({
            id: conversation.id,
            name: conversation.name,
            filePath: `${conversation.id}.json`,
            updatedAt: conversation.updatedAt,
            preview: conversation.messages.at(-1)?.content ?? 'No messages yet',
        });
        this.messageStore[conversation.id] = conversation.messages.map((message) => this.mapStoredMessage(message));
        this.participantStore[conversation.id] = conversation.participants;
        this.conversationMetadataStore[conversation.id] = conversation.metadata ?? {};
    }

    getMessages(conversationId: string): ChatMessage[] {
        return this.messageStore[conversationId] ?? [];
    }

    findMessage(conversationId: string, messageId: string): ChatMessage | undefined {
        const messages = this.messageStore[conversationId] ?? [];
        return messages.find((message) => message.id === messageId);
    }

    addMessage(conversationId: string, message: ChatMessage): void {
        if (!this.messageStore[conversationId]) {
            this.messageStore[conversationId] = [];
        }
        this.messageStore[conversationId].push(message);
    }

    updateStoredMessage(conversationId: string, message: StoredMessage): void {
        const messages = this.messageStore[conversationId];
        if (!messages) {
            return;
        }

        const mapped = this.mapStoredMessage(message);
        const index = messages.findIndex((item) => item.id === message.id);
        if (index < 0) {
            return;
        }
        messages[index] = mapped;
    }

    removeConversation(conversationId: string): void {
        this.conversations = this.conversations.filter((conversation) => conversation.id !== conversationId);
        delete this.messageStore[conversationId];
        delete this.participantStore[conversationId];

        if (this.activeConversationId === conversationId) {
            this.activeConversationId = this.conversations[0]?.id ?? '';
        }
    }

    getParticipants(conversationId: string): Participant[] {
        return this.participantStore[conversationId] ?? [];
    }

    getConversationMetadata(conversationId: string): Record<string, unknown> {
        return this.conversationMetadataStore[conversationId] ?? {};
    }

    addStoredMessage(conversationId: string, message: StoredMessage): void {
        this.addMessage(conversationId, this.mapStoredMessage(message));
    }

    updateConversationPreview(conversationId: string, preview: string): void {
        const conversation = this.conversations.find((item) => item.id === conversationId);
        if (!conversation) {
            return;
        }

        conversation.preview = preview.slice(0, 80);
        conversation.updatedAt = new Date().toISOString();
    }

    latestConversationText(conversationId: string): string {
        const messages = this.getMessages(conversationId);
        const latest = [...messages].reverse().find((item) => item.role === 'user' || item.role === 'assistant');
        return latest?.text ?? '';
    }

    mapRequestToConversation(requestId: string, conversationId: string): void {
        this.requestConversation.set(requestId, conversationId);
    }

    resolveConversationId(requestId?: string): string {
        if (!requestId) {
            return this.activeConversationId;
        }
        return this.requestConversation.get(requestId) ?? this.activeConversationId;
    }

    private mapStoredMessage(message: StoredMessage): ChatMessage {
        return {
            id: message.id,
            role: mapSenderToRole(message.sender, message.metadata),
            sender: message.sender,
            text: message.content,
            timestamp: new Date(message.timestamp * 1000).toISOString(),
            metadata: message.metadata,
            status: 'sent',
        };
    }
}

function mapSenderToRole(sender: string, metadata?: Record<string, unknown>): 'user' | 'assistant' | 'system' {
    const metadataRole = metadata?.role;
    if (metadataRole === 'user' || metadataRole === 'assistant' || metadataRole === 'system') {
        return metadataRole;
    }

    if (sender === 'user') {
        return 'user';
    }
    if (sender === 'assistant' || sender.startsWith('assistant')) {
        return 'assistant';
    }
    return 'system';
}
