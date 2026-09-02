import { default as express, type Request, type Response } from 'express'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { default as Database } from 'better-sqlite3'
import type { ChatCompletionRequest, MessageContent, Uuid } from 'vertex-common'

import { ConversationStore } from './services/ConversationStore.js'
import { PersonaStore } from './services/PersonaStore.js'
import { LLMService } from './services/LLMService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..', '..', '..')
const FRONTEND_DIST = join(ROOT_DIR, 'frontend', 'dist')

const app = express()
const httpServer = createServer(app)

// Initialize Database
const dbPath = process.env['DATABASE_PATH'] || join(ROOT_DIR, 'database.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// Initialize services
const conversationStore = new ConversationStore(db)
const personaCatalog = new PersonaStore(db)

const llmService = await LLMService.initClient({
    apiKey: process.env['OPENAI_API_KEY'] ?? 'no-key',
    baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1',
    timeout: parseInt(process.env['OPENAI_TIMEOUT'] || '300000', 10),
    model: process.env['OPENAI_DEFAULT_MODEL'] ?? 'model',
})

// Middleware
app.use(express.json({ limit: '10mb' }))

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Credentials', 'true')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
        res.sendStatus(200)
        return
    }

    next()
})

// ===== Health check endpoint =====

app.get('/api/health', async (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
})

// ===== Personas endpoint =====

app.get('/api/personas', (_req: Request, res: Response) => {
    console.log('Received request to list personas')
    res.json(personaCatalog.listPersonas())
})

app.get('/api/personas/:personaId', (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    console.log('Received request to get persona with ID:', req.params['personaId'])

    const persona = personaCatalog.getPersona(personaId)

    if (!persona) {
        console.warn('Persona not found for ID:', personaId)
        res.status(404).json({ error: 'Persona not found' })
        return
    }

    res.json(persona)
})

app.post('/api/personas/create', (req: Request, res: Response) => {
    const name = req.body.name as string | undefined
    const prompt = req.body.prompt as string | undefined

    console.log('Received request to create persona with name:', name, 'and prompt:', prompt)

    if (!name) {
        console.warn('Missing name in request body for creating persona')
        res.status(400).json({ error: 'Missing name' })
        return
    }

    const persona = personaCatalog.createPersona(name, prompt)
    res.json(persona)
})

app.patch('/api/personas/:personaId', (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    console.log('Received request to update persona with ID:', personaId)

    const existingPersona = personaCatalog.getPersona(personaId)

    if (!existingPersona) {
        console.warn('Persona not found for ID:', personaId)
        res.status(404).json({ error: 'Persona not found' })
        return
    }

    const name = req.body.name as string | undefined
    const prompt = req.body.prompt as string | undefined
    console.log('Updating persona with ID:', personaId, 'with name:', name, 'and prompt:', prompt)

    if (name === undefined && prompt === undefined) {
        console.warn('Missing name or prompt in request body for updating persona with ID:', personaId)
        res.status(400).json({ error: 'Missing name or prompt' })
        return
    }

    const updatedPersona = personaCatalog.updatePersona(
        personaId,
        name ?? existingPersona.name,
        prompt ?? existingPersona.prompt,
    )

    if (!updatedPersona) {
        console.warn('Failed to update persona with ID:', personaId)
        res.status(404).json({ error: 'Persona not found' })
        return
    }

    res.json(updatedPersona)
})

app.put('/api/personas/:personaId/avatar', async (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    const fileDataBase64 = req.body.fileDataBase64 as string | undefined
    console.log('Received request to set avatar for persona with ID:', personaId)

    if (!fileDataBase64) {
        console.warn('Missing fileDataBase64 in request body for setting avatar for persona with ID:', personaId)
        res.status(400).json({ error: 'Missing fileDataBase64' })
        return
    }

    try {
        const saved = await personaCatalog.setProfilePicture(personaId, fileDataBase64)
        if (!saved) {
            console.warn('Failed to find persona with ID:', personaId)
            res.status(404).json({ error: 'Persona not found' })
            return
        }
    } catch (error) {
        console.error('Error while setting avatar for persona with ID:', personaId, error)
        res.status(400).json({ error: 'Invalid base64 image data' })
        return
    }

    res.json({ message: 'Avatar saved' })
})

app.get('/api/personas/:personaId/avatar', (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    console.log('Received request to get avatar for persona with ID:', personaId)

    const picture = personaCatalog.getProfilePicture(personaId)

    if (!picture) {
        console.warn('Avatar not found for persona with ID:', personaId)
        res.status(404).json({ error: 'Avatar not found' })
        return
    }

    res.setHeader('Content-Type', picture.mimeType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(picture.data)
})

app.delete('/api/personas/:personaId/avatar', (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    console.log('Received request to delete avatar for persona with ID:', personaId)

    const removed = personaCatalog.removeProfilePicture(personaId)

    if (!removed) {
        console.warn('Failed to delete avatar for persona with ID:', personaId)
        res.status(404).json({ error: 'Avatar not found' })
        return
    }

    res.json({ message: 'Avatar deleted' })
})

app.delete('/api/personas/:personaId', (req: Request, res: Response) => {
    const personaId = req.params['personaId'] as Uuid
    console.log('Received request to delete persona with ID:', personaId)

    const success = personaCatalog.deletePersona(personaId)

    if (!success) {
        console.warn('Failed to delete persona with ID:', personaId)
        res.status(404).json({ error: 'Persona not found' })
        return
    }

    res.json({ message: 'Persona deleted' })
})

// ===== Workspaces endpoint =====

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

// ===== Conversations endpoint =====

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
        console.warn('Missing name and participants in request body for updating conversation with ID:', conversationId)
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

// ===== Messages endpoint =====

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
    console.log('Received request to create message in conversation with ID:', conversationId, 'from sender:', sender)

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

// ===== LLM endpoint =====

app.post('/api/llm/chat', async (req: Request, res: Response) => {
    const body = req.body as ChatCompletionRequest
    console.log('Received request for LLM chat completion with messages:', body)

    const generationAbortController = new AbortController()
    const abortGeneration = () => {
        generationAbortController.abort()
    }

    req.on('aborted', abortGeneration)
    res.on('close', abortGeneration)

    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Transfer-Encoding', 'chunked')

    try {
        const callback = (response: MessageContent) => {
            if (generationAbortController.signal.aborted || res.writableEnded || res.destroyed) {
                return
            }

            res.write(JSON.stringify(response) + '\n')
        }

        await llmService.chatCompletion(body, callback, generationAbortController.signal)
        if (!res.writableEnded && !res.destroyed) {
            res.end()
        }
    } catch (error) {
        if (generationAbortController.signal.aborted) {
            if (!res.writableEnded && !res.destroyed) {
                res.end()
            }
            return
        }

        console.error('Error during LLM chat completion:', error)
        if (!res.headersSent) {
            res.status(500).json({
                error: `LLM chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
            })
            return
        }

        if (!res.writableEnded && !res.destroyed) {
            res.end()
        }
    } finally {
        req.off('aborted', abortGeneration)
        res.off('close', abortGeneration)
    }
})

// ===== Misc API endpoint =====

app.all('/api/*', (_req: Request, res: Response) => {
    console.warn('Received request for unknown API endpoint:', _req.originalUrl)
    res.status(404).json({ error: 'Not found' })
})

// Serve frontend
app.use(express.static(FRONTEND_DIST))

// Handle invalid routes
app.all('*', (_req: Request, res: Response) => {
    console.warn('Received request for unknown route:', _req.originalUrl)
    res.status(404).sendFile(join(FRONTEND_DIST, '404.html'))
})

// Start server
const PORT = parseInt(process.env['PORT'] || '8000', 10)
const HOST = process.env['HOST'] || '127.0.0.1'

httpServer.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`)
})
