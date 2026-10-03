import { default as express } from 'express'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { default as Database } from 'better-sqlite3'

import { ConversationStore } from './services/ConversationStore.js'
import { PersonaStore } from './services/PersonaStore.js'
import { CoreFileStore } from './services/CoreFileStore.js'
import { publicHtml, middleware } from './endpoints/Standard.js'
import registerLLMEndpoint from './endpoints/LLMs.js'
import registerPersonasEndpoint from './endpoints/Personas.js'
import registerConversationsEndpoint from './endpoints/Conversations.js'
import registerMessagesEndpoint from './endpoints/Messages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..', '..', '..')
const FRONTEND_DIST = join(ROOT_DIR, 'frontend', 'dist')

const app = express()
const httpServer = createServer(app)

const dbPath = process.env['DATABASE_PATH'] || join(ROOT_DIR, 'database.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

const conversationStore = new ConversationStore(db)
const personaStore = new PersonaStore(db)
const coreFileStore = new CoreFileStore(db, personaStore)

middleware(app)
await registerLLMEndpoint(app, conversationStore, personaStore, coreFileStore)
registerPersonasEndpoint(app, personaStore, coreFileStore)
registerConversationsEndpoint(app, conversationStore)
registerMessagesEndpoint(app, conversationStore)
publicHtml(app, FRONTEND_DIST)

const PORT = parseInt(process.env['PORT'] || '8000', 10)
const HOST = process.env['HOST'] || '127.0.0.1'

httpServer.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`)
})
