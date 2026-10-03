import type { MessageContent, StreamedLLMEvent } from 'vertex-common'
import type { ConversationStore } from '../services/ConversationStore.js'
import { buildChatCompletionRequest } from '../services/ChatRequestBuilder.js'
import type { LLMService, Tool } from '../services/LLMService.js'
import type { PersonaStore } from '../services/PersonaStore.js'

const MAX_CONVERSATION_NAME_LENGTH = 60

export function buildSubagentTool(
    llmService: LLMService,
    conversationStore: ConversationStore,
    personaStore: PersonaStore,
): Tool {
    return {
        name: 'subagent',
        description:
            'Delegates a task to another agent. Starts a new conversation between you and the target agent ' +
            'with your prompt as the first message, waits for the target agent to reply, and returns its reply.',
        params: [
            {
                name: 'prompt',
                type: 'string',
                description: 'The message to send to the target agent.',
                required: true,
            },
            {
                name: 'agent_username',
                type: 'string',
                description: 'The username of the agent that should handle the prompt.',
                required: true,
            },
        ],
        needsPermission: false,
        execute: async ({ prompt, agent_username }, { agentId }, callback) => {
            if (!agentId) return 'Error: Unable to determine the calling agent. You are in an external environment.'
            if (typeof prompt !== 'string' || !prompt.trim()) return 'Error: "prompt" must be a non-empty string.'
            if (typeof agent_username !== 'string' || !agent_username.trim()) {
                return 'Error: "agent_username" must be a non-empty string.'
            }

            const caller = personaStore.getPersona(agentId)
            if (!caller) return 'Error: The calling agent no longer exists.'

            const personas = personaStore.listPersonas()
            const wanted = agent_username.trim()
            const target =
                personas.find((persona) => persona.name === wanted) ??
                personas.find((persona) => persona.name.toLowerCase() === wanted.toLowerCase())
            if (!target) {
                return `Error: No agent named "${wanted}". Available agents: ${personas.map((p) => p.name).join(', ')}`
            }
            if (target.id === caller.id) return 'Error: You cannot delegate to yourself.'

            let workspace = conversationStore.getWorkspace(agentId)
            if (!workspace) {
                workspace = conversationStore.createWorkspace(caller.name, {}, agentId)
                callback?.({ type: 'new_workspace', workspaceId: workspace.id, name: workspace.name })
            }

            const trimmed = prompt.trim()
            const name =
                trimmed.length > MAX_CONVERSATION_NAME_LENGTH
                    ? `${trimmed.slice(0, MAX_CONVERSATION_NAME_LENGTH - 1)}…`
                    : trimmed
            const conversation = conversationStore.createConversation(workspace.id, name)
            conversationStore.updateConversationParticipants(conversation.id, [caller.id, target.id])
            callback?.({
                type: 'new_conversation',
                workspaceId: workspace.id,
                conversationId: conversation.id,
                name: conversation.name,
            })

            conversationStore.appendMessage(conversation.id, caller.id, [{ type: 'text', content: prompt }])
            callback?.({
                type: 'subagent_generation_triggered',
                conversationId: conversation.id,
                callerId: caller.id,
                agentId: target.id,
            })

            // Only user-facing events propagate; content and rename events belong to the subagent's conversation.
            const forward = (event: StreamedLLMEvent) => {
                if (
                    event.type === 'tool_permission_request' ||
                    event.type === 'new_workspace' ||
                    event.type === 'new_conversation'
                ) {
                    callback?.(event)
                }
            }

            let reply: MessageContent
            try {
                const request = buildChatCompletionRequest(conversationStore, personaStore, conversation.id, target.id)
                reply = await llmService.chatCompletion(request, forward)
            } catch (error) {
                return `Error: ${target.name} failed to respond: ${error instanceof Error ? error.message : String(error)}`
            }

            conversationStore.appendMessage(conversation.id, target.id, reply)
            callback?.({ type: 'subagent_generation_completed', conversationId: conversation.id, agentId: target.id })

            const text = reply
                .filter((block) => block.type === 'text')
                .map((block) => block.content)
                .join('\n')
                .trim()
            return text || `${target.name} replied without any text.`
        },
    }
}
