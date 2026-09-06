import '../css/participants.css'

import type { Uuid } from 'vertex-common'
import { fetchConversation } from '../api/ConversationsAPI.js'
import type { AgentResponseMode, App } from '../App.js'
import { PersonaEditorWindow } from './PersonaEditorWindow.js'

const RESPONSE_MODES: ReadonlyArray<{ value: AgentResponseMode; label: string }> = [
    { value: 'manual', label: 'Manual' },
    { value: 'automatic', label: 'Automatic' },
    { value: 'collaborative', label: 'Collaborative' },
]

interface ParticipantDisplay {
    id: Uuid
    name: string
    avatarUrl: string | null
    updatedAt: number
}

export class Participants {
    private readonly app: App
    private readonly personaEditorWindow: PersonaEditorWindow
    private participantsContainer: HTMLDivElement | null = null
    private statusText: HTMLDivElement | null = null
    private responseModeSelect: HTMLSelectElement | null = null
    private participantIds: Uuid[] = []

    constructor(app: App) {
        this.app = app
        this.personaEditorWindow = new PersonaEditorWindow({
            app: this.app,
            getParticipantIds: () => this.participantIds,
            setParticipantIds: (participantIds) => {
                this.participantIds = [...participantIds]
            },
            onParticipantsChanged: async () => {
                await this.reload()
            },
            setStatus: (text) => {
                this.setStatus(text)
            },
        })
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'participants'

        const header = document.createElement('div')
        header.classList.add('participants-header')

        const title = document.createElement('span')
        title.textContent = 'Participants'
        header.appendChild(title)

        const openPickerButton = document.createElement('button')
        openPickerButton.type = 'button'
        openPickerButton.classList.add('participants-open-picker')
        openPickerButton.textContent = 'Add Persona'
        openPickerButton.addEventListener('click', async () => {
            await this.personaEditorWindow.open()
        })
        header.appendChild(openPickerButton)
        div.appendChild(header)

        const statusText = document.createElement('div')
        statusText.classList.add('participants-status')
        div.appendChild(statusText)
        this.statusText = statusText

        const participantsContainer = document.createElement('div')
        participantsContainer.classList.add('participants-list')
        div.appendChild(participantsContainer)
        this.participantsContainer = participantsContainer

        const footer = document.createElement('div')
        footer.classList.add('participants-footer')

        const responseModeLabel = document.createElement('label')
        responseModeLabel.classList.add('participants-response-mode-label')
        responseModeLabel.setAttribute('for', 'participants-response-mode')
        responseModeLabel.textContent = 'Agent Response Mode'
        footer.appendChild(responseModeLabel)

        const responseModeSelect = document.createElement('select')
        responseModeSelect.id = 'participants-response-mode'
        responseModeSelect.classList.add('participants-response-mode-select')

        for (const mode of RESPONSE_MODES) {
            const option = document.createElement('option')
            option.value = mode.value
            option.textContent = mode.label
            responseModeSelect.appendChild(option)
        }

        responseModeSelect.value = this.app.agentResponseMode
        responseModeSelect.addEventListener('change', async () => {
            const mode = responseModeSelect.value as AgentResponseMode
            responseModeSelect.disabled = true

            try {
                await this.app.setAgentResponseMode(mode)
                this.setStatus(`Agent response mode set to ${this.getResponseModeLabel(mode)}.`)
            } catch (error) {
                console.error('Failed to update response mode:', error)
                this.setStatus('Failed to update response mode.')
                responseModeSelect.value = this.app.agentResponseMode
            } finally {
                responseModeSelect.disabled = this.app.conversationId === null
            }
        })

        this.responseModeSelect = responseModeSelect
        footer.appendChild(responseModeSelect)
        div.appendChild(footer)

        void this.reload()
        return div
    }

    async reload(): Promise<void> {
        const conversationId = this.app.conversationId
        if (!conversationId) {
            this.participantIds = []
            this.renderParticipants([])
            this.syncResponseModeSelect()
            this.setStatus('Open a conversation to manage participants.')
            return
        }

        try {
            const conversation = await fetchConversation(conversationId)
            this.participantIds = [...conversation.participants]
            const display = await this.buildParticipantDisplay(conversation.participants)
            this.renderParticipants(display)
            this.syncResponseModeSelect()
            this.setStatus(`${conversation.participants.length} participant(s) in this conversation.`)
        } catch (error) {
            console.error('Failed to reload participants:', error)
            this.setStatus('Failed to load participants.')
        }
    }

    private async buildParticipantDisplay(participantIds: Uuid[]): Promise<ParticipantDisplay[]> {
        const entries: ParticipantDisplay[] = []

        for (const personaId of participantIds) {
            const persona = await this.app.getPersona(personaId)
            entries.push({
                id: personaId,
                name: persona?.name ?? 'Unknown Persona',
                avatarUrl: persona?.avatarUrl ?? null,
                updatedAt: persona?.updated ?? 0,
            })
        }

        return entries
    }

    private renderParticipants(participants: ParticipantDisplay[]): void {
        if (!this.participantsContainer) {
            return
        }

        this.participantsContainer.replaceChildren()

        if (participants.length === 0) {
            const empty = document.createElement('div')
            empty.classList.add('participants-empty')
            empty.textContent = 'No participants yet.'
            this.participantsContainer.appendChild(empty)
            return
        }

        for (const participant of participants) {
            const row = document.createElement('button')
            row.type = 'button'
            row.classList.add('participant-row')
            if (participant.id === this.app.userId) {
                row.classList.add('selected')
                row.setAttribute('aria-pressed', 'true')
            } else {
                row.setAttribute('aria-pressed', 'false')
            }
            row.addEventListener('click', async () => {
                await this.app.setUserId(participant.id)
                this.renderParticipants(participants)
                this.setStatus(`Selected ${participant.name}.`)
            })

            const avatar = document.createElement('img')
            avatar.classList.add('participant-avatar')
            avatar.src =
                this.getAvatarDisplayUrl(participant.avatarUrl, participant.updatedAt) ??
                'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
            avatar.alt = `${participant.name} avatar`
            if (!participant.avatarUrl) {
                avatar.classList.add('participant-avatar-placeholder')
            }
            row.appendChild(avatar)

            const name = document.createElement('div')
            name.classList.add('participant-name')
            name.textContent = participant.name
            row.appendChild(name)

            this.participantsContainer.appendChild(row)
        }
    }

    private setStatus(text: string): void {
        if (this.statusText) {
            this.statusText.textContent = text
        }
    }

    private getAvatarDisplayUrl(avatarUrl: string | null, updatedAt: number): string | null {
        if (!avatarUrl) {
            return null
        }

        const separator = avatarUrl.includes('?') ? '&' : '?'
        return `${avatarUrl}${separator}v=${updatedAt}`
    }

    private syncResponseModeSelect(): void {
        if (!this.responseModeSelect) {
            return
        }

        this.responseModeSelect.value = this.app.agentResponseMode
        this.responseModeSelect.disabled = this.app.conversationId === null
    }

    private getResponseModeLabel(mode: AgentResponseMode): string {
        for (const option of RESPONSE_MODES) {
            if (option.value === mode) {
                return option.label
            }
        }

        return 'Manual'
    }
}
