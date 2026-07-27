export type SessionSnapshot = {
    clientId: string;
    connected: boolean;
    connectionCount: number;
    messageCount: number;
    lastPayload: unknown;
    lastSeenAt: number;
};

export type ToolDefinition = {
    id: string;
    name: string;
    description: string;
    category?: string;
    inputSchema: unknown;
};

export type Persona = {
    id: string;
    name: string;
    description: string;
    systemPrompt?: string;
};

export type ConversationMeta = {
    id: string;
    title: string;
    preview: string;
    updatedAt: string;
};

export type Participant = {
    id: string;
    displayName?: string;
    role?: string;
    metadata?: Record<string, unknown>;
};

export type StoredMessage = {
    id: string;
    sender: string;
    timestamp: number;
    content: string;
    metadata?: Record<string, unknown>;
};

export type ConversationIndexEntry = {
    id: string;
    name: string;
    filePath: string;
    preview?: string;
    updatedAt?: number;
    metadata?: Record<string, unknown>;
};

export type ConversationRecord = {
    id: string;
    name: string;
    participants: Participant[];
    messages: StoredMessage[];
    metadata?: Record<string, unknown>;
    createdAt?: number;
    updatedAt?: number;
};

export type ChatMessage = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    sender: string;
    text: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
    status?: 'pending' | 'sent' | 'error';
    requestId?: string;
};
