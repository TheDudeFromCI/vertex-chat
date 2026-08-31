import '../css/chatHistory.css'
import type { Conversation, Message, MessageContent, Persona, Uuid } from 'vertex-common'

import type { App } from '../App.js'
import { fetchConversation } from '../api/ConversationsAPI'

import MarkdownIt from 'markdown-it'

const DEFAULT_PROFILE_PICTURE = new URL('../../icons/default-pfp.png', import.meta.url).href
const md = new MarkdownIt({ typographer: true })

export class InputBox {
    private readonly app: App

    constructor(app: App) {
        this.app = app
    }

    build(): HTMLDivElement {
        const div = document.createElement('div')
        div.classList.add('chat-input-row')

        const input = document.createElement('div')
        input.setAttribute('placeholder', 'Type your message...')
        input.setAttribute('contenteditable', 'true')
        input.id = 'chat-input-field'
        div.appendChild(input)

        const sendButton = document.createElement('button')
        sendButton.id = 'chat-send-button'
        sendButton.textContent = 'Send'
        sendButton.addEventListener('click', async () => {
            const messageText = input.textContent?.trim()
            if (!messageText) return

            const messageContent = [{ type: 'text', content: messageText }] as MessageContent

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

            try {
                await this.app.sendMessage(this.app.conversationId!, userId, messageContent)
            } catch (error) {
                console.error('Error sending message:', error)
                alert('Failed to send message. Please try again.')
                return
            }
        })
        div.appendChild(sendButton)

        const generateButton = document.createElement('button')
        generateButton.id = 'chat-generate-button'
        generateButton.textContent = 'Generate'
        generateButton.addEventListener('click', async () => {
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

            try {
                await this.app.generateAgentMessage(conversationId, userId)
            } catch (error) {
                console.error('Error generating message:', error)
                alert('Failed to generate message. Please try again.')
                return
            }
        })
        div.appendChild(generateButton)

        return div
    }
}

export class ChatMessage {
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
    ) {
        this.id = id
        this.content = content
        this.profilePictureUrl = profilePictureUrl
        this.personaName = personaName
        this.leftAligned = leftAligned
    }

    build(): HTMLDivElement {
        if (!this.element) {
            this.element = document.createElement('div')
            this.element.classList.add('chat-message-row')
        } else {
            this.element.replaceChildren()
        }

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

        for (const block of this.content) {
            switch (block.type) {
                case 'text':
                    const text = document.createElement('div')
                    text.classList.add('chat-message-text')
                    text.innerHTML = md.render(block.content)
                    messageContent.appendChild(text)
                    break

                case 'thinking':
                    const thinking = document.createElement('div')
                    thinking.classList.add('chat-message-thinking')
                    thinking.innerHTML = md.render(block.content)
                    messageContent.appendChild(thinking)
                    break
                case 'tool_call':
                    const toolCall = document.createElement('div')
                    toolCall.classList.add('chat-message-toolcall')
                    toolCall.textContent = `/${block.content}`
                    messageContent.appendChild(toolCall)
                    break
                case 'tool_response':
                    const toolResponse = document.createElement('div')
                    toolResponse.classList.add('chat-message-toolresponse')
                    toolResponse.textContent = block.content
                    messageContent.appendChild(toolResponse)
                    break

                default:
                    throw new Error(`Failed to parse block: ${JSON.stringify(block)}`)
            }
        }

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
                    new ChatMessage(message.id, message.content, DEFAULT_PROFILE_PICTURE, 'System', false),
                )
                continue
            }

            const avatarUrl = persona.avatarUrl ?? DEFAULT_PROFILE_PICTURE
            this.messages.push(new ChatMessage(message.id, message.content, avatarUrl, persona.name, isLeftAligned))

            if (this.container) {
                this.container.appendChild(this.messages[this.messages.length - 1].build())
            }
        }

        this.scrollToBottom()
    }

    private async fetchActiveConversation(): Promise<Conversation> {
        const conversationId = this.app.conversationId

        if (!conversationId) {
            throw new Error('No active conversation ID found.')
        }

        return await fetchConversation(conversationId)
    }

    async appendMessage(message: Message): Promise<void> {
        const shouldAutoScroll = this.isNearBottom()
        const isLeftAligned = message.sender !== this.app.userId

        const persona = await this.app.getPersona(message.sender)
        const avatarUrl = persona?.avatarUrl ?? DEFAULT_PROFILE_PICTURE
        const personaName = persona?.name ?? 'System'
        const chatMessage = new ChatMessage(message.id, message.content, avatarUrl, personaName, isLeftAligned)

        this.messages.push(chatMessage)
        if (this.container) {
            this.container.appendChild(chatMessage.build())
        }

        if (shouldAutoScroll) {
            this.scrollToBottom()
        }
    }

    async updateMessage(messageId: Uuid, newContent: MessageContent): Promise<void> {
        const messageIndex = this.messages.findIndex((msg) => msg.id === messageId)
        if (messageIndex === -1) return // Ignore messages we can't see

        const existingMessage = this.messages[messageIndex]
        existingMessage.content = newContent
        existingMessage.build()
    }

    private isNearBottom(thresholdPx: number = 64): boolean {
        if (!this.container) {
            return false
        }

        const remainingScroll = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight
        return remainingScroll <= thresholdPx
    }

    private scrollToBottom(): void {
        if (!this.container) {
            return
        }

        this.container.scrollTop = this.container.scrollHeight
    }
}
