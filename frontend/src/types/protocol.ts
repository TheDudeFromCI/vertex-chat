import type { ConversationIndexEntry, ConversationRecord, SessionSnapshot, StoredMessage } from './domain';

export type ServerEvent =
    | { type: 'welcome'; serverTime: number; session: SessionSnapshot; requestId?: string }
    | { type: 'pong'; serverTime: number; session: SessionSnapshot; requestId?: string }
    | { type: 'echo'; serverTime: number; message: string; session: SessionSnapshot; requestId?: string }
    | { type: 'error'; message: string; requestId?: string }
    | { type: 'tool_started'; toolId: string; session: SessionSnapshot; requestId?: string }
    | { type: 'tool_result'; toolId: string; result: unknown; session: SessionSnapshot; requestId?: string }
    | { type: 'tool_error'; toolId?: string; message: string; session: SessionSnapshot; requestId?: string }
    | { type: 'conversation_list'; conversations: ConversationIndexEntry[]; session: SessionSnapshot; requestId?: string }
    | { type: 'conversation_loaded'; conversation: ConversationRecord; session: SessionSnapshot; requestId?: string }
    | { type: 'conversation_created'; conversation: ConversationIndexEntry; session: SessionSnapshot; requestId?: string }
    | { type: 'conversation_deleted'; conversationId: string; session: SessionSnapshot; requestId?: string }
    | {
        type: 'message_appended';
        conversationId: string;
        message: StoredMessage;
        session: SessionSnapshot;
        requestId?: string;
    }
    | {
        type: 'message_updated';
        conversationId: string;
        message: StoredMessage;
        session: SessionSnapshot;
        requestId?: string;
    };

export type HelloMessage = { type: 'hello'; clientId: string; requestId: string };
export type PingMessage = { type: 'ping'; requestId: string };
export type EchoMessage = { type: 'echo'; message: string; requestId: string };
export type InvokeToolMessage = { type: 'invoke_tool'; toolId: string; input: Record<string, unknown>; requestId: string };
export type ListConversationsMessage = { type: 'list_conversations'; requestId: string };
export type LoadConversationMessage = { type: 'load_conversation'; conversationId: string; requestId: string };
export type CreateConversationMessage = {
    type: 'create_conversation';
    name: string;
    participants: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    requestId: string;
};
export type SendMessageMessage = {
    type: 'send_message';
    conversationId: string;
    sender: string;
    content: string;
    metadata?: Record<string, unknown>;
    requestId: string;
};

export type DeleteConversationMessage = {
    type: 'delete_conversation';
    conversationId: string;
    requestId: string;
};

export type CloneConversationMessage = {
    type: 'clone_conversation';
    conversationId: string;
    name?: string;
    requestId: string;
};

export type EditMessageMessage = {
    type: 'edit_message';
    conversationId: string;
    messageId: string;
    content: string;
    requestId: string;
};

export type AddParticipantMessage = {
    type: 'add_participant';
    conversationId: string;
    participant: Record<string, unknown>;
    requestId: string;
};

export type UpdateParticipantPersonaMessage = {
    type: 'update_participant_persona';
    conversationId: string;
    participantId: string;
    personaId: string;
    personaName: string;
    requestId: string;
};

export type SetActiveAssistantMessage = {
    type: 'set_active_assistant';
    conversationId: string;
    participantId: string;
    requestId: string;
};

export type OutboundMessage =
    | PingMessage
    | EchoMessage
    | InvokeToolMessage
    | ListConversationsMessage
    | LoadConversationMessage
    | CreateConversationMessage
    | SendMessageMessage
    | DeleteConversationMessage
    | CloneConversationMessage
    | EditMessageMessage
    | AddParticipantMessage
    | UpdateParticipantPersonaMessage
    | SetActiveAssistantMessage;
export type ClientMessage = OutboundMessage | HelloMessage;
