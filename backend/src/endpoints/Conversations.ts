import type { Express, Request, Response } from 'express'
import type { ConversationStore } from '../services/ConversationStore.js'
import type { Uuid } from 'vertex-common'

export default function register(app: Express, conversationStore: ConversationStore): void {
    app.get('/api/workspaces', (_req: Request, res: Response) => {
        console.log('Received request to list workspaces')
        res.json(conversationStore.listWorkspaces())
    })

    app.get('/api/workspaces/:workspaceId', (req: Request, res: Response) => {
        const workspaceId = req.params['workspaceId'] as Uuid
        console.log('Received request to get workspace with ID:', workspaceId)

        const workspace = conversationStore.getWorkspace(workspaceId)
        if (!workspace) {
            console.warn('Workspace not found for ID:', workspaceId)
            res.status(404).json({ error: 'Workspace not found' })
            return
        }
        res.json(workspace)
    })

    app.post('/api/workspaces/create', (req: Request, res: Response) => {
        const name = req.body.name as string | undefined
        const metadata = req.body.metadata as Record<string, unknown> | undefined
        console.log('Received request to create workspace with name:', name, 'and metadata:', metadata)

        if (!name) {
            console.warn('Missing name in request body for creating workspace')
            res.status(400).json({ error: 'Missing name' })
            return
        }

        const workspace = conversationStore.createWorkspace(name, metadata ?? {})
        res.json(workspace)
    })

    app.delete('/api/workspaces/:workspaceId', (req: Request, res: Response) => {
        const workspaceId = req.params['workspaceId'] as Uuid
        console.log('Received request to delete workspace with ID:', workspaceId)

        const success = conversationStore.deleteWorkspace(workspaceId)
        if (!success) {
            console.warn('Failed to delete workspace with ID:', workspaceId)
            res.status(404).json({ error: 'Workspace not found' })
            return
        }
        res.json({ message: 'Workspace deleted' })
    })

    app.patch('/api/workspaces/:workspaceId', (req: Request, res: Response) => {
        const workspaceId = req.params['workspaceId'] as Uuid
        const newName = req.body.name as string | undefined
        console.log('Received request to rename workspace with ID:', workspaceId, 'to new name:', newName)

        if (!newName) {
            console.warn('Missing name in request body for renaming workspace with ID:', workspaceId)
            res.status(400).json({ error: 'Missing name' })
            return
        }

        const workspace = conversationStore.getWorkspace(workspaceId)
        if (!workspace) {
            console.warn('Workspace not found for ID:', workspaceId)
            res.status(404).json({ error: 'Workspace not found' })
            return
        }

        const success = conversationStore.renameWorkspace(workspace.id, newName)
        if (!success) {
            console.error('Failed to rename workspace with ID:', workspaceId)
            res.status(500).json({ error: 'Failed to update workspace' })
            return
        }

        res.json({ message: 'Workspace updated' })
    })

    app.get('/api/conversations/:conversationId', (req: Request, res: Response) => {
        const conversationId = req.params['conversationId'] as Uuid
        console.log('Received request to get conversation with ID:', conversationId)

        const conversation = conversationStore.getConversation(conversationId)
        if (!conversation) {
            console.warn('Conversation not found for ID:', conversationId)
            res.status(404).json({ error: 'Conversation not found' })
            return
        }

        res.json(conversation)
    })

    app.post('/api/conversations/create', (req: Request, res: Response) => {
        const name = req.body.name as string | undefined
        const workspaceId = req.body.workspaceId as Uuid | undefined
        console.log('Received request to create conversation with name:', name, 'in workspace ID:', workspaceId)

        if (!name || !workspaceId) {
            console.warn('Missing name or workspaceId in request body for creating conversation')
            res.status(400).json({ error: 'Missing name or workspaceId' })
            return
        }

        if (!conversationStore.getWorkspace(workspaceId)) {
            console.warn('Workspace not found for ID:', workspaceId)
            res.status(404).json({ error: 'Workspace not found' })
            return
        }

        const conversation = conversationStore.createConversation(workspaceId, name)
        res.json(conversation)
    })

    app.delete('/api/conversations/:conversationId', (req: Request, res: Response) => {
        const conversationId = req.params['conversationId'] as Uuid
        console.log('Received request to delete conversation with ID:', conversationId)

        const success = conversationStore.deleteConversation(conversationId)
        if (!success) {
            console.warn('Failed to delete conversation with ID:', conversationId)
            res.status(404).json({ error: 'Conversation not found' })
            return
        }

        res.json({ message: 'Conversation deleted' })
    })

    app.patch('/api/conversations/:conversationId', (req: Request, res: Response) => {
        const conversationId = req.params['conversationId'] as Uuid
        const newName = req.body.name as string | undefined
        const participants = req.body.participants as Uuid[] | undefined
        console.log(
            'Received request to update conversation with ID:',
            conversationId,
            'name:',
            newName,
            'participants:',
            participants,
        )

        if (newName === undefined && participants === undefined) {
            console.warn(
                'Missing name and participants in request body for updating conversation with ID:',
                conversationId,
            )
            res.status(400).json({ error: 'Missing name and/or participants' })
            return
        }

        const conversation = conversationStore.getConversation(conversationId)
        if (!conversation) {
            console.warn('Conversation not found for ID:', conversationId)
            res.status(404).json({ error: 'Conversation not found' })
            return
        }

        if (newName !== undefined) {
            const renamed = conversationStore.renameConversation(conversation.id, newName)
            if (!renamed) {
                console.error('Failed to rename conversation with ID:', conversationId)
                res.status(500).json({ error: 'Failed to rename conversation' })
                return
            }
        }

        if (participants !== undefined) {
            const updatedParticipants = conversationStore.updateConversationParticipants(conversation.id, participants)
            if (!updatedParticipants) {
                console.error('Failed to update participants for conversation with ID:', conversationId)
                res.status(500).json({ error: 'Failed to update conversation participants' })
                return
            }
        }

        res.json({ message: 'Conversation updated' })
    })
}
