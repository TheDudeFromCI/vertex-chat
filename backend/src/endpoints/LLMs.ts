import type { Express, Request, Response } from 'express'
import { LLMService } from '../services/LLMService.js'
import timeTool from '../tools/Time.js'
import { buildFileTools, parseAllowedDirectories } from '../tools/FileSystem.js'
import type { ChatCompletionRequest, StreamedLLMEvent } from 'vertex-common'
import { buildConversationTools } from '../tools/Conversation.js'
import { buildSubagentTool } from '../tools/Subagent.js'
import type { ConversationStore } from '../services/ConversationStore.js'
import type { PersonaStore } from '../services/PersonaStore.js'

export default async function register(
    app: Express,
    conversationStore: ConversationStore,
    personaStore: PersonaStore,
): Promise<void> {
    const llmService = await LLMService.initClient({
        apiKey: process.env['OPENAI_API_KEY'] ?? 'no-key',
        baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1',
        timeout: parseInt(process.env['OPENAI_TIMEOUT'] || '300000', 10),
        model: process.env['OPENAI_DEFAULT_MODEL'] ?? 'model',
    })

    llmService.maxTokens = parseInt(process.env['OPENAI_MAX_TOKENS'] || '256000', 10)
    llmService.maxOutputTokens = parseInt(process.env['OPENAI_MAX_OUTPUT_TOKENS'] || '128000', 10)

    const pendingToolPermissionRequests = new Map<
        string,
        {
            resolve: (allowed: boolean) => void
            reject: (error: Error) => void
        }
    >()

    llmService.setToolPermissionHandler(async (request, signal) => {
        return await new Promise<boolean>((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Request aborted', 'AbortError'))
                return
            }

            const onAbort = () => {
                pendingToolPermissionRequests.delete(request.requestId)
                reject(new DOMException('Request aborted', 'AbortError'))
            }

            signal?.addEventListener('abort', onAbort, { once: true })

            pendingToolPermissionRequests.set(request.requestId, {
                resolve: (allowed: boolean) => {
                    signal?.removeEventListener('abort', onAbort)
                    resolve(allowed)
                },
                reject: (error: Error) => {
                    signal?.removeEventListener('abort', onAbort)
                    reject(error)
                },
            })
        })
    })

    // Register Tools
    const allowedDirectories = parseAllowedDirectories(process.env['DIRECTORIES'])
    const fileTools = buildFileTools(allowedDirectories)
    llmService.registerTool(timeTool)
    llmService.registerTool(fileTools.baseDirectories)
    llmService.registerTool(fileTools.listDirectory)
    llmService.registerTool(fileTools.readFile)
    llmService.registerTool(fileTools.createFile)
    llmService.registerTool(fileTools.updateFile)
    llmService.registerTool(fileTools.deleteFile)
    llmService.registerTool(fileTools.createFolder)
    llmService.registerTool(fileTools.renameFile)

    const conversationTools = buildConversationTools(conversationStore, personaStore)
    llmService.registerTool(conversationTools.renameConversation)
    llmService.registerTool(conversationTools.conversationName)
    llmService.registerTool(conversationTools.participants)
    llmService.registerTool(conversationTools.avatar)

    const subagentTool = buildSubagentTool(llmService, conversationStore, personaStore)
    llmService.registerTool(subagentTool)

    app.post('/api/llm/chat', async (req: Request, res: Response) => {
        const body = req.body as ChatCompletionRequest
        console.log('Received request for LLM chat completion with messages:', body)

        const generationAbortController = new AbortController()
        const abortGeneration = () => {
            generationAbortController.abort()
        }

        req.on('aborted', abortGeneration)
        res.on('close', abortGeneration)

        res.setHeader('Content-Type', 'application/x-ndjson')
        res.setHeader('Transfer-Encoding', 'chunked')

        try {
            const callback = (response: StreamedLLMEvent) => {
                if (generationAbortController.signal.aborted || res.writableEnded || res.destroyed) {
                    return
                }

                res.write(JSON.stringify(response) + '\n')
            }

            const full = await llmService.chatCompletion(body, callback, generationAbortController.signal)
            if (!res.writableEnded && !res.destroyed) {
                res.write(JSON.stringify(full) + '\n')
                res.end()
            }
        } catch (error) {
            if (generationAbortController.signal.aborted) {
                if (!res.writableEnded && !res.destroyed) {
                    res.end()
                }
                return
            }

            console.error('Error during LLM chat completion:', error)
            if (!res.headersSent) {
                res.status(500).json({
                    error: `LLM chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
                })
                return
            }

            if (!res.writableEnded && !res.destroyed) {
                res.end()
            }
        } finally {
            req.off('aborted', abortGeneration)
            res.off('close', abortGeneration)
        }
    })

    app.get('/api/llm/context-window', (_req: Request, res: Response) => {
        res.json({ contextTokens: llmService.contextBudget })
    })

    app.post('/api/llm/tool-permission', (req: Request, res: Response) => {
        const requestId = req.body.requestId as string | undefined
        const allowed = req.body.allowed as boolean | undefined

        if (!requestId || allowed === undefined) {
            res.status(400).json({ error: 'Missing requestId or allowed' })
            return
        }

        const pending = pendingToolPermissionRequests.get(requestId)
        if (!pending) {
            res.status(404).json({ error: 'Permission request not found or already resolved' })
            return
        }

        pendingToolPermissionRequests.delete(requestId)
        pending.resolve(allowed)

        res.json({ message: 'Permission decision accepted' })
    })
}
