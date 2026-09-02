import '../css/participants.css'

import type { Uuid } from 'vertex-common'
import { fetchConversation } from '../api/ConversationsAPI.js'
import type { App } from '../App.js'
import { PersonaEditorWindow } from './PersonaEditorWindow.js'

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
        void this.reload()
        return div
    }

    async reload(): Promise<void> {
        const conversationId = this.app.conversationId
        if (!conversationId) {
            this.participantIds = []
            this.renderParticipants([])
            this.setStatus('Open a conversation to manage participants.')
            return
        }

        try {
            const conversation = await fetchConversation(conversationId)
            this.participantIds = [...conversation.participants]
            const display = await this.buildParticipantDisplay(conversation.participants)
            this.renderParticipants(display)
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
}
