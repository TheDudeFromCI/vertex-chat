import type { ConversationStore } from '../services/ConversationStore.js'
import type { Tool } from '../services/LLMService.js'
import type { PersonaStore } from '../services/PersonaStore.js'

export function buildConversationTools(conversationStore: ConversationStore, personaStore: PersonaStore) {
    const renameConversation: Tool = {
        name: 'rename_conversation',
        description: 'Renames the current conversation.',
        params: [
            {
                name: 'new_name',
                type: 'string',
                description: 'The new name for the conversation.',
                required: true,
            },
        ],
        needsPermission: false,
        execute: async ({ new_name }, { conversationId }, callback) => {
            if (!conversationId) {
                return 'You must have a valid conversation ID to rename the conversation. You are in an external environment.'
            }
            const result = conversationStore.renameConversation(conversationId, new_name as string)

            if (!result) return 'Error: Failed to update conversation name. You are in an external environment.'

            callback?.({ type: 'rename_conversation', name: new_name as string })
            return 'Updated conversation name successfully.'
        },
    }

    const conversationName: Tool = {
        name: 'conversation_name',
        description: 'Gets the name of the current conversation.',
        params: [],
        needsPermission: false,
        execute: async (_, { conversationId }) => {
            if (conversationId) {
                const conversation = conversationStore.getConversation(conversationId)
                if (conversation) return conversation.name
            }
            return 'You must have a valid conversation ID to get the conversation name. You are in an external environment.'
        },
    }

    const participants: Tool = {
        name: 'participants',
        description: 'Gets the participants of the current conversation.',
        params: [],
        needsPermission: false,
        execute: async (_, { conversationId }) => {
            if (conversationId) {
                const conversation = conversationStore.getConversation(conversationId)
                if (conversation) {
                    const participants = conversation.participants.flatMap((participantId) => {
                        const persona = personaStore.getPersona(participantId)
                        return persona ? [persona.name] : []
                    })

                    return participants.join(', ')
                }
            }
            return 'Error: Unable to retrieve participants. You are in an external environment.'
        },
    }

    const avatar: Tool = {
        name: 'get_avatar',
        description: 'Gets the avatar URL of the indicated user.',
        params: [
            {
                name: 'username',
                type: 'string',
                description: 'The username of the participant whose avatar you want to retrieve.',
                required: true,
            },
        ],
        needsPermission: false,
        execute: async ({ username }, { conversationId }) => {
            if (conversationId) {
                const conversation = conversationStore.getConversation(conversationId)
                if (conversation) {
                    const participant = conversation.participants
                        .map((participantId) => personaStore.getPersona(participantId))
                        .find((persona) => persona && persona.name === username)

                    if (!participant || !participant.avatarUrl)
                        return 'Error: Unable to retrieve avatar. You are in an external environment.'

                    const profilePicture = personaStore.getProfilePicture(participant.id)
                    if (!profilePicture) return 'Error: No profile picture assigned.'

                    return JSON.stringify({
                        type: 'image',
                        path: participant.avatarUrl,
                        name: participant.avatarUrl,
                        content: `data:${profilePicture.mimeType};base64,${profilePicture.data.toString('base64')}`,
                    })
                }
            }
            return 'Error: Unable to retrieve avatar. You are in an external environment.'
        },
    }

    return {
        renameConversation,
        conversationName,
        participants,
        avatar,
    }
}
