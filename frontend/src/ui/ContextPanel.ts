import { Participants } from './Participants.js'

export class ContextPanel {
    private readonly participants: Participants

    constructor() {
        this.participants = new Participants()
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'context-panel'
        div.classList.add('outer-container')

        const participantsDiv = this.participants.build()
        div.appendChild(participantsDiv)

        return div
    }
}
