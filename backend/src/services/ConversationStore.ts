import { type Database } from 'better-sqlite3'

import { generateUuid } from '../Utils.js'
import type { Message, Conversation, Workspace, ConversationIndexEntry, Uuid, MessageContent } from 'vertex-common'

interface WorkspaceRow {
    id: Uuid
    name: string
    metadata: string
}

interface ConversationRow {
    id: Uuid
    workspaceId: Uuid
    name: string
    createdAt: number
    updatedAt: number
    participants: string
    metadata: string
}

interface MessageRow {
    id: Uuid
    conversationId: Uuid
    sender: Uuid
    timestamp: number
    content: string
    edited: number
    metadata: string
}

export class ConversationStore {
    private readonly database: Database

    constructor(db: Database) {
        this.database = db
        this.initDatabase()
    }

    listWorkspaces(): ReadonlyArray<Readonly<Workspace>> {
        const getConversations = this.database.prepare('SELECT * FROM conversations WHERE workspaceId = ?')
        const rows = this.database.prepare('SELECT * FROM workspaces').all() as WorkspaceRow[]

        let workspaces = []

        for (const row of rows) {
            const workspace: Workspace = {
                id: row.id,
                name: row.name,
                conversationEntries: [],
                metadata: JSON.parse(row.metadata),
            }
            workspaces.push(workspace)

            const conversations = getConversations.all(row.id) as ConversationRow[]
            for (const conversation of conversations) {
                const conversationIndexEntry: ConversationIndexEntry = {
                    conversationId: conversation.id,
                    workspaceId: row.id,
                    name: conversation.name,
                    createdAt: conversation.createdAt,
                    updatedAt: conversation.updatedAt,
                }
                workspace.conversationEntries = workspace.conversationEntries || []
                workspace.conversationEntries.push(conversationIndexEntry)
            }
        }

        return workspaces
    }

    createWorkspace(name: string, metadata: Record<string, unknown> = {}): Readonly<Workspace> {
        const id = generateUuid()
        this.database
            .prepare('INSERT INTO workspaces (id, name, metadata) VALUES (?, ?, ?)')
            .run(id, name, JSON.stringify(metadata))

        return Object.freeze({
            id,
            name,
            conversationEntries: [],
            metadata,
        })
    }

    renameConversation(conversationId: Uuid, newName: string): boolean {
        const result = this.database
            .prepare('UPDATE conversations SET name = ?, updatedAt = ? WHERE id = ?')
            .run(newName, Date.now(), conversationId)
        return result.changes > 0
    }

    updateConversationParticipants(conversationId: Uuid, participants: Uuid[]): boolean {
        const result = this.database
            .prepare('UPDATE conversations SET participants = ?, updatedAt = ? WHERE id = ?')
            .run(JSON.stringify(participants), Date.now(), conversationId)
        return result.changes > 0
    }

    renameWorkspace(workspaceId: Uuid, newName: string): boolean {
        const result = this.database.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(newName, workspaceId)
        return result.changes > 0
    }

    getWorkspace(workspaceId: Uuid): Readonly<Workspace> | null {
        const row = this.database.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as
            | WorkspaceRow
            | undefined

        if (!row) {
            return null
        }

        const workspace: Workspace = {
            id: row.id,
            name: row.name,
            conversationEntries: [],
            metadata: JSON.parse(row.metadata),
        }

        const conversations = this.database
            .prepare('SELECT * FROM conversations WHERE workspaceId = ?')
            .all(workspaceId) as ConversationRow[]

        for (const conversation of conversations) {
            const conversationIndexEntry: ConversationIndexEntry = {
                conversationId: conversation.id,
                workspaceId: workspaceId,
                name: conversation.name,
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
            }
            workspace.conversationEntries.push(conversationIndexEntry)
        }

        return Object.freeze(workspace)
    }

    deleteWorkspace(workspaceId: Uuid): boolean {
        this.database
            .prepare(
                `DELETE FROM messages WHERE conversationId
                 IN (SELECT id FROM conversations WHERE workspaceId = ?)`,
            )
            .run(workspaceId)
        this.database.prepare(`DELETE FROM conversations WHERE workspaceId = ?`).run(workspaceId)
        const result = this.database.prepare(`DELETE FROM workspaces WHERE id = ?`).run(workspaceId)
        return result.changes > 0
    }

    deleteConversation(conversationId: Uuid): boolean {
        this.database.prepare(`DELETE FROM messages WHERE conversationId = ?`).run(conversationId)
        const result = this.database.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId)
        return result.changes > 0
    }

    getConversation(conversationId: Uuid): Readonly<Conversation> | null {
        const conversationRow = this.database
            .prepare('SELECT * FROM conversations WHERE id = ?')
            .get(conversationId) as ConversationRow | undefined

        if (!conversationRow) {
            return null
        }

        const messages = this.database
            .prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC')
            .all(conversationId) as MessageRow[]

        const conversation: Conversation = {
            id: conversationRow.id,
            name: conversationRow.name,
            participants: JSON.parse(conversationRow.participants),
            messages: messages.map((msg) => ({
                id: msg.id,
                conversationId: msg.conversationId,
                sender: msg.sender,
                timestamp: msg.timestamp,
                content: JSON.parse(msg.content) as MessageContent,
                edited: msg.edited !== 0,
                metadata: JSON.parse(msg.metadata),
            })),
            createdAt: conversationRow.createdAt,
            updatedAt: conversationRow.updatedAt,
            metadata: JSON.parse(conversationRow.metadata),
        }

        return Object.freeze(conversation)
    }

    createConversation(workspaceId: Uuid, name: string): Readonly<Conversation> {
        const id = generateUuid()
        const timestamp = Date.now()

        this.database
            .prepare(
                `INSERT INTO conversations (id, workspaceId, name, participants, createdAt, updatedAt, metadata)
                 VALUES (:id, :workspaceId, :name, :participants, :createdAt, :updatedAt, :metadata)`,
            )
            .run({
                id,
                workspaceId,
                name,
                participants: '[]',
                createdAt: timestamp,
                updatedAt: timestamp,
                metadata: '{}',
            })

        return Object.freeze({
            id,
            name,
            participants: [],
            messages: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            metadata: {},
        })
    }

    deleteMessage(messageId: Uuid): boolean {
        const result = this.database.prepare('DELETE FROM messages WHERE id = ?').run(messageId)
        return result.changes > 0
    }

    appendMessage(
        conversationId: Uuid,
        sender: Uuid,
        content: MessageContent,
        metadata: Record<string, unknown> = {},
    ): Readonly<Message> {
        const id = generateUuid()
        const timestamp = Date.now()

        this.database
            .prepare(
                `INSERT INTO messages (id, conversationId, sender, timestamp, content, edited, metadata)
                 VALUES (:id, :conversationId, :sender, :timestamp, :content, 0, :metadata)`,
            )
            .run({
                id,
                conversationId,
                sender,
                timestamp,
                content: JSON.stringify(content),
                edited: 0,
                metadata: JSON.stringify(metadata),
            })

        return Object.freeze({
            id,
            conversationId,
            sender,
            timestamp,
            content,
            edited: false,
            metadata,
        })
    }

    updateMessage(messageId: Uuid, content?: MessageContent, metadata?: Record<string, unknown>): boolean {
        let success = true

        if (content) {
            success &&=
                this.database
                    .prepare(`UPDATE messages SET content = ?, edited = 1 WHERE id = ?`)
                    .run(JSON.stringify(content), messageId).changes > 0
        }

        if (metadata) {
            success &&=
                this.database
                    .prepare(`UPDATE messages SET metadata = ? WHERE id = ?`)
                    .run(JSON.stringify(metadata), messageId).changes > 0
        }

        return success
    }

    getMessage(messageId: Uuid): Readonly<Message> | null {
        const messageRow = this.database.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as
            | MessageRow
            | undefined

        if (!messageRow) {
            return null
        }

        const message: Message = {
            id: messageRow.id,
            conversationId: messageRow.conversationId,
            sender: messageRow.sender,
            timestamp: messageRow.timestamp,
            content: JSON.parse(messageRow.content) as MessageContent,
            edited: messageRow.edited !== 0,
            metadata: JSON.parse(messageRow.metadata),
        }

        return Object.freeze(message)
    }

    private initDatabase(): void {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                workspaceId TEXT NOT NULL REFERENCES workspaces(id),
                name TEXT NOT NULL,
                participants TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversationId TEXT NOT NULL REFERENCES conversations(id),
                sender TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                content TEXT NOT NULL,
                edited INTEGER NOT NULL,
                metadata TEXT NOT NULL
            );
        `)
    }
}
