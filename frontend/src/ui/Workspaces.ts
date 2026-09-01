import '../css/workspaces.css'

import type { Workspace, ConversationIndexEntry, Uuid } from 'vertex-common'
import type { App } from '../App.js'

const PLUS_SYMBOL = new URL('../../icons/plus.png', import.meta.url).href
const DELETE_SYMBOL = new URL('../../icons/delete.png', import.meta.url).href
const EDIT_SYMBOL = new URL('../../icons/edit.png', import.meta.url).href

export class ConversationEntry {
    private readonly app: App
    private readonly conversation: ConversationIndexEntry

    constructor(app: App, conversation: ConversationIndexEntry) {
        this.app = app
        this.conversation = conversation
    }

    build(): HTMLDivElement {
        const header = document.createElement('div')
        header.classList.add('conversation-header')

        const headerText = document.createElement('span')
        headerText.textContent = this.conversation.name
        header.appendChild(headerText)

        const editButton = document.createElement('img')
        editButton.src = EDIT_SYMBOL
        editButton.alt = 'Edit Conversation'
        editButton.classList.add('edit-conversation-button')
        editButton.addEventListener('click', async (event) => {
            event.stopPropagation()
            const newName = prompt('Enter a new name for the conversation:', this.conversation.name)
            if (newName && newName.trim() !== '' && newName !== this.conversation.name) {
                await this.app.renameConversation(this.conversation.conversationId, newName.trim())
            }
        })
        header.appendChild(editButton)

        const deleteButton = document.createElement('img')
        deleteButton.src = DELETE_SYMBOL
        deleteButton.alt = 'Delete Conversation'
        deleteButton.classList.add('delete-conversation-button')
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation()
            const confirmed = confirm(`Are you sure you want to delete the conversation "${this.conversation.name}"?`)
            if (!confirmed) {
                return
            }
            await this.app.deleteConversation(this.conversation.conversationId)
        })
        header.appendChild(deleteButton)

        header.addEventListener('click', async () => {
            console.log(`Loading conversation: ${this.conversation.name} (ID: ${this.conversation.conversationId})`)
            await this.app.loadConversation(this.conversation.conversationId)
        })
        return header
    }
}

export class WorkspaceEntry {
    private readonly app: App
    private readonly workspace: Workspace
    private conversations: ConversationEntry[] = []

    constructor(app: App, workspace: Workspace) {
        this.app = app
        this.workspace = workspace
        this.conversations = this.workspace.conversationEntries.map((conv) => new ConversationEntry(this.app, conv))
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.classList.add('workspace-entry')

        const header = document.createElement('div')
        header.classList.add('workspace-header')
        div.appendChild(header)

        const headerText = document.createElement('span')
        headerText.textContent = this.workspace.name
        header.appendChild(headerText)

        const newButton = document.createElement('img')
        newButton.src = PLUS_SYMBOL
        newButton.alt = 'New Conversation'
        newButton.classList.add('new-conversation-button')
        newButton.addEventListener('click', async () => {
            const id = await this.newConversation()
            if (id) {
                await this.app.reloadWorkspaces()
                await this.app.loadConversation(id)
            }
        })
        header.appendChild(newButton)

        const editButton = document.createElement('img')
        editButton.src = EDIT_SYMBOL
        editButton.alt = 'Rename Workspace'
        editButton.classList.add('rename-workspace-button')
        editButton.addEventListener('click', async () => {
            const newName = prompt('Enter a new name for the workspace:', this.workspace.name)
            if (newName && newName.trim() !== '' && newName !== this.workspace.name) {
                await this.renameWorkspace(newName.trim())
                await this.app.reloadWorkspaces()
            }
        })
        header.appendChild(editButton)

        const deleteButton = document.createElement('img')
        deleteButton.src = DELETE_SYMBOL
        deleteButton.alt = 'Delete Workspace'
        deleteButton.classList.add('delete-workspace-button')
        deleteButton.addEventListener('click', async () => {
            const confirmed = confirm(`Are you sure you want to delete the workspace "${this.workspace.name}"?`)
            if (!confirmed) {
                return
            }
            await this.deleteWorkspace()
            await this.app.reloadWorkspaces()
        })
        header.appendChild(deleteButton)

        for (const conversation of this.conversations) {
            div.appendChild(conversation.build())
        }

        return div
    }

    private async newConversation(): Promise<Uuid | null> {
        console.log(`Creating new conversation in workspace: ${this.workspace.name} (ID: ${this.workspace.id})`)
        try {
            const response = await fetch(`/api/conversations/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'New Conversation',
                    workspaceId: this.workspace.id,
                }),
            })
            if (!response.ok) {
                console.error('Failed to create new conversation:', response.statusText)
                return null
            }
            const json = await response.json()
            if (!json || typeof json !== 'object' || !('id' in json)) {
                throw new Error('Invalid response creating new conversation')
            }
            return json['id'] as Uuid
        } catch (error) {
            console.error('Error creating new conversation:', error)
            return null
        }
    }

    private async renameWorkspace(newName: string): Promise<void> {
        console.log(`Renaming workspace: ${this.workspace.name} (ID: ${this.workspace.id}) to "${newName}"`)
        try {
            const response = await fetch(`/api/workspaces/${this.workspace.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName }),
            })
            if (!response.ok) {
                console.error('Failed to update workspace:', response.statusText)
                return
            }
        } catch (error) {
            console.error('Error renaming workspace:', error)
        }
    }

    private async deleteWorkspace(): Promise<void> {
        console.log(`Deleting workspace: ${this.workspace.name} (ID: ${this.workspace.id})`)
        try {
            const response = await fetch(`/api/workspaces/${this.workspace.id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const errorText = await response.text()
                console.error(`Failed to delete workspace: ${response.statusText}. Response: ${errorText}`)
                return
            }

            if (this.workspace.conversationEntries.some((conv) => conv.conversationId === this.app.conversationId)) {
                await this.app.loadConversation(null)
            }
        } catch (error) {
            console.error('Error deleting workspace:', error)
        }
    }
}

export class Workspaces {
    private readonly app: App
    private workspaces: WorkspaceEntry[] = []
    private container: HTMLDivElement | null = null

    constructor(app: App) {
        this.app = app
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'workspaces'
        div.classList.add('outer-container')

        const header = document.createElement('div')
        header.classList.add('workspaces-header')
        div.appendChild(header)

        const headerText = document.createElement('span')
        headerText.textContent = 'Workspaces'
        header.appendChild(headerText)

        const newButton = document.createElement('img')
        newButton.src = PLUS_SYMBOL
        newButton.alt = 'New Workspace'
        newButton.classList.add('new-workspace-button')
        newButton.addEventListener('click', async () => {
            await this.createWorkspace()
            await this.reloadWorkspaces()
        })
        header.appendChild(newButton)

        const container = document.createElement('div')
        container.classList.add('workspaces-container')
        div.appendChild(container)
        this.container = container

        for (const workspace of this.workspaces) {
            div.appendChild(workspace.build())
        }

        return div
    }

    async reloadWorkspaces(): Promise<void> {
        console.log('Reloading workspaces...')

        const workspaces = await this.fetchWorkspaces()
        this.workspaces = workspaces.map((ws) => new WorkspaceEntry(this.app, ws))

        if (this.container) {
            this.container.innerHTML = ''

            for (const workspace of this.workspaces) {
                this.container.appendChild(workspace.build())
            }
        }
    }

    private async fetchWorkspaces(): Promise<Workspace[]> {
        try {
            const response = await fetch('/api/workspaces')
            if (!response.ok) {
                console.error('Failed to load workspaces:', response.statusText)
                return []
            }
            return (await response.json()) as Workspace[]
        } catch (error) {
            console.error('Error fetching workspaces:', error)
            return []
        }
    }

    private async createWorkspace(): Promise<void> {
        console.log('Creating new workspace...')
        try {
            const response = await fetch('/api/workspaces/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'New Workspace',
                }),
            })
            if (!response.ok) {
                console.error('Failed to create new workspace:', response.statusText)
                return
            }
        } catch (error) {
            console.error('Error creating new workspace:', error)
        }
    }
}
