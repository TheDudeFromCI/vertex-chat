import '../css/header.css'

import type { Uuid } from 'vertex-common'
import type { App } from '../App.ts'

export class Header {
    private readonly app: App
    private userSelector: HTMLSelectElement | null = null
    private personaCache: Map<string, Uuid> = new Map()

    constructor(app: App) {
        this.app = app
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'app-header'

        const userSelector = document.createElement('select')
        userSelector.id = 'user-selector'
        userSelector.addEventListener('change', async () => {
            const selectedUserName = userSelector.value
            const selectedUserId = this.personaCache.get(selectedUserName) || null
            await this.app.setUserId(selectedUserId)
        })
        div.appendChild(userSelector)
        this.userSelector = userSelector

        return div
    }

    async reloadPersonas(): Promise<void> {
        this.personaCache.clear()
        for (const persona of this.app.personaList) {
            this.personaCache.set(persona.name, persona.id)
        }

        if (this.userSelector) {
            this.userSelector.replaceChildren()
            for (const [name, id] of this.personaCache.entries()) {
                const option = document.createElement('option')
                option.value = name
                option.textContent = name
                if (id === this.app.userId) {
                    option.selected = true
                }
                this.userSelector.appendChild(option)
            }

            this.userSelector.value =
                Array.from(this.personaCache.entries()).find(([_, id]) => id === this.app.userId)?.[0] || ''
        }
    }
}
