import type { Express, Request, Response } from 'express'
import express from 'express'
import { join } from 'path'

export function middleware(app: Express): void {
    app.use(express.json({ limit: '10mb' }))

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
}

export function publicHtml(app: Express, frontendDist: string): void {
    app.get('/api/health', async (_req: Request, res: Response) => {
        res.json({ status: 'ok' })
    })

    app.all('/api/*', (_req: Request, res: Response) => {
        console.warn('Received request for unknown API endpoint:', _req.originalUrl)
        res.status(404).json({ error: 'Not found' })
    })

    app.use(express.static(frontendDist))

    app.all('*', (_req: Request, res: Response) => {
        console.warn('Received request for unknown route:', _req.originalUrl)
        res.status(404).sendFile(join(frontendDist, '404.html'))
    })
}
