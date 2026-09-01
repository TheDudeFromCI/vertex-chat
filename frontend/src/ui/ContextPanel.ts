import { Participants } from './Participants.js'
import type { App } from '../App.js'

export class ContextPanel {
    private readonly participants: Participants

    constructor(app: App) {
        this.participants = new Participants(app)
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'context-panel'
        div.classList.add('outer-container')

        const participantsDiv = this.participants.build()
        div.appendChild(participantsDiv)

        return div
    }

    async reloadParticipants(): Promise<void> {
        await this.participants.reload()
    }
}
