import { type Database } from 'better-sqlite3'
import type { Uuid } from 'vertex-common'
import type { PersonaStore } from './PersonaStore.js'

export const CORE_FILE_NAMES = ['Soul', 'Instructions', 'Memories', 'Notes', 'Subconcious'] as const
export type CoreFileName = (typeof CORE_FILE_NAMES)[number]

// Files that contribute to the persona prompt, in prompt order. subconcious.md is intentionally excluded.
const PROMPT_FILE_NAMES: CoreFileName[] = ['Soul', 'Instructions', 'Memories', 'Notes']

interface CoreFileRow {
    content: string
}

export function isCoreFileName(name: string): name is CoreFileName {
    return (CORE_FILE_NAMES as readonly string[]).includes(name)
}

export class CoreFileStore {
    private readonly database: Database
    private readonly personaStore: PersonaStore

    constructor(database: Database, personaStore: PersonaStore) {
        this.database = database
        this.personaStore = personaStore
        this.initDatabase()
    }

    getFile(personaId: Uuid, name: CoreFileName): string {
        const row = this.database
            .prepare('SELECT content FROM persona_core_files WHERE persona_id = ? AND name = ?')
            .get(personaId, name) as CoreFileRow | undefined
        return row?.content ?? ''
    }

    listFiles(personaId: Uuid): Record<CoreFileName, string> {
        const files = {} as Record<CoreFileName, string>
        for (const name of CORE_FILE_NAMES) files[name] = this.getFile(personaId, name)
        return files
    }

    setFile(personaId: Uuid, name: CoreFileName, content: string): boolean {
        if (!this.personaStore.getPersona(personaId)) return false

        this.database
            .prepare(
                `INSERT INTO persona_core_files (persona_id, name, content, updated) VALUES (?, ?, ?, ?)
                 ON CONFLICT(persona_id, name) DO UPDATE SET content = excluded.content, updated = excluded.updated`,
            )
            .run(personaId, name, content, Date.now())

        if (PROMPT_FILE_NAMES.includes(name)) this.regeneratePrompt(personaId)
        return true
    }

    appendFile(personaId: Uuid, name: CoreFileName, content: string): boolean {
        const existing = this.getFile(personaId, name)
        const separator = existing && !existing.endsWith('\n') ? '\n' : ''
        return this.setFile(personaId, name, existing + separator + content)
    }

    regeneratePrompt(personaId: Uuid): boolean {
        const persona = this.personaStore.getPersona(personaId)
        if (!persona) return false

        const sections = PROMPT_FILE_NAMES.flatMap((name) => {
            const content = this.getFile(personaId, name).trim()
            return content ? [content.trim() + '\n\n'] : []
        })

        if (sections.length === 0) return true

        return this.personaStore.updatePersona(personaId, persona.name, sections.join('\n\n')) !== null
    }

    private initDatabase(): void {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS persona_core_files (
                persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                updated INTEGER NOT NULL,
                PRIMARY KEY (persona_id, name)
            );
        `)
    }
}
