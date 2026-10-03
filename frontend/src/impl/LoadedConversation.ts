import type { Conversation, Uuid } from 'vertex-common'

export type AgentResponseMode = 'manual' | 'automatic' | 'collaborative'

export const AGENT_RESPONSE_MODE_KEY = 'agentResponseMode'

export class LoadedConversation {
    readonly id: Uuid
    metadata: Record<string, unknown>
    agentResponseMode: AgentResponseMode

    constructor(conversation: Conversation) {
        this.id = conversation.id
        this.metadata = conversation.metadata
        this.agentResponseMode = LoadedConversation.parseAgentResponseMode(
            conversation.metadata[AGENT_RESPONSE_MODE_KEY],
        )
    }

    setAgentResponseMode(mode: AgentResponseMode): void {
        this.agentResponseMode = mode
        this.metadata = { ...this.metadata, [AGENT_RESPONSE_MODE_KEY]: mode }
    }

    private static parseAgentResponseMode(mode: unknown): AgentResponseMode {
        if (mode === 'automatic' || mode === 'collaborative') {
            return mode
        }

        return 'manual'
    }
}
