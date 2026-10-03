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

export async function deletePersona(personaId: Uuid): Promise<void> {
    const response = await fetch(`/api/personas/${personaId}`, {
        method: 'DELETE',
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to delete persona: ${errorResponse['error']}`)
    }
}

export const CORE_FILE_NAMES = ['Soul', 'Instructions', 'Memories', 'Notes', 'Subconcious'] as const
export type CoreFileName = (typeof CORE_FILE_NAMES)[number]

export async function fetchCoreFiles(personaId: Uuid): Promise<Record<CoreFileName, string>> {
    const response = await fetch(`/api/personas/${personaId}/core-files`)
    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to fetch core files: ${errorResponse['error']}`)
    }
    return (await response.json()) as Record<CoreFileName, string>
}

// Returns the persona, whose prompt may have been regenerated.
export async function updateCoreFile(personaId: Uuid, name: CoreFileName, content: string): Promise<Persona> {
    const response = await fetch(`/api/personas/${personaId}/core-files/${name}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to update core file: ${errorResponse['error']}`)
    }

    return (await response.json()) as Persona
}
