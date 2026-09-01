import type { Conversation, Message, MessageContent, Uuid } from 'vertex-common'

export async function fetchConversation(uuid: Uuid): Promise<Conversation> {
    const response = await fetch(`/api/conversations/${uuid}`)
    if (!response.ok) {
        throw new Error(`Failed to fetch conversations: ${response.statusText}`)
    }
    const data = await response.json()
    return data as Conversation
}

export async function createMessage(
    conversationId: Uuid,
    sender: Uuid,
    content: MessageContent,
    metadata?: Record<string, unknown>,
): Promise<Message> {
    const response = await fetch(`/api/messages/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            sender,
            conversationId,
            content,
            metadata,
        }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to create message: ${errorResponse['error']}`)
    }

    const data = await response.json()
    return data as Message
}

export async function updateMessage(
    messageId: Uuid,
    content?: MessageContent,
    metadata?: Record<string, unknown>,
): Promise<void> {
    const response = await fetch(`/api/messages/${messageId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content,
            metadata,
        }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to update message: ${errorResponse['error']}`)
    }
}

export async function deleteMessage(messageId: Uuid): Promise<void> {
    const response = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to delete message: ${errorResponse['error']}`)
    }
}

export async function updateConversationParticipants(conversationId: Uuid, participants: Uuid[]): Promise<void> {
    const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ participants }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to update conversation participants: ${errorResponse['error']}`)
    }
}

export async function deleteConversation(conversationId: Uuid): Promise<void> {
    const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
    })
    if (!response.ok) {
        console.error('Failed to delete conversation:', response.statusText)
        return
    }
}

export async function renameConversation(conversationId: Uuid, newName: string): Promise<void> {
    const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
    })
    if (!response.ok) {
        console.error('Failed to rename conversation:', response.statusText)
        return
    }
}
