import { type Database } from 'better-sqlite3'
import { Jimp, ResizeStrategy } from 'jimp'
import type { Persona, PersonaProfilePicture, Uuid } from 'vertex-common'
import { generateUuid } from '../Utils.js'

interface PersonaRow {
    id: Uuid
    name: string
    prompt: string
    created: number
    updated: number
}

interface AvatarRow {
    avatar: Buffer
}

export class PersonaStore {
    private readonly database: Database

    constructor(database: Database) {
        this.database = database
        this.initDatabase()
    }

    listPersonas(): Persona[] {
        const statement = this.database.prepare(
            'SELECT id, name, prompt, created, updated, COALESCE(length(avatar), 0) > 0 AS has_avatar FROM personas',
        )
        const rows = statement.all() as (PersonaRow & { has_avatar: boolean })[]
        return rows.map((row) => ({
            ...row,
            avatarUrl: row.has_avatar ? `/api/personas/${row.id}/avatar` : null,
        }))
    }

    getPersona(id: Uuid): Persona | null {
        const statement = this.database.prepare(
            'SELECT id, name, prompt, created, updated, COALESCE(length(avatar), 0) > 0 AS has_avatar FROM personas WHERE id = ?',
        )
        const row = statement.get(id) as (PersonaRow & { has_avatar: boolean }) | undefined
        return row ? { ...row, avatarUrl: row.has_avatar ? `/api/personas/${row.id}/avatar` : null } : null
    }

    createPersona(name: string, prompt?: string): Persona {
        const timestamp = Date.now()

        const persona = {
            id: generateUuid(),
            name,
            prompt: prompt ?? `You are ${name}, a helpful assistant.`,
            created: timestamp,
            updated: timestamp,
        }

        this.database
            .prepare('INSERT INTO personas (id, name, prompt, created, updated) VALUES (?, ?, ?, ?, ?)')
            .run(persona.id, persona.name, persona.prompt, persona.created, persona.updated)

        return { ...persona, avatarUrl: null }
    }

    deletePersona(id: Uuid): boolean {
        const statement = this.database.prepare('DELETE FROM personas WHERE id = ?')
        const result = statement.run(id)
        return result.changes > 0
    }

    updatePersona(id: Uuid, name: string, prompt: string): Persona | null {
        const timestamp = Date.now()

        const statement = this.database.prepare('UPDATE personas SET name = ?, prompt = ?, updated = ? WHERE id = ?')
        const result = statement.run(name, prompt, timestamp, id)

        if (result.changes === 0) {
            return null
        }

        return this.getPersona(id)
    }

    async setProfilePicture(personaId: Uuid, base64: string): Promise<boolean> {
        const buffer = decodeBase64Image(base64)
        if (!buffer) {
            throw new Error('Invalid base64 image data')
        }

        const image = await Jimp.fromBuffer(buffer)
        await image.contain({
            w: 256,
            h: 256,
            mode: ResizeStrategy.BILINEAR,
        })

        const pngBuffer = await image.getBuffer('image/png')
        const timestamp = Date.now()

        const result = this.database
            .prepare(`UPDATE personas SET avatar = ?, updated = ? WHERE id = ?`)
            .run(pngBuffer, timestamp, personaId)

        return result.changes > 0
    }

    getProfilePicture(personaId: Uuid): PersonaProfilePicture | null {
        const row = this.database.prepare('SELECT avatar FROM personas WHERE id = ?').get(personaId) as
            | AvatarRow
            | undefined

        if (!row || !row.avatar || row.avatar.length === 0) {
            return null
        }

        return {
            data: row.avatar,
            mimeType: 'image/png',
        }
    }

    removeProfilePicture(personaId: Uuid): boolean {
        const result = this.database
            .prepare('UPDATE personas SET avatar = NULL, updated = ? WHERE id = ?')
            .run(Date.now(), personaId)
        return result.changes > 0
    }

    private initDatabase(): void {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS personas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                created INTEGER NOT NULL,
                updated INTEGER NOT NULL,
                avatar BLOB
            );
        `)
    }
}

function decodeBase64Image(base64Data: string): Buffer | null {
    try {
        const trimmed = base64Data.trim()
        const payload = trimmed.startsWith('data:') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed
        return Buffer.from(payload, 'base64')
    } catch {
        return null
    }
}
