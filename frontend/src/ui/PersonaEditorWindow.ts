import '../css/personaEditorWindow.css'

import type { Persona, Uuid } from 'vertex-common'
import { updateConversationParticipants } from '../api/ConversationsAPI.js'
import {
    createPersona,
    deletePersona,
    fetchCoreFile,
    fetchPersona,
    setPersonaAvatar,
    updateCoreFile,
    updatePersona,
} from '../api/PersonasAPI.js'
import type { App } from '../App.js'
import MarkdownIt from 'markdown-it'

const ROOT_FILE_NAMES = ['Soul', 'Instructions', 'Memories', 'Notes', 'Subconscious']
const SAVE_SYMBOL = new URL('../../icons/save.png', import.meta.url).href
const EXPAND_SYMBOL = new URL('../../icons/expand.png', import.meta.url).href
const SHRINK_SYMBOL = new URL('../../icons/shrink.png', import.meta.url).href
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
    private autosaveRevision = 0
    private coreFileTimers = new Map<string, number>()
    private coreFileRevision = 0

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
        for (const timer of this.coreFileTimers.values()) clearTimeout(timer)
        this.coreFileTimers.clear()
        this.coreFileRevision++

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

        const tabBar = document.createElement('div')
        tabBar.classList.add('participants-editor-tabs')
        tabBar.setAttribute('role', 'tablist')
        this.modalEditor.appendChild(tabBar)

        const tabPanels = document.createElement('div')
        tabPanels.classList.add('participants-editor-tab-panels')
        this.modalEditor.appendChild(tabPanels)

        const tabs: { button: HTMLButtonElement; panel: HTMLElement }[] = []
        const addTab = (label: string, panel: HTMLElement): void => {
            const button = document.createElement('button')
            button.type = 'button'
            button.classList.add('participants-editor-tab')
            button.setAttribute('role', 'tab')
            button.textContent = label
            button.addEventListener('click', () => {
                for (const tab of tabs) {
                    const active = tab.button === button
                    tab.button.classList.toggle('active', active)
                    tab.panel.hidden = !active
                }
            })

            const active = tabs.length === 0
            button.classList.toggle('active', active)
            panel.hidden = !active

            tabs.push({ button, panel })
            tabBar.appendChild(button)
            tabPanels.appendChild(panel)
        }

        const promptField = this.buildMarkdownField('Edit persona prompt', selected.prompt, (value) => {
            selected.prompt = value
            this.setAutosaveState('saving')
            this.scheduleAutosave(selected.id)
        })
        void this.loadRootFiles(selected, addTab, promptField.setValue)

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

    private buildMarkdownField(
        ariaLabel: string,
        initialValue: string,
        onInput: (value: string) => void,
    ): { element: HTMLDivElement; setValue: (value: string) => void } {
        let value = initialValue
        let activeInput: HTMLTextAreaElement | null = null

        const field = document.createElement('div')
        field.classList.add('participants-editor-field')

        const content = document.createElement('div')
        content.classList.add('participants-editor-prompt-container')
        field.appendChild(content)

        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.classList.add('participants-editor-fullscreen-toggle')
        const toggleIcon = document.createElement('img')
        toggle.appendChild(toggleIcon)
        field.appendChild(toggle)

        const updateToggle = (): void => {
            const fullscreen = field.classList.contains('fullscreen')
            toggleIcon.src = fullscreen ? SHRINK_SYMBOL : EXPAND_SYMBOL
            toggleIcon.alt = fullscreen ? 'Exit full screen' : 'Full screen'
            toggle.title = toggleIcon.alt
        }
        updateToggle()

        // Keeps the textarea from blurring (and collapsing to preview) when the button is pressed.
        toggle.addEventListener('mousedown', (event) => event.preventDefault())
        toggle.addEventListener('click', () => {
            field.classList.toggle('fullscreen')
            updateToggle()
        })
        field.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && field.classList.contains('fullscreen')) {
                event.stopPropagation()
                field.classList.remove('fullscreen')
                updateToggle()
            }
        })

        const renderPreview = (): void => {
            activeInput = null
            content.replaceChildren()

            const preview = document.createElement('div')
            preview.classList.add('participants-editor-markdown')
            preview.tabIndex = 0
            preview.setAttribute('role', 'button')
            preview.setAttribute('aria-label', ariaLabel)
            preview.title = 'Click to edit'
            preview.innerHTML = md.render(value)
            preview.addEventListener('click', renderEditor)
            preview.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    renderEditor()
                }
            })
            content.appendChild(preview)
        }

        function renderEditor(): void {
            content.replaceChildren()

            const input = document.createElement('textarea')
            input.value = value
            input.classList.add('participants-editor-textarea')
            input.rows = 8
            input.addEventListener('input', () => {
                value = input.value
                onInput(value)
            })
            input.addEventListener('blur', () => {
                value = input.value
                renderPreview()
            })

            activeInput = input
            content.appendChild(input)
            input.focus()
            input.setSelectionRange(input.value.length, input.value.length)
        }

        renderPreview()

        return {
            element: field,
            setValue: (next) => {
                value = next
                if (activeInput) activeInput.value = next
                else renderPreview()
            },
        }
    }

    private async loadRootFiles(
        persona: Persona,
        addTab: (label: string, panel: HTMLElement) => void,
        setPromptValue: (value: string) => void,
    ): Promise<void> {
        let files: Record<string, string> = {}
        try {
            for (const name of ROOT_FILE_NAMES) {
                files[name] = await fetchCoreFile(persona.id, name)
            }
        } catch (error) {
            console.error('Failed to load core files:', error)
            this.setStatus('Failed to load core files.')
            return
        }

        for (const name of ROOT_FILE_NAMES) {
            const field = this.buildMarkdownField(`Edit ${name}`, files[name], (value) => {
                this.scheduleCoreFileSave(persona, name, value, setPromptValue)
            })
            addTab(name, field.element)
        }
    }

    private scheduleCoreFileSave(
        persona: Persona,
        name: string,
        content: string,
        setPromptValue: (value: string) => void,
    ): void {
        const key = `${persona.id}:${name}`
        const existing = this.coreFileTimers.get(key)
        if (existing !== undefined) clearTimeout(existing)

        const revision = ++this.coreFileRevision
        this.setAutosaveState('saving')

        const timer = window.setTimeout(async () => {
            this.coreFileTimers.delete(key)
            try {
                if (revision !== this.coreFileRevision) {
                    return
                }

                await updateCoreFile(persona.id, name, content)
                const updated = await fetchPersona(persona.id)

                if (updated.prompt !== persona.prompt) {
                    persona.prompt = updated.prompt
                    setPromptValue(updated.prompt)
                }
                persona.updated = updated.updated

                await this.app.reloadPersonas()
                await this.onParticipantsChanged()
                this.setAutosaveState('saved')
            } catch (error) {
                if (revision !== this.coreFileRevision) {
                    return
                }
                console.error('Failed to save core file:', error)
                this.setAutosaveState('error')
                this.setStatus('Autosave failed. Try again.')
            }
        }, 600)
        this.coreFileTimers.set(key, timer)
    }

    private scheduleAutosave(personaId: Uuid): void {
        if (this.autosaveTimer !== null) {
            clearTimeout(this.autosaveTimer)
        }

        const revision = ++this.autosaveRevision

        this.autosaveTimer = window.setTimeout(async () => {
            this.autosaveTimer = null
            const persona = this.modalPersonas.find((entry) => entry.id === personaId)
            if (!persona) {
                return
            }

            try {
                const updated = await updatePersona(persona.id, {
                    name: persona.name,
                    prompt: persona.prompt,
                })

                // Ignore stale autosave responses so only the latest edit updates local UI state.
                if (revision !== this.autosaveRevision) {
                    return
                }

                if (persona.id === updated.id) {
                    persona.name = updated.name
                    persona.prompt = updated.prompt
                    persona.created = updated.created
                    persona.updated = updated.updated
                    persona.avatarUrl = updated.avatarUrl
                }

                this.modalSelectedPersonaId = updated.id
                await this.app.reloadPersonas()
                await this.onParticipantsChanged()
                this.setAutosaveState('saved')
                this.renderModalPersonaList()
                // this.renderModalEditor()
            } catch (error) {
                if (revision !== this.autosaveRevision) {
                    return
                }
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
