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

export interface ToolExecutionContext {
    conversationId: Uuid | null
    agentId: Uuid | null
}

export type MessageContent = MessageContentBlock[]
export type MessageContentBlockType =
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'tool_response_json'
    | 'tool_response_text'
    | 'tool_response_md'
    | 'image'
    | 'file_attachment'
export interface MessageContentBlock {
    type: MessageContentBlockType
    content: string
    name?: string
}

export interface StreamedMessageContent {
    type: MessageContentBlockType
    delta: string
    tokens: number
}

export interface BeginLLMGeneration {
    type: 'begin_llm_generation'
    promptTokens: number
    totalTokens: number
    // Post-optimization; this is what actually occupies the context window.
    truncatedTokens: number
}

export interface ToolPermissionRequest {
    type: 'tool_permission_request'
    requestId: string
    toolName: string
    args: Record<string, unknown>
}

export interface RenameConversation {
    type: 'rename_conversation'
    name: string
}

export interface NewWorkspace {
    type: 'new_workspace'
    workspaceId: Uuid
    name: string
}

export interface NewConversation {
    type: 'new_conversation'
    workspaceId: Uuid
    conversationId: Uuid
    name: string
}

// The backend runs the generation itself; clients only use this to refresh their view.
export interface SubagentGenerationTriggered {
    type: 'subagent_generation_triggered'
    conversationId: Uuid
    callerId: Uuid
    agentId: Uuid
}

export interface SubagentGenerationCompleted {
    type: 'subagent_generation_completed'
    conversationId: Uuid
    agentId: Uuid
}

export type StreamedLLMEvent =
    | StreamedMessageContent
    | ToolPermissionRequest
    | BeginLLMGeneration
    | RenameConversation
    | NewWorkspace
    | NewConversation
    | SubagentGenerationTriggered
    | SubagentGenerationCompleted

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
    toolContext: ToolExecutionContext
}

export interface ChatCompletionContentTextPart {
    type: 'text'
    text: string
}

export interface ChatCompletionContentImagePart {
    type: 'image_url'
    image_url: {
        url: string
    }
}

export interface ChatCompletionContentFilePart {
    type: 'file'
    file: {
        filename?: string
        file_data: string
    }
}

export type ChatCompletionContentPart =
    | ChatCompletionContentTextPart
    | ChatCompletionContentImagePart
    | ChatCompletionContentFilePart
export type ChatCompletionMessageContent = string | ChatCompletionContentPart[]

export type ChatCompletionMessage = ChatCompletionMessageUser | ChatCompletionMessageAssistant | ChatCompletionToolCall

export interface ChatCompletionMessageUser {
    role: 'user'
    content: ChatCompletionMessageContent
}

export interface ChatCompletionMessageAssistant {
    role: 'assistant'
    thinking: string | null
    content: string
    tool_calls?: ChatCompletionAssistantToolCall[]
}

export interface ChatCompletionAssistantToolCall {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
}

export interface ChatCompletionToolCall {
    role: 'tool'
    tool_call_id: string
    content: ChatCompletionMessageContent
}
