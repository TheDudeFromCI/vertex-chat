export type Uuid = string & { __uuidBrand: never }

export interface Persona {
    id: Uuid
    name: string
    prompt: string
    created: number
    updated: number
    avatarUrl: string | null
}

export interface Message {
    id: Uuid
    conversationId: Uuid
    sender: Uuid
    timestamp: number
    content: MessageContent
    edited: boolean
    metadata: Record<string, unknown>
}

export type MessageContent = MessageContentBlock[]
export type MessageContentBlockType = 'text' | 'thinking' | 'tool_call' | 'tool_response'
export interface MessageContentBlock {
    type: MessageContentBlockType
    content: string
}

export interface StreamedMessageContent {
    type: MessageContentBlockType
    delta: string
}

export interface Conversation {
    id: Uuid
    name: string
    participants: Uuid[]
    messages: Message[]
    createdAt: number
    updatedAt: number
    metadata: Record<string, unknown>
}

export interface Workspace {
    id: Uuid
    name: string
    conversationEntries: ConversationIndexEntry[]
    metadata: Record<string, unknown>
}

export interface ConversationIndexEntry {
    conversationId: Uuid
    workspaceId: Uuid
    name: string
    createdAt: number
    updatedAt: number
}

export interface PersonaProfilePicture {
    data: Buffer
    mimeType: string
}

export interface ChatCompletionRequest {
    prompt?: string
    messages: ChatCompletionMessage[]
}

export type ChatCompletionMessage = ChatCompletionMessageUser | ChatCompletionMessageAssistant | ChatCompletionToolCall

export interface ChatCompletionMessageUser {
    role: 'user'
    content: string
}

export interface ChatCompletionMessageAssistant {
    role: 'assistant'
    thinking: string | null
    content: string
}

export interface ChatCompletionToolCall {
    role: 'tool'
    tool_call_id: string
    content: string
}
