import type { Express, Request, Response } from 'express'
import type { Uuid } from 'vertex-common'
import type { PersonaStore } from '../services/PersonaStore.js'
import { type CoreFileStore } from '../services/CoreFileStore.js'

export default function register(app: Express, personaStore: PersonaStore, coreFileStore: CoreFileStore): void {
    app.get('/api/personas/:personaId/core-files', (req: Request, res: Response) => {
        const personaId = req.params['personaId'] as Uuid

        if (!personaStore.getPersona(personaId)) {
            res.status(404).json({ error: 'Persona not found' })
            return
        }

        res.json(coreFileStore.listFiles(personaId))
    })

    app.get('/api/personas/:personaId/core-files/:name', (req: Request, res: Response) => {
        const personaId = req.params['personaId'] as Uuid
        const name = req.params['name'] as string

        if (!personaStore.getPersona(personaId)) {
            res.status(404).json({ error: 'Persona not found' })
            return
        }

        const content = coreFileStore.getFile(personaId, name)
        if (content === undefined) {
            res.status(404).json({ error: 'Core file not found' })
            return
        }

        res.json({ content })
    })

    app.put('/api/personas/:personaId/core-files/:name', (req: Request, res: Response) => {
        const personaId = req.params['personaId'] as Uuid
        const name = req.params['name'] as string
        const content = req.body.content as unknown

        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Missing content' })
            return
        }

        if (!coreFileStore.setFile(personaId, name, content)) {
            res.status(404).json({ error: 'Persona not found' })
            return
        }

        res.json({ message: 'Core file updated' })
    })
    app.get('/api/personas', (_req: Request, res: Response) => {
        console.log('Received request to list personas')
        res.json(personaStore.listPersonas())
    })

    app.get('/api/personas/:personaId', (req: Request, res: Response) => {
        const personaId = req.params['personaId'] as Uuid
        console.log('Received request to get persona with ID:', req.params['personaId'])

        const persona = personaStore.getPersona(personaId)

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

        const persona = personaStore.createPersona(name, prompt)
        res.json(persona)
    })

    app.patch('/api/personas/:personaId', (req: Request, res: Response) => {
        const personaId = req.params['personaId'] as Uuid
        console.log('Received request to update persona with ID:', personaId)

        const existingPersona = personaStore.getPersona(personaId)

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

        const updatedPersona = personaStore.updatePersona(
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
            const saved = await personaStore.setProfilePicture(personaId, fileDataBase64)
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

        const picture = personaStore.getProfilePicture(personaId)

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

        const removed = personaStore.removeProfilePicture(personaId)

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

        const success = personaStore.deletePersona(personaId)

        if (!success) {
            console.warn('Failed to delete persona with ID:', personaId)
            res.status(404).json({ error: 'Persona not found' })
            return
        }

        res.json({ message: 'Persona deleted' })
    })
}
