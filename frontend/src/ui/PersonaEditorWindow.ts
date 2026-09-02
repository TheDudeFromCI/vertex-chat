import '../css/personaEditorWindow.css'

import type { Persona, Uuid } from 'vertex-common'
import { updateConversationParticipants } from '../api/ConversationsAPI.js'
import { createPersona, deletePersona, setPersonaAvatar, updatePersona } from '../api/PersonasAPI.js'
import type { App } from '../App.js'
import MarkdownIt from 'markdown-it'

const SAVE_SYMBOL = new URL('../../icons/save.png', import.meta.url).href
const md = new MarkdownIt({ typographer: true })

interface PersonaEditorWindowDependencies {
    app: App
    getParticipantIds: () => Uuid[]
    setParticipantIds: (participantIds: Uuid[]) => void
    onParticipantsChanged: () => Promise<void>
    setStatus: (text: string) => void
}

export class PersonaEditorWindow {
    private readonly app: App
    private readonly getParticipantIds: () => Uuid[]
    private readonly setParticipantIds: (participantIds: Uuid[]) => void
    private readonly onParticipantsChanged: () => Promise<void>
    private readonly setStatus: (text: string) => void

    private modalOverlay: HTMLDivElement | null = null
    private modalPersonas: Persona[] = []
    private modalSelectedPersonaId: Uuid | null = null
    private modalPersonaList: HTMLDivElement | null = null
    private modalEditor: HTMLDivElement | null = null
    private modalSaveIndicator: HTMLDivElement | null = null
    private autosaveTimer: number | null = null
    private autosaveState: 'saved' | 'saving' | 'error' = 'saved'

    constructor(dependencies: PersonaEditorWindowDependencies) {
        this.app = dependencies.app
        this.getParticipantIds = dependencies.getParticipantIds
        this.setParticipantIds = dependencies.setParticipantIds
        this.onParticipantsChanged = dependencies.onParticipantsChanged
        this.setStatus = dependencies.setStatus
    }

    async open(): Promise<void> {
        if (!this.app.conversationId) {
            this.setStatus('Select a conversation before adding participants.')
            return
        }

        await this.app.reloadPersonas()
        this.modalPersonas = [...this.app.personaList]
        this.modalSelectedPersonaId = this.modalPersonas[0]?.id ?? null

        if (this.modalOverlay) {
            this.modalOverlay.remove()
            this.modalOverlay = null
        }

        const overlay = document.createElement('div')
        overlay.classList.add('participants-modal-overlay')

        const modal = document.createElement('div')
        modal.classList.add('participants-modal')
        overlay.appendChild(modal)

        const modalHeader = document.createElement('div')
        modalHeader.classList.add('participants-modal-header')
        modalHeader.textContent = 'Persona Manager'
        modal.appendChild(modalHeader)

        const body = document.createElement('div')
        body.classList.add('participants-modal-body')
        modal.appendChild(body)

        const sidebar = document.createElement('div')
        sidebar.classList.add('participants-modal-sidebar')
        body.appendChild(sidebar)

        const personaList = document.createElement('div')
        personaList.classList.add('participants-modal-persona-list')
        sidebar.appendChild(personaList)
        this.modalPersonaList = personaList

        const createButton = document.createElement('button')
        createButton.type = 'button'
        createButton.textContent = 'Create Persona'
        createButton.classList.add('participants-create-persona')
        createButton.addEventListener('click', async () => {
            await this.createPersonaFromModal()
        })
        sidebar.appendChild(createButton)

        const editor = document.createElement('div')
        editor.classList.add('participants-modal-editor')
        body.appendChild(editor)
        this.modalEditor = editor

        const actions = document.createElement('div')
        actions.classList.add('participants-modal-actions')
        modal.appendChild(actions)

        const cancelButton = document.createElement('button')
        cancelButton.type = 'button'
        cancelButton.textContent = 'Cancel'
        cancelButton.classList.add('participants-cancel')
        cancelButton.addEventListener('click', () => {
            this.close()
        })
        actions.appendChild(cancelButton)

        const confirmButton = document.createElement('button')
        confirmButton.type = 'button'
        confirmButton.textContent = 'Confirm'
        confirmButton.classList.add('participants-confirm')
        confirmButton.addEventListener('click', async () => {
            await this.confirmPersonaSelection()
        })
        actions.appendChild(confirmButton)

        this.modalOverlay = overlay
        document.body.appendChild(overlay)

        this.renderModalPersonaList()
        this.renderModalEditor()
    }

    close(): void {
        if (this.autosaveTimer !== null) {
            clearTimeout(this.autosaveTimer)
            this.autosaveTimer = null
        }

        if (this.modalOverlay) {
            this.modalOverlay.remove()
            this.modalOverlay = null
        }
        this.modalPersonaList = null
        this.modalEditor = null
        this.modalSaveIndicator = null
        this.modalPersonas = []
        this.modalSelectedPersonaId = null
        this.autosaveState = 'saved'
    }

    private renderModalPersonaList(): void {
        if (!this.modalPersonaList) {
            return
        }

        this.modalPersonaList.replaceChildren()

        for (const persona of this.modalPersonas) {
            const button = document.createElement('button')
            button.type = 'button'
            button.classList.add('participants-modal-persona-item')
            if (persona.id === this.modalSelectedPersonaId) {
                button.classList.add('selected')
            }
            button.textContent = persona.name
            button.addEventListener('click', () => {
                this.modalSelectedPersonaId = persona.id
                this.renderModalPersonaList()
                this.renderModalEditor()
            })
            this.modalPersonaList.appendChild(button)
        }
    }

    private renderModalEditor(): void {
        if (!this.modalEditor) {
            return
        }

        this.modalEditor.replaceChildren()

        const selected = this.modalPersonas.find((persona) => persona.id === this.modalSelectedPersonaId)
        if (!selected) {
            const empty = document.createElement('div')
            empty.classList.add('participants-editor-empty')
            empty.textContent = 'Select a persona to inspect and edit.'
            this.modalEditor.appendChild(empty)
            return
        }

        const avatar = document.createElement('img')
        avatar.classList.add('participants-editor-avatar')
        avatar.src =
            this.getAvatarDisplayUrl(selected.avatarUrl, selected.updated) ??
            'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
        avatar.alt = `${selected.name} avatar`
        avatar.title = 'Click to upload a new avatar'
        avatar.addEventListener('click', async () => {
            await this.selectAndUploadAvatar(selected.id)
        })
        if (!selected.avatarUrl) {
            avatar.classList.add('participants-editor-avatar-placeholder')
        }
        this.modalEditor.appendChild(avatar)

        const nameLabel = document.createElement('label')
        nameLabel.classList.add('participants-editor-label')
        nameLabel.textContent = 'Name'
        this.modalEditor.appendChild(nameLabel)

        const nameInput = document.createElement('input')
        nameInput.type = 'text'
        nameInput.value = selected.name
        nameInput.classList.add('participants-editor-input')
        nameInput.addEventListener('input', () => {
            selected.name = nameInput.value
            this.renderModalPersonaList()
            this.setAutosaveState('saving')
            this.scheduleAutosave(selected.id)
        })
        this.modalEditor.appendChild(nameInput)

        const promptLabel = document.createElement('label')
        promptLabel.classList.add('participants-editor-label')
        promptLabel.textContent = 'Prompt'
        this.modalEditor.appendChild(promptLabel)

        const promptContainer = document.createElement('div')
        promptContainer.classList.add('participants-editor-prompt-container')
        this.modalEditor.appendChild(promptContainer)

        const renderPromptPreview = (): void => {
            promptContainer.replaceChildren()

            const promptPreview = document.createElement('div')
            promptPreview.classList.add('participants-editor-markdown')
            promptPreview.tabIndex = 0
            promptPreview.setAttribute('role', 'button')
            promptPreview.setAttribute('aria-label', 'Edit persona prompt')
            promptPreview.title = 'Click to edit prompt'
            promptPreview.innerHTML = md.render(selected.prompt)
            promptPreview.addEventListener('click', () => {
                renderPromptEditor()
            })
            promptPreview.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    renderPromptEditor()
                }
            })

            promptContainer.appendChild(promptPreview)
        }

        const renderPromptEditor = (): void => {
            promptContainer.replaceChildren()

            const promptInput = document.createElement('textarea')
            promptInput.value = selected.prompt
            promptInput.classList.add('participants-editor-textarea')
            promptInput.rows = 8
            promptInput.addEventListener('input', () => {
                selected.prompt = promptInput.value
                this.setAutosaveState('saving')
                this.scheduleAutosave(selected.id)
            })
            promptInput.addEventListener('blur', () => {
                selected.prompt = promptInput.value
                renderPromptPreview()
            })

            promptContainer.appendChild(promptInput)
            promptInput.focus()
            promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length)
        }

        renderPromptPreview()

        const metadata = document.createElement('div')
        metadata.classList.add('participants-editor-metadata')
        metadata.innerHTML = [
            `<div><strong>ID:</strong> ${selected.id}</div>`,
            `<div><strong>Created:</strong> ${new Date(selected.created).toLocaleString()}</div>`,
            `<div><strong>Updated:</strong> ${new Date(selected.updated).toLocaleString()}</div>`,
        ].join('')
        this.modalEditor.appendChild(metadata)

        const footer = document.createElement('div')
        footer.classList.add('participants-editor-footer')
        this.modalEditor.appendChild(footer)

        const deleteButton = document.createElement('button')
        deleteButton.type = 'button'
        deleteButton.classList.add('participants-delete-persona')
        deleteButton.textContent = 'Delete Persona'
        deleteButton.addEventListener('click', async () => {
            await this.deleteSelectedPersona(selected.id, selected.name)
        })
        footer.appendChild(deleteButton)

        const saveIndicator = document.createElement('div')
        saveIndicator.classList.add('participants-editor-save-indicator')
        footer.appendChild(saveIndicator)
        this.modalSaveIndicator = saveIndicator
        this.renderSaveIndicator()
    }

    private scheduleAutosave(personaId: Uuid): void {
        if (this.autosaveTimer !== null) {
            clearTimeout(this.autosaveTimer)
        }

        this.autosaveTimer = window.setTimeout(async () => {
            const persona = this.modalPersonas.find((entry) => entry.id === personaId)
            if (!persona) {
                return
            }

            try {
                const updated = await updatePersona(persona.id, {
                    name: persona.name,
                    prompt: persona.prompt,
                })
                const index = this.modalPersonas.findIndex((entry) => entry.id === updated.id)
                if (index >= 0) {
                    this.modalPersonas[index] = updated
                    this.modalSelectedPersonaId = updated.id
                }
                await this.app.reloadPersonas()
                await this.onParticipantsChanged()
                this.setAutosaveState('saved')
                this.renderModalPersonaList()
                this.renderModalEditor()
            } catch (error) {
                console.error('Failed to autosave persona changes:', error)
                this.setAutosaveState('error')
                this.setStatus('Autosave failed. Try again.')
            }
        }, 600)
    }

    private async createPersonaFromModal(): Promise<void> {
        try {
            const created = await createPersona('Unnamed Assistant', 'You are a helpful assistant.')
            await this.app.reloadPersonas()
            this.modalPersonas = [...this.app.personaList]
            this.modalSelectedPersonaId = created.id
            this.setAutosaveState('saved')
            this.renderModalPersonaList()
            this.renderModalEditor()
        } catch (error) {
            console.error('Failed to create persona:', error)
            this.setStatus('Failed to create persona.')
        }
    }

    private async confirmPersonaSelection(): Promise<void> {
        const selectedId = this.modalSelectedPersonaId
        const conversationId = this.app.conversationId

        if (!selectedId || !conversationId) {
            this.close()
            return
        }

        const participantIds = this.getParticipantIds()

        if (participantIds.includes(selectedId)) {
            this.close()
            this.setStatus('Persona already in participants.')
            return
        }

        const updatedParticipants = [...participantIds, selectedId]

        try {
            await updateConversationParticipants(conversationId, updatedParticipants)
            this.setParticipantIds(updatedParticipants)
            await this.onParticipantsChanged()
            this.setStatus('Persona added to participants.')
        } catch (error) {
            console.error('Failed to add participant:', error)
            this.setStatus('Failed to add participant.')
        }

        this.close()
    }

    private async selectAndUploadAvatar(personaId: Uuid): Promise<void> {
        const file = await this.pickAvatarFile()
        if (!file) {
            return
        }

        this.setAutosaveState('saving')

        try {
            const fileDataBase64 = await this.readFileAsDataUrl(file)
            await setPersonaAvatar(personaId, fileDataBase64)
            await this.app.reloadPersonas()
            this.modalPersonas = [...this.app.personaList]

            if (!this.modalPersonas.some((persona) => persona.id === this.modalSelectedPersonaId)) {
                this.modalSelectedPersonaId = this.modalPersonas[0]?.id ?? null
            }

            await this.onParticipantsChanged()
            this.setAutosaveState('saved')
            this.renderModalPersonaList()
            this.renderModalEditor()
            this.setStatus('Avatar updated.')
        } catch (error) {
            console.error('Failed to update persona avatar:', error)
            this.setAutosaveState('error')
            this.setStatus('Failed to update avatar.')
        }
    }

    private async deleteSelectedPersona(personaId: Uuid, personaName: string): Promise<void> {
        const confirmed = confirm(
            `Delete persona "${personaName}"? Existing messages from this persona will remain in the conversation history.`,
        )
        if (!confirmed) {
            return
        }

        try {
            await deletePersona(personaId)
            await this.app.reloadPersonas()

            const currentParticipantIds = this.getParticipantIds()
            const filteredParticipants = currentParticipantIds.filter((id) => id !== personaId)
            const conversationId = this.app.conversationId
            if (conversationId && filteredParticipants.length !== currentParticipantIds.length) {
                await updateConversationParticipants(conversationId, filteredParticipants)
                this.setParticipantIds(filteredParticipants)
            }

            this.modalPersonas = [...this.app.personaList]
            this.modalSelectedPersonaId = this.modalPersonas[0]?.id ?? null

            if (conversationId) {
                await this.app.loadConversation(conversationId)
            }

            await this.onParticipantsChanged()
            this.renderModalPersonaList()
            this.renderModalEditor()
            this.setStatus('Persona deleted.')
        } catch (error) {
            console.error('Failed to delete persona:', error)
            this.setStatus('Failed to delete persona.')
        }
    }

    private async pickAvatarFile(): Promise<File | null> {
        return await new Promise<File | null>((resolve) => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.style.display = 'none'

            input.addEventListener('change', () => {
                const file = input.files?.[0] ?? null
                input.remove()
                resolve(file)
            })

            document.body.appendChild(input)
            input.click()
        })
    }

    private async readFileAsDataUrl(file: File): Promise<string> {
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result !== 'string') {
                    reject(new Error('Failed to read file data'))
                    return
                }
                resolve(reader.result)
            }
            reader.onerror = () => {
                reject(reader.error ?? new Error('Failed to read file data'))
            }
            reader.readAsDataURL(file)
        })
    }

    private getAvatarDisplayUrl(avatarUrl: string | null, updatedAt: number): string | null {
        if (!avatarUrl) {
            return null
        }

        const separator = avatarUrl.includes('?') ? '&' : '?'
        return `${avatarUrl}${separator}v=${updatedAt}`
    }

    private setAutosaveState(state: 'saved' | 'saving' | 'error'): void {
        this.autosaveState = state
        this.renderSaveIndicator()
    }

    private renderSaveIndicator(): void {
        if (!this.modalSaveIndicator) {
            return
        }

        this.modalSaveIndicator.replaceChildren()
        this.modalSaveIndicator.classList.remove('saving', 'saved', 'error')

        if (this.autosaveState === 'saving') {
            this.modalSaveIndicator.classList.add('saving')
            const spinner = document.createElement('span')
            spinner.classList.add('participants-saving-spinner')
            this.modalSaveIndicator.appendChild(spinner)

            const label = document.createElement('span')
            label.textContent = 'Saving'
            this.modalSaveIndicator.appendChild(label)
            return
        }

        if (this.autosaveState === 'error') {
            this.modalSaveIndicator.classList.add('error')
            this.modalSaveIndicator.textContent = 'Save failed'
            return
        }

        this.modalSaveIndicator.classList.add('saved')
        const icon = document.createElement('img')
        icon.src = SAVE_SYMBOL
        icon.alt = 'Saved'
        this.modalSaveIndicator.appendChild(icon)

        const label = document.createElement('span')
        label.textContent = 'Saved'
        this.modalSaveIndicator.appendChild(label)
    }
}
