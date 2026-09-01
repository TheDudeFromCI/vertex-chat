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

export async function createPersona(name: string, prompt: string): Promise<Persona> {
    const response = await fetch('/api/personas/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name,
            prompt,
        }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to create persona: ${errorResponse['error']}`)
    }

    const data = await response.json()
    return data as Persona
}

export async function updatePersona(personaId: Uuid, updates: { name?: string; prompt?: string }): Promise<Persona> {
    const response = await fetch(`/api/personas/${personaId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to update persona: ${errorResponse['error']}`)
    }

    const data = await response.json()
    return data as Persona
}

export async function setPersonaAvatar(personaId: Uuid, fileDataBase64: string): Promise<void> {
    const response = await fetch(`/api/personas/${personaId}/avatar`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            fileDataBase64,
        }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to update persona avatar: ${errorResponse['error']}`)
    }
}
