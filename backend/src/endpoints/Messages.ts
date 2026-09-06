import type { Express, Request, Response } from 'express'
import type { MessageContent, Uuid } from 'vertex-common'
import type { ConversationStore } from '../services/ConversationStore.js'

export default function register(app: Express, conversationStore: ConversationStore): void {
    app.get('/api/messages/:messageId', (req: Request, res: Response) => {
        const messageId = req.params['messageId'] as Uuid
        const message = conversationStore.getMessage(messageId)
        if (!message) {
            res.status(404).json({ error: 'Message not found' })
            return
        }
        res.json(message)
    })

    app.post('/api/messages/create', (req: Request, res: Response) => {
        const conversationId = req.body.conversationId as Uuid | undefined
        const sender = req.body.sender as Uuid | undefined
        const content = (req.body.content || []) as MessageContent
        const metadata = (req.body.metadata || {}) as Record<string, unknown>
        console.log(
            'Received request to create message in conversation with ID:',
            conversationId,
            'from sender:',
            sender,
        )

        if (!conversationId) {
            console.warn('Missing conversationId in request body for creating message')
            res.status(400).json({ error: 'Missing conversationId' })
            return
        }

        if (!sender) {
            console.warn('Missing sender in request body for creating message')
            res.status(400).json({ error: 'Missing sender' })
            return
        }

        const conversation = conversationStore.getConversation(conversationId)
        if (!conversation) {
            console.warn('Conversation not found for ID:', conversationId)
            res.status(404).json({ error: 'Conversation not found' })
            return
        }

        const message = conversationStore.appendMessage(conversationId, sender, content, metadata)
        res.json(message)
    })

    app.put('/api/messages/:messageId', (req: Request, res: Response) => {
        const messageId = req.params['messageId'] as Uuid
        const content = req.body.content as MessageContent | undefined
        const metadata = req.body.metadata as Record<string, unknown> | undefined

        console.log('Received request to update message with ID:', messageId, 'to new content:', content)

        if (!content && !metadata) {
            console.warn('Missing content and/or metadata in request body for updating message with ID:', messageId)
            res.status(400).json({ error: 'Missing content and/or metadata' })
            return
        }

        const success = conversationStore.updateMessage(messageId, content, metadata)
        if (!success) {
            console.warn('Message not found or failed to update for ID:', messageId)
            res.status(404).json({ error: 'Message not found or failed to update' })
            return
        }

        res.json({ message: 'Message updated' })
    })

    app.delete('/api/messages/:messageId', (req: Request, res: Response) => {
        const messageId = req.params['messageId'] as Uuid
        console.log('Received request to delete message with ID:', messageId)

        const success = conversationStore.deleteMessage(messageId)
        if (!success) {
            console.warn('Failed to delete message with ID:', messageId)
            res.status(404).json({ error: 'Message not found' })
            return
        }

        res.json({ message: 'Message deleted' })
    })
}
