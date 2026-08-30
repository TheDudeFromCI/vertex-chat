import type { Persona, Uuid } from 'vertex-common'

export async function fetchPersona(uuid: Uuid): Promise<Persona> {
    const response = await fetch(`/api/personas/${uuid}`)
    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to fetch persona: ${errorResponse['error']}`)
    }
    const data = await response.json()
    return data as Persona
}

export async function fetchAllPersonas(): Promise<Persona[]> {
    const response = await fetch('/api/personas')
    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to fetch all personas: ${errorResponse['error']}`)
    }
    const data = await response.json()
    return data as Persona[]
}
