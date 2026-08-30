import type { Persona, Uuid } from 'vertex-common'
import { fetchPersona, fetchAllPersonas } from '../api/PersonasAPI.js'

export class PersonaCache {
    private readonly personas: Map<Uuid, Persona | null> = new Map()

    async getPersona(id: Uuid): Promise<Persona | null> {
        if (!this.personas.has(id)) {
            try {
                const persona = await fetchPersona(id)
                this.personas.set(id, persona)
            } catch (error) {
                console.error(`Failed to fetch persona with id ${id}:`, error)
                this.personas.set(id, null) // Cache null to avoid repeated fetch attempts
            }
        }

        return this.personas.get(id) ?? null
    }

    async reloadAllPersonas(): Promise<void> {
        this.clearCache()

        try {
            const personas = await fetchAllPersonas()
            for (const persona of personas) {
                this.personas.set(persona.id, persona)
            }
        } catch (error) {
            console.error('Failed to fetch all personas:', error)
        }
    }

    clearCache(): void {
        this.personas.clear()
    }

    get list(): Readonly<Persona[]> {
        return Array.from(this.personas.values()).filter((persona): persona is Persona => persona !== null)
    }
}
