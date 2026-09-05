import '../css/chatHistory.css'
import type {
    Conversation,
    Message,
    MessageContent,
    MessageContentBlock,
    Persona,
    StreamedMessageContent,
    ToolPermissionRequest,
    Uuid,
} from 'vertex-common'

import type { App } from '../App.js'
import { submitToolPermissionDecision } from '../api/ChatGenerationAPI'
import { fetchConversation } from '../api/ConversationsAPI'

import MarkdownIt from 'markdown-it'

const DEFAULT_PROFILE_PICTURE = new URL('../../icons/default-pfp.png', import.meta.url).href
const DELETE_SYMBOL = new URL('../../icons/delete.png', import.meta.url).href
const SEND_SYMBOL = new URL('../../icons/send.png', import.meta.url).href
const GENERATE_SYMBOL = new URL('../../icons/generate.png', import.meta.url).href
const CLOSE_SYMBOL = new URL('../../icons/close.png', import.meta.url).href
const ATTACH_SYMBOL = new URL('../../icons/plus.png', import.meta.url).href
const TEXT_FILE_SYMBOL = new URL('../../icons/text.png', import.meta.url).href
const md = new MarkdownIt({ typographer: true })

type MessageSectionKind = 'thinking' | 'tool_call' | 'tool_response'

type ChatAttachment = {
    type: 'image' | 'file_attachment'
    name: string
    content: string
}

export class InputBox {
    private readonly app: App
    private input: HTMLDivElement | null = null
    private sendButton: HTMLButtonElement | null = null
    private generateButton: HTMLButtonElement | null = null
    private generateIcon: HTMLImageElement | null = null
    private attachments: ChatAttachment[] = []
    private attachmentPreview: HTMLDivElement | null = null
    private isGenerating = false
    private generationAbortController: AbortController | null = null

    constructor(app: App) {
        this.app = app
    }

    build(): HTMLDivElement {
        const container = document.createElement('div')
        container.classList.add('chat-input-composer')

        const div = document.createElement('div')
        div.classList.add('chat-input-row')
        container.appendChild(div)

        const input = document.createElement('div')
        input.setAttribute('placeholder', 'Type your message...')
        input.setAttribute('contenteditable', 'true')
        input.id = 'chat-input-field'
        this.input = input
        div.appendChild(input)

        const attachButton = document.createElement('button')
        attachButton.type = 'button'
        attachButton.classList.add('chat-input-button')
        attachButton.setAttribute('aria-label', 'Attach file')
        attachButton.title = 'Attach file'

        const attachIcon = document.createElement('img')
        attachIcon.src = ATTACH_SYMBOL
        attachIcon.alt = ''
        attachButton.appendChild(attachIcon)

        const fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.multiple = true
        fileInput.style.display = 'none'
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files ?? [])
            if (!files.length) return

            const attachments = await Promise.all(files.map((file) => this.readFileAttachment(file)))
            this.attachments.push(...attachments)
            this.renderAttachmentPreviews()
            fileInput.value = ''
        })
        attachButton.addEventListener('click', () => {
            fileInput.click()
        })
        div.appendChild(attachButton)

        const sendButton = document.createElement('button')
        sendButton.id = 'chat-send-button'
        sendButton.type = 'button'
        sendButton.classList.add('chat-input-button')
        sendButton.setAttribute('aria-label', 'Send message')
        sendButton.title = 'Send message'

        const sendIcon = document.createElement('img')
        sendIcon.src = SEND_SYMBOL
        sendIcon.alt = ''
        sendButton.appendChild(sendIcon)
        this.sendButton = sendButton

        sendButton.addEventListener('click', async () => {
            if (this.isGenerating) {
                return
            }

            const messageText = input.textContent?.trim() ?? ''
            if (!messageText && this.attachments.length === 0) return

            const messageContent: MessageContent = []
            if (messageText) {
                messageContent.push({ type: 'text', content: messageText })
            }

            for (const attachment of this.attachments) {
                messageContent.push({
                    type: attachment.type,
                    content: attachment.content,
                    name: attachment.name,
                })
            }

            const userId = this.app.userId
            if (!userId) {
                alert('Profile not selected. Please select a profile before sending messages.')
                return
            }

            const conversationId = this.app.conversationId
            if (!conversationId) {
                alert('No conversation selected.')
                return
            }

            input.textContent = ''
            this.clearAttachments()

            try {
                await this.app.sendMessage(conversationId, userId, messageContent)
            } catch (error) {
                console.error('Error sending message:', error)
                alert('Failed to send message. Please try again.')
                return
            }
        })
        div.appendChild(sendButton)

        const generateButton = document.createElement('button')
        generateButton.id = 'chat-generate-button'
        generateButton.type = 'button'
        generateButton.classList.add('chat-input-button')
        generateButton.setAttribute('aria-label', 'Generate response')
        generateButton.title = 'Generate response'

        const generateIcon = document.createElement('img')
        generateIcon.src = GENERATE_SYMBOL
        generateIcon.alt = ''
        generateButton.appendChild(generateIcon)

        this.generateButton = generateButton
        this.generateIcon = generateIcon

        generateButton.addEventListener('click', async () => {
            if (this.isGenerating) {
                this.cancelGeneration()
                return
            }

            const userId = this.app.userId
            if (!userId) {
                alert('Profile not selected. Please select a profile before generating messages.')
                return
            }

            const conversationId = this.app.conversationId
            if (!conversationId) {
                alert('No conversation selected.')
                return
            }

            this.generationAbortController = new AbortController()
            this.setGenerationState(true)

            try {
                await this.app.generateAgentMessage(conversationId, userId, this.generationAbortController.signal)
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    return
                }

                console.error('Error generating message:', error)
                alert('Failed to generate message. Please try again.')
                return
            } finally {
                this.generationAbortController = null
                this.setGenerationState(false)
            }
        })
        div.appendChild(generateButton)

        const preview = document.createElement('div')
        preview.classList.add('chat-input-attachments')
        this.attachmentPreview = preview
        container.appendChild(preview)
        this.renderAttachmentPreviews()

        return container
    }

    private async readFileAttachment(file: File): Promise<ChatAttachment> {
        if (file.type.startsWith('image/')) {
            return {
                type: 'image',
                name: file.name,
                content: await this.convertImageToPng(file),
            }
        }

        return {
            type: 'file_attachment',
            name: file.name,
            content: await this.readFileAsDataUrl(file),
        }
    }

    private async readFileAsDataUrl(file: File): Promise<string> {
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result)
                    return
                }
                reject(new Error(`Failed to read ${file.name}`))
            }
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
            reader.readAsDataURL(file)
        })
    }

    private async convertImageToPng(file: File): Promise<string> {
        const sourceUrl = await this.readFileAsDataUrl(file)

        return await new Promise<string>((resolve, reject) => {
            const image = new Image()
            image.onload = () => {
                const canvas = document.createElement('canvas')
                canvas.width = image.naturalWidth
                canvas.height = image.naturalHeight

                const context = canvas.getContext('2d')
                if (!context) {
                    reject(new Error('Canvas is not supported in this browser.'))
                    return
                }

                context.drawImage(image, 0, 0)
                resolve(canvas.toDataURL('image/png'))
            }
            image.onerror = () => reject(new Error(`Failed to convert ${file.name} to PNG`))
            image.src = sourceUrl
        })
    }

    private clearAttachments(): void {
        this.attachments = []
        this.renderAttachmentPreviews()
    }

    private renderAttachmentPreviews(): void {
        if (!this.attachmentPreview) return

        this.attachmentPreview.replaceChildren()

        if (this.attachments.length === 0) {
            this.attachmentPreview.classList.remove('visible')
            return
        }

        this.attachmentPreview.classList.add('visible')

        for (const attachment of this.attachments) {
            const item = document.createElement('div')
            item.classList.add('chat-input-attachment')

            const preview = document.createElement('div')
            preview.classList.add('chat-input-attachment-preview')

            if (attachment.type === 'image') {
                const previewImage = document.createElement('img')
                previewImage.src = attachment.content
                previewImage.alt = attachment.name
                previewImage.loading = 'lazy'
                preview.appendChild(previewImage)
            } else {
                const fileIcon = document.createElement('img')
                fileIcon.src = TEXT_FILE_SYMBOL
                fileIcon.alt = attachment.name
                preview.appendChild(fileIcon)
            }

            const name = document.createElement('span')
            name.classList.add('chat-input-attachment-name')
            name.textContent = attachment.name
            item.appendChild(preview)
            item.appendChild(name)

            const removeButton = document.createElement('button')
            removeButton.type = 'button'
            removeButton.classList.add('chat-input-attachment-remove')
            removeButton.setAttribute('aria-label', `Remove ${attachment.name}`)
            removeButton.title = `Remove ${attachment.name}`
            removeButton.textContent = '×'
            removeButton.addEventListener('click', () => {
                this.attachments = this.attachments.filter((current) => current !== attachment)
                this.renderAttachmentPreviews()
            })
            item.appendChild(removeButton)
            this.attachmentPreview.appendChild(item)
        }
    }

    private cancelGeneration(): void {
        // Frontend placeholder cancel until backend cancellation semantics are implemented.
        this.generationAbortController?.abort()
    }

    private setGenerationState(generating: boolean): void {
        this.isGenerating = generating

        if (this.input) {
            this.input.setAttribute('contenteditable', generating ? 'false' : 'true')
            this.input.classList.toggle('chat-input-field-disabled', generating)
        }

        if (this.sendButton) {
            this.sendButton.disabled = generating
        }

        if (this.generateButton) {
            this.generateButton.classList.toggle('is-cancel', generating)
            this.generateButton.setAttribute('aria-label', generating ? 'Cancel generation' : 'Generate response')
            this.generateButton.title = generating ? 'Cancel generation' : 'Generate response'
        }

        if (this.generateIcon) {
            this.generateIcon.src = generating ? CLOSE_SYMBOL : GENERATE_SYMBOL
        }
    }
}

export class ChatMessage {
    private readonly onDelete: (messageId: Uuid, skipConfirmation: boolean) => Promise<void>
    private contentBlockUpdaters: ((newContent: string) => void)[] = []
    private messageContent: HTMLDivElement | null = null
    private toolCallSections: HTMLDetailsElement[] = []
    private permissionRequestRows: Map<string, HTMLDivElement> = new Map()

    public readonly id: Uuid
    public content: MessageContent
    public leftAligned: boolean = true
    public profilePictureUrl: string
    public personaName: string
    public element: HTMLDivElement | null = null

    constructor(
        id: Uuid,
        content: MessageContent,
        profilePictureUrl: string,
        personaName: string,
        leftAligned: boolean = true,
        onDelete: (messageId: Uuid, skipConfirmation: boolean) => Promise<void>,
    ) {
        this.id = id
        this.content = content
        this.profilePictureUrl = profilePictureUrl
        this.personaName = personaName
        this.leftAligned = leftAligned
        this.onDelete = onDelete
    }

    build(): HTMLDivElement {
        if (!this.element) {
            this.element = document.createElement('div')
            this.element.classList.add('chat-message-row')
        } else {
            this.element.replaceChildren()
        }
        this.contentBlockUpdaters = []
        this.toolCallSections = []
        this.permissionRequestRows.clear()

        const avatar = document.createElement('img')
        avatar.classList.add('chat-avatar')
        avatar.src = this.profilePictureUrl
        avatar.alt = `${this.personaName} profile picture`
        avatar.loading = 'lazy'

        const bubble = document.createElement('div')
        bubble.classList.add('chat-message')

        const personaName = document.createElement('div')
        personaName.classList.add('chat-message-name')
        personaName.textContent = this.personaName
        bubble.appendChild(personaName)

        const messageContent = document.createElement('div')
        messageContent.classList.add('chat-message-content')
        bubble.appendChild(messageContent)
        this.messageContent = messageContent

        for (const block of this.content) {
            this.appendContentBlock(block, true)
        }

        const actions = document.createElement('div')
        actions.classList.add('chat-message-actions')

        const deleteButton = document.createElement('button')
        deleteButton.type = 'button'
        deleteButton.classList.add('chat-message-delete-button')
        deleteButton.setAttribute('aria-label', 'Delete message')
        deleteButton.title = 'Delete message'
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation()
            await this.onDelete(this.id, event.shiftKey)
        })

        const deleteIcon = document.createElement('img')
        deleteIcon.src = DELETE_SYMBOL
        deleteIcon.alt = ''
        deleteButton.appendChild(deleteIcon)
        actions.appendChild(deleteButton)
        bubble.appendChild(actions)

        if (this.leftAligned) {
            this.element.classList.add('left-aligned')
            this.element.appendChild(avatar)
            this.element.appendChild(bubble)
        } else {
            this.element.classList.add('right-aligned')
            this.element.appendChild(bubble)
            this.element.appendChild(avatar)
        }

        return this.element
    }

    appendContentBlock(block: MessageContentBlock, buildOnly = false, expandDetails = false): void {
        if (!this.messageContent) {
            throw new Error('Message content container is not initialized')
        }

        switch (block.type) {
            case 'text':
                const [blockDiv, updateBlockDiv] = this.buildMarkdownBlock(block.content, 'chat-message-text')
                this.messageContent!.appendChild(blockDiv)
                this.contentBlockUpdaters.push(updateBlockDiv)
                break

            case 'image':
                this.messageContent!.appendChild(this.buildImageBlock(block.content, block.name ?? 'Uploaded image'))
                break

            case 'file_attachment':
                this.messageContent!.appendChild(
                    this.buildFileAttachmentBlock(block.content, block.name ?? 'Attached file'),
                )
                break

            case 'thinking':
                const [thinkingBlockDiv, updateThinkingBlockDiv] = this.buildCollapsibleSection(
                    'Thinking',
                    block.content,
                    'thinking',
                    expandDetails,
                )
                this.messageContent!.appendChild(thinkingBlockDiv)
                this.contentBlockUpdaters.push(updateThinkingBlockDiv)
                break

            case 'tool_call':
                const [toolCallBlockDiv, updateToolCallBlockDiv] = this.buildCollapsibleSection(
                    'Tool Call',
                    `\`\`\`json\n${block.content}\n\`\`\``,
                    'tool_call',
                    expandDetails,
                )
                this.messageContent!.appendChild(toolCallBlockDiv)
                this.toolCallSections.push(toolCallBlockDiv)
                this.contentBlockUpdaters.push(updateToolCallBlockDiv)
                break

            case 'tool_response':
                const [toolResponseBlockDiv, updateToolResponseBlockDiv] = this.buildCollapsibleSection(
                    'Tool Response',
                    block.content,
                    'tool_response',
                    expandDetails,
                )
                this.messageContent!.appendChild(toolResponseBlockDiv)
                this.contentBlockUpdaters.push(updateToolResponseBlockDiv)
                break

            default:
                throw new Error(`Failed to parse block: ${JSON.stringify(block)}`)
        }

        if (!buildOnly) {
            this.content.push(block)
        }
    }

    updateContentBlock(index: number, newContent: string): void {
        if (index < 0 || index >= this.content.length) {
            throw new Error(`Invalid content block index: ${index}`)
        }

        this.content[index].content = newContent
        this.contentBlockUpdaters[index](newContent)
    }

    collapseDetails(): void {
        if (!this.messageContent) {
            throw new Error('Message content container is not initialized')
        }

        const detailsElements = this.messageContent.querySelectorAll('details')
        detailsElements.forEach((details) => {
            details.open = false
        })
    }

    showToolPermissionRequest(
        request: ToolPermissionRequest,
        onDecision: (requestId: string, allowed: boolean) => Promise<void>,
    ): void {
        if (!this.messageContent || this.permissionRequestRows.has(request.requestId)) {
            return
        }

        const row = document.createElement('div')
        row.classList.add('chat-tool-permission-row')

        const text = document.createElement('p')
        text.classList.add('chat-tool-permission-text')
        text.textContent = `Allow tool \"${request.toolName}\" to run?`
        row.appendChild(text)

        const controls = document.createElement('div')
        controls.classList.add('chat-tool-permission-controls')

        const allowButton = document.createElement('button')
        allowButton.type = 'button'
        allowButton.classList.add('chat-tool-permission-allow')
        allowButton.textContent = 'Allow'

        const denyButton = document.createElement('button')
        denyButton.type = 'button'
        denyButton.classList.add('chat-tool-permission-deny')
        denyButton.textContent = 'Deny'

        const decide = async (allowed: boolean) => {
            allowButton.disabled = true
            denyButton.disabled = true

            try {
                await onDecision(request.requestId, allowed)
                row.remove()
                this.permissionRequestRows.delete(request.requestId)
            } catch (error) {
                console.error('Failed to submit permission decision:', error)
                alert('Failed to submit permission decision. Please try again.')
                allowButton.disabled = false
                denyButton.disabled = false
            }
        }

        allowButton.addEventListener('click', () => {
            void decide(true)
        })

        denyButton.addEventListener('click', () => {
            void decide(false)
        })

        controls.appendChild(allowButton)
        controls.appendChild(denyButton)
        row.appendChild(controls)

        const lastToolCall = this.toolCallSections.at(-1)
        if (lastToolCall?.parentElement) {
            lastToolCall.parentElement.insertBefore(row, lastToolCall.nextSibling)
        } else {
            this.messageContent.appendChild(row)
        }

        this.permissionRequestRows.set(request.requestId, row)
    }

    private buildImageBlock(content: string, name: string): HTMLDivElement {
        const block = document.createElement('div')
        block.classList.add('chat-message-attachment', 'chat-message-image')

        const image = document.createElement('img')
        image.src = content
        image.alt = name
        image.loading = 'lazy'
        block.appendChild(image)

        return block
    }

    private buildFileAttachmentBlock(content: string, name: string): HTMLDivElement {
        const block = document.createElement('div')
        block.classList.add('chat-message-attachment', 'chat-message-file')

        const icon = document.createElement('img')
        icon.src = TEXT_FILE_SYMBOL
        icon.alt = name
        block.appendChild(icon)

        const label = document.createElement('a')
        label.href = content
        label.download = name
        label.textContent = name
        block.appendChild(label)

        return block
    }

    private buildMarkdownBlock(content: string, ...classNames: string[]): [HTMLDivElement, (content: string) => void] {
        const block = document.createElement('div')
        block.classList.add('chat-message-markdown', ...classNames)
        block.innerHTML = md.render(content)
        return [
            block,
            (newContent: string) => {
                block.innerHTML = md.render(newContent)
            },
        ]
    }

    private buildCollapsibleSection(
        title: string,
        content: string,
        kind: MessageSectionKind,
        expandByDefault: boolean = false,
    ): [HTMLDetailsElement, (content: string) => void] {
        const details = document.createElement('details')
        details.classList.add('chat-message-section', `chat-message-section-${kind}`)
        if (expandByDefault) {
            details.open = true
        }

        const summary = document.createElement('summary')
        summary.classList.add('chat-message-section-summary')
        summary.textContent = title
        details.appendChild(summary)

        const [body, updateBody] = this.buildMarkdownBlock(content, 'chat-message-section-body')
        details.appendChild(body)

        return [details, updateBody]
    }
}

export class ChatHistory {
    private readonly app: App
    private readonly inputBox: InputBox
    private messages: ChatMessage[] = []
    private container: HTMLDivElement | null = null
    private personaCache: Map<Uuid, Persona | null> = new Map()

    constructor(app: App) {
        this.app = app
        this.inputBox = new InputBox(app)
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.id = 'chat-history'
        div.classList.add('outer-container')

        const header = document.createElement('div')
        header.id = 'chat-history-header'
        header.textContent = 'Chat History'
        div.appendChild(header)

        const outerContainer = document.createElement('div')
        outerContainer.id = 'chat-history-outer-container'
        div.appendChild(outerContainer)

        const container = document.createElement('div')
        container.id = 'chat-history-container'
        outerContainer.appendChild(container)
        this.container = container

        div.appendChild(this.inputBox.build())

        for (const message of this.messages) {
            container.appendChild(message.build())
        }

        this.scrollToBottom()

        return div
    }

    async reloadConversation(): Promise<void> {
        this.messages = []
        this.personaCache.clear()

        if (this.container) {
            this.container.replaceChildren()
        }

        const conversation = await this.fetchActiveConversation()
        if (!conversation) {
            return
        }

        for (const message of conversation.messages) {
            const isLeftAligned = message.sender !== this.app.userId
            const persona = await this.app.getPersona(message.sender)
            if (!persona) {
                this.messages.push(
                    new ChatMessage(
                        message.id,
                        message.content,
                        DEFAULT_PROFILE_PICTURE,
                        '[Deleted User]',
                        isLeftAligned,
                        this.confirmAndDeleteMessage.bind(this),
                    ),
                )
                if (this.container) {
                    this.container.appendChild(this.messages[this.messages.length - 1].build())
                }
                continue
            }

            const avatarUrl = persona.avatarUrl ?? DEFAULT_PROFILE_PICTURE
            this.messages.push(
                new ChatMessage(
                    message.id,
                    message.content,
                    avatarUrl,
                    persona.name,
                    isLeftAligned,
                    this.confirmAndDeleteMessage.bind(this),
                ),
            )

            if (this.container) {
                this.container.appendChild(this.messages[this.messages.length - 1].build())
            }
        }

        this.scrollToBottom()
    }

    private async fetchActiveConversation(): Promise<Conversation | null> {
        const conversationId = this.app.conversationId
        if (!conversationId) return null
        return await fetchConversation(conversationId)
    }

    async appendMessage(message: Message): Promise<void> {
        const shouldAutoScroll = this.isNearBottom()
        const isLeftAligned = message.sender !== this.app.userId

        const persona = await this.app.getPersona(message.sender)
        const avatarUrl = persona?.avatarUrl ?? DEFAULT_PROFILE_PICTURE
        const personaName = persona?.name ?? '[Deleted User]'
        const chatMessage = new ChatMessage(
            message.id,
            message.content,
            avatarUrl,
            personaName,
            isLeftAligned,
            this.confirmAndDeleteMessage.bind(this),
        )

        this.messages.push(chatMessage)
        if (this.container) {
            this.container.appendChild(chatMessage.build())
        }

        if (shouldAutoScroll) {
            this.scrollToBottom()
        }
    }

    updateMessage(messageId: Uuid, newContent: MessageContent): void {
        const messageIndex = this.messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex === -1) return // Ignore messages we can't see

        const existingMessage = this.messages[messageIndex]
        existingMessage.content = newContent
        existingMessage.build()
        this.scrollToBottom()
    }

    async showToolPermissionRequest(messageId: Uuid, request: ToolPermissionRequest): Promise<void> {
        const messageIndex = this.messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex === -1) return

        this.messages[messageIndex].showToolPermissionRequest(request, async (requestId, allowed) => {
            await submitToolPermissionDecision(requestId, allowed)
        })

        this.scrollToBottom()
    }

    streamMessageContent(messageId: Uuid, fragment: StreamedMessageContent): void {
        const messageIndex = this.messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex === -1) return // Ignore messages we can't see

        const existingMessage = this.messages[messageIndex]
        const blockIndex = existingMessage.content.length - 1

        console.log(`Streaming content for message ${messageId}:`, fragment)

        if (existingMessage.content[blockIndex]?.type === fragment.type) {
            const newContent = existingMessage.content[blockIndex].content + fragment.delta
            existingMessage.updateContentBlock(blockIndex, newContent)
        } else {
            existingMessage.appendContentBlock(
                {
                    type: fragment.type,
                    content: fragment.delta,
                },
                false,
                true,
            )
        }
    }

    removeMessage(messageId: Uuid): void {
        const messageIndex = this.messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex === -1) return

        const [message] = this.messages.splice(messageIndex, 1)
        if (message.element) {
            message.element.remove()
        }
    }

    private async confirmAndDeleteMessage(messageId: Uuid, skipConfirmation: boolean): Promise<void> {
        if (!skipConfirmation) {
            const confirmed = confirm('Delete this message?')
            if (!confirmed) {
                return
            }
        }

        try {
            await this.app.deleteMessage(messageId)
        } catch (error) {
            console.error('Failed to delete message:', error)
            alert('Failed to delete message. Please try again.')
        }
    }

    private isNearBottom(thresholdPx: number = 64): boolean {
        if (!this.container) {
            return false
        }

        const remainingScroll = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight
        return remainingScroll <= thresholdPx
    }

    scrollToBottom(): void {
        if (!this.container) {
            return
        }

        this.container.scrollTop = this.container.scrollHeight
    }
}
