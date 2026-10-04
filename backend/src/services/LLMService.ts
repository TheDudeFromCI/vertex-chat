import type {
    ChatCompletionRequest,
    MessageContent,
    MessageContentBlockType,
    StreamedLLMEvent,
    ToolExecutionContext,
    ToolPermissionRequest,
} from 'vertex-common'
import { randomUUID } from 'crypto'
import { FetchLLMConnection, type LLMConnection, type LLMPreparedRequest } from './LLMConnection.js'

export interface LLMServiceOptions {
    apiKey: string
    baseUrl: string
    timeout: number
    model: string
}

export interface Tool {
    name: string
    description: string
    params: ToolParam[]
    needsPermission: boolean
    execute: (args: Record<string, unknown>, context: ToolExecutionContext, callbacks?: ToolCallback) => Promise<string>
}

export type ToolCallback = (event: StreamedLLMEvent) => void

export interface ToolParam {
    name: string
    type: string
    description: string
    required: boolean
}

export type ChatStreamCallback = (response: StreamedLLMEvent) => void
export type ToolPermissionHandler = (request: ToolPermissionRequest, signal?: AbortSignal) => Promise<boolean>

const MAX_REQUEST_RETRIES = 2
const MAX_TOOL_PARSE_FAILURES = 3

const isAbortError = (error: unknown): boolean => {
    return error instanceof DOMException && error.name === 'AbortError'
}

const isValidJson = (text: string): boolean => {
    try {
        JSON.parse(text)
        return true
    } catch {
        return false
    }
}

export class LLMService {
    private readonly model: string
    private readonly connection: LLMConnection
    private readonly tools: Tool[] = []
    private permissionHandler: ToolPermissionHandler | null = null
    public temperature: number | null = null
    public maxTokens: number
    public maxOutputTokens: number

    static async initClient(options: LLMServiceOptions): Promise<LLMService> {
        const connection = new FetchLLMConnection(options)
        const llm = new LLMService(connection, { model: options.model })

        const modelNames = await llm.fetchModels()
        const modelExists = modelNames.includes(options.model)

        console.log('LLMService client initialized with baseUrl:', options.baseUrl)
        console.log('Available models:', modelNames.join(', '))
        if (!modelExists) {
            console.warn(`Warning: Model "${options.model}" not found in available models.`)
        }

        return llm
    }

    constructor(connection: LLMConnection, options: { model: string }) {
        this.connection = connection
        this.model = options.model
        this.maxTokens = Number.MAX_SAFE_INTEGER
        this.maxOutputTokens = Number.MAX_SAFE_INTEGER * 0.2
    }

    registerTool(tool: Tool): void {
        this.tools.push(tool)
    }

    setToolPermissionHandler(handler: ToolPermissionHandler): void {
        this.permissionHandler = handler
    }

    async chatCompletion(
        request: ChatCompletionRequest,
        callback?: ChatStreamCallback,
        signal?: AbortSignal,
    ): Promise<MessageContent> {
        const response: MessageContent = []

        interface ToolBuffer {
            name: string
            args: string
        }

        // Model stream chunks are one token each; locally produced text is estimated.
        const appendFragment = (
            fragment: string,
            type: MessageContentBlockType,
            tokens: number = Math.ceil(fragment.length / 4),
        ) => {
            // Each tool response is a self-contained block (merging would corrupt JSON).
            if (!type.startsWith('tool_response') && response.at(-1)?.type === type) {
                const block = response.at(-1)!
                block.content += fragment
            } else {
                response.push({
                    type: type,
                    content: fragment,
                })
            }

            if (callback) {
                callback({
                    type: type,
                    delta: fragment,
                    tokens,
                })
            }
        }

        let parseFailures = 0
        let abandon = false

        outerLoop: while (true) {
            if (signal?.aborted) {
                throw new DOMException('Request aborted', 'AbortError')
            }

            let stream: Response
            try {
                stream = await this.openStream(request, callback, signal)
            } catch (error) {
                if (isAbortError(error) || response.length === 0) throw error
                console.error('Unrecoverable provider error, returning partial response:', error)
                break
            }

            const reader = stream.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            let toolBuffers: ToolBuffer[] = []
            const turnStart = response.length

            while (true) {
                if (signal?.aborted) {
                    throw new DOMException('Request aborted', 'AbortError')
                }

                let value: Uint8Array | undefined
                let done: boolean
                try {
                    ;({ value, done } = await reader.read())
                } catch (error) {
                    if (isAbortError(error) || signal?.aborted) throw error
                    console.error('Stream read failed, keeping partial response:', error)
                    break
                }
                if (done) break

                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop()!

                for (let line of lines) {
                    line = line.trim()
                    if (line.startsWith('data: ')) line = line.slice(6)
                    if (line === '') continue
                    if (line === '[DONE]') break

                    let data: any
                    try {
                        data = JSON.parse(line)
                    } catch (error) {
                        console.error('Skipping malformed stream chunk:', line, error)
                        continue
                    }
                    if (!data['choices'] || !data['choices'][0]) {
                        console.error('Invalid response format:', data)
                        continue
                    }

                    const thinkingFragment = data['choices'][0]['delta']['reasoning_content'] || ''
                    if (thinkingFragment) appendFragment(thinkingFragment, 'thinking', 1)

                    const fragment = data['choices'][0]['delta']['content'] || ''
                    if (fragment) appendFragment(fragment, 'text', 1)

                    const tools = data['choices'][0]['delta']['tool_calls'] || []
                    for (const tool of tools) {
                        const index = tool['index']
                        if (!toolBuffers[index]) {
                            toolBuffers[index] = {
                                name: '',
                                args: '',
                            }
                        }

                        const toolName = tool['function']['name'] || null
                        const toolArgs = tool['function']['arguments'] || ''
                        if (toolName) toolBuffers[index]!.name = toolName
                        toolBuffers[index]!.args += toolArgs
                    }

                    const stopReason = data['choices'][0]['finish_reason'] || null

                    if (stopReason === 'tool_calls') {
                        const completedCalls = toolBuffers.filter(Boolean)
                        if (completedCalls.length === 0) {
                            continue
                        }

                        const callIds = completedCalls.map((c) => `${c.name}_${randomUUID()}`)
                        const turnBlocks = response.slice(turnStart)
                        const joinBlocks = (type: MessageContentBlockType) =>
                            turnBlocks
                                .filter((b) => b.type === type)
                                .map((b) => b.content)
                                .join('')
                        // The tool messages below are only valid after the assistant turn that requested them.
                        request.messages.push({
                            role: 'assistant',
                            content: joinBlocks('text'),
                            thinking: joinBlocks('thinking') || null,
                            tool_calls: completedCalls.map((c, i) => ({
                                id: callIds[i]!,
                                type: 'function',
                                function: { name: c.name, arguments: isValidJson(c.args) ? c.args : '{}' },
                            })),
                        })

                        for (const [callIndex, toolBuffer] of completedCalls.entries()) {
                            try {
                                const argsJson = JSON.parse(toolBuffer.args)
                                parseFailures = 0
                                const toolName = toolBuffer.name
                                const toolCallId = callIds[callIndex]!
                                appendFragment(JSON.stringify({ tool: toolName, args: argsJson }, null, 2), 'tool_call')

                                try {
                                    const tool = this.tools.find((t) => t.name === toolName)
                                    if (!tool) {
                                        throw new Error(`Tool "${toolName}" not found.`)
                                    }

                                    if (tool.needsPermission) {
                                        const permissionRequest: ToolPermissionRequest = {
                                            type: 'tool_permission_request',
                                            requestId: randomUUID(),
                                            toolName,
                                            args: argsJson,
                                        }

                                        callback?.(permissionRequest)

                                        const allowed = await this.requestPermission(permissionRequest, signal)
                                        if (!allowed) {
                                            const deniedMessage = `Permission denied by user for tool "${toolName}".`
                                            request.messages.push({
                                                role: 'tool',
                                                tool_call_id: toolCallId,
                                                content: deniedMessage,
                                            })
                                            appendFragment(deniedMessage, 'tool_response_text')
                                            continue
                                        }
                                    }

                                    const toolResult = await this.executeToolCall(
                                        toolName,
                                        argsJson,
                                        request.toolContext,
                                        (event: StreamedLLMEvent) => callback?.(event),
                                    )

                                    const parsedToolResult = this.parseStructuredToolResult(toolResult)
                                    if (parsedToolResult) {
                                        const toolMessageContent: any[] = []
                                        if (parsedToolResult.type === 'image') {
                                            toolMessageContent.push({
                                                type: 'image_url',
                                                image_url: {
                                                    url: parsedToolResult.content,
                                                },
                                            })
                                            toolMessageContent.push({
                                                type: 'text',
                                                text: `Tool read image: ${parsedToolResult.name ?? 'image'}`,
                                            })
                                        } else if (parsedToolResult.type === 'file_attachment') {
                                            toolMessageContent.push({
                                                type: 'text',
                                                text: `Tool read file: ${parsedToolResult.name ?? 'file'}`,
                                            })
                                            toolMessageContent.push({
                                                type: 'file',
                                                file: {
                                                    filename: parsedToolResult.name ?? 'file',
                                                    file_data: parsedToolResult.content,
                                                },
                                            })
                                        } else {
                                            toolMessageContent.push({
                                                type: 'text',
                                                text:
                                                    parsedToolResult.type === 'markdown' ||
                                                    parsedToolResult.type === 'text'
                                                        ? parsedToolResult.content
                                                        : toolResult,
                                            })
                                        }

                                        request.messages.push({
                                            role: 'tool',
                                            tool_call_id: toolCallId,
                                            content: toolMessageContent,
                                        })
                                        if (parsedToolResult.type === 'markdown' || parsedToolResult.type === 'text') {
                                            appendFragment(
                                                parsedToolResult.content,
                                                parsedToolResult.type === 'markdown'
                                                    ? 'tool_response_md'
                                                    : 'tool_response_text',
                                            )
                                        } else {
                                            appendFragment(
                                                `Tool result: ${parsedToolResult.name ?? 'response'}`,
                                                'tool_response_text',
                                            )
                                        }
                                        if (parsedToolResult.type === 'image') {
                                            response.push({
                                                type: 'image',
                                                content: parsedToolResult.content,
                                                name: parsedToolResult.name ?? 'image',
                                            })
                                        }
                                    } else {
                                        request.messages.push({
                                            role: 'tool',
                                            tool_call_id: toolCallId,
                                            content: toolResult,
                                        })
                                        appendFragment(toolResult, this.classifyToolOutput(toolResult))
                                    }
                                } catch (error) {
                                    console.error('Failed to execute tool call:', error)
                                    const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                                    request.messages.push({
                                        role: 'tool',
                                        tool_call_id: toolCallId,
                                        content: errorMessage,
                                    })
                                    appendFragment(errorMessage, 'tool_response_text')
                                }
                            } catch (error) {
                                console.error('Failed to parse tool arguments JSON:', error)
                                parseFailures++
                                if (parseFailures <= MAX_TOOL_PARSE_FAILURES) {
                                    // Tell the model so it can retry with valid JSON.
                                    const errorMessage = `Error: invalid JSON arguments for tool "${toolBuffer.name}". Please retry with valid JSON.`
                                    request.messages.push({
                                        role: 'tool',
                                        tool_call_id: callIds[callIndex]!,
                                        content: errorMessage,
                                    })
                                    appendFragment(errorMessage, 'tool_response_text')
                                } else {
                                    abandon = true
                                }
                            }
                        }

                        toolBuffers = []
                        if (abandon) break outerLoop
                        continue outerLoop
                    }
                }
            }

            break
        }

        console.log('LLMService chat completion finished. Total response length:', response.length)
        console.log('Response:', JSON.stringify(response, null, 2))

        return response
    }

    private async openStream(
        request: ChatCompletionRequest,
        callback?: ChatStreamCallback,
        signal?: AbortSignal,
    ): Promise<Response> {
        let lastError: unknown

        for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt++) {
            if (signal?.aborted) {
                throw new DOMException('Request aborted', 'AbortError')
            }

            try {
                let optimizedRequest = request
                let counts: { totalTokens: number; truncatedTokens: number } | null = null
                try {
                    const optimized = await this.optimizeTokenCount(request, signal)
                    optimizedRequest = optimized.request
                    counts = optimized
                } catch (error) {
                    if (isAbortError(error)) throw error
                    console.error('Token optimization failed, sending request unoptimized:', error)
                }

                const preparedRequest = await this.prepareRequest(optimizedRequest)
                const stream = await this.connection.createChatCompletion(preparedRequest, signal)

                if (stream.ok && stream.body) {
                    if (counts && callback) {
                        const promptTokens = await this.countPromptTokens(request, signal).catch(() => 0)
                        callback({ type: 'begin_llm_generation', promptTokens, ...counts })
                    }
                    return stream
                }

                const errorResponse = await stream.json().catch(() => null)
                lastError = new Error(
                    `Provider returned ${stream.status}: ${JSON.stringify(errorResponse?.['error'] ?? errorResponse)}`,
                )
            } catch (error) {
                if (isAbortError(error)) throw error
                lastError = error
            }

            console.error(`Chat completion attempt ${attempt + 1} failed:`, lastError)
        }

        throw lastError instanceof Error ? lastError : new Error('Failed to initiate chat completion')
    }

    private async optimizeTokenCount(
        request: ChatCompletionRequest,
        signal?: AbortSignal,
    ): Promise<{ request: ChatCompletionRequest; totalTokens: number; truncatedTokens: number }> {
        const budget = this.maxTokens - this.maxOutputTokens

        if (budget <= 0) {
            throw new Error('Token budget is non-positive. Cannot optimize token count.')
        }

        if (request.messages.length === 0) {
            const promptTokens = await this.countPromptTokens(request, signal)
            return { request, totalTokens: promptTokens, truncatedTokens: promptTokens }
        }

        const countTokensForSuffix = async (suffixLength: number): Promise<number> => {
            const start = Math.max(0, request.messages.length - suffixLength)
            return await this.countTokens(
                {
                    messages: request.messages.slice(start),
                    prompt: request.prompt,
                    toolContext: request.toolContext,
                },
                signal,
            )
        }

        try {
            const totalTokens = await countTokensForSuffix(request.messages.length)
            if (totalTokens <= budget) {
                return { request, totalTokens, truncatedTokens: totalTokens }
            }

            // Invariant: low fits, high does not fit.
            let low = 0
            let lowTokens = await this.countPromptTokens(request, signal)
            let high = request.messages.length

            while (high - low > 1) {
                const mid = low + Math.floor((high - low) / 2)
                const midTokens = await countTokensForSuffix(mid)

                if (midTokens <= budget) {
                    low = mid
                    lowTokens = midTokens
                } else {
                    high = mid
                }
            }

            return {
                request: {
                    prompt: request.prompt,
                    messages: request.messages.slice(request.messages.length - low),
                    toolContext: request.toolContext,
                },
                totalTokens,
                truncatedTokens: lowTokens,
            }
        } catch (error) {
            if (isAbortError(error)) {
                throw error
            }

            console.error('Failed to get token count from LLMService:', error)
            throw new Error('Failed to get token count from LLMService: ' + error)
        }
    }

    private async fetchModels(): Promise<string[]> {
        return await this.connection.listModels()
    }

    get contextBudget(): number {
        return this.maxTokens - this.maxOutputTokens
    }

    private async countPromptTokens(request: ChatCompletionRequest, signal?: AbortSignal): Promise<number> {
        const preparedRequest = await this.prepareRequest({ ...request, messages: [] })
        return await this.connection.countInputTokens(preparedRequest, signal)
    }

    private async countTokens(request: ChatCompletionRequest, signal?: AbortSignal): Promise<number> {
        if (request.messages.length === 0) {
            return 0
        }

        const preparedRequest = await this.prepareRequest(request)
        return await this.connection.countInputTokens(preparedRequest, signal)
    }

    async prepareRequest(request: ChatCompletionRequest): Promise<LLMPreparedRequest> {
        const messages = []

        if (request.prompt) {
            messages.push({
                role: 'system',
                content: request.prompt,
            })
        }

        for (const message of request.messages) {
            if (message.role === 'assistant') {
                const assistantMessage: any = {
                    role: message.role,
                    content: message.content,
                }

                if (message.thinking) {
                    assistantMessage.thinking = message.thinking
                }
                if (message.tool_calls?.length) {
                    assistantMessage.tool_calls = message.tool_calls
                }

                messages.push(assistantMessage)
                continue
            }

            if (message.role === 'tool') {
                messages.push({
                    role: message.role,
                    tool_call_id: message.tool_call_id,
                    content: message.content,
                })
                continue
            }

            if (Array.isArray(message.content)) {
                messages.push({
                    role: message.role,
                    content: message.content.map((part) => {
                        if (part.type === 'image_url') {
                            return {
                                type: 'image_url',
                                image_url: {
                                    url: part.image_url.url,
                                },
                            }
                        }

                        if (part.type === 'file') {
                            return {
                                type: 'text',
                                text: `Attached file: ${part.file.filename ?? 'unnamed'}\n\`\`\`${part.file.file_data}\`\`\``,
                            }
                        }

                        return {
                            type: 'text',
                            text: part.text,
                        }
                    }),
                })
            } else {
                messages.push({
                    role: message.role,
                    content: message.content,
                })
            }
        }

        const tools = this.tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    required: tool.params.filter((param) => param.required).map((param) => param.name),
                    properties: tool.params.reduce((acc: Record<string, any>, param) => {
                        acc[param.name] = {
                            type: param.type,
                            description: param.description,
                        }
                        return acc
                    }, {}),
                },
            },
        }))

        return {
            model: this.model,
            messages,
            tools,
            stream: true,
            temperature: this.temperature ?? undefined,
        }
    }

    private classifyToolOutput(toolResult: string): MessageContentBlockType {
        try {
            const parsed = JSON.parse(toolResult)
            if (parsed && typeof parsed === 'object') return 'tool_response_json'
        } catch {
            // Not JSON.
        }
        return 'tool_response_text'
    }

    private parseStructuredToolResult(
        toolResult: string,
    ): { type: 'image' | 'file_attachment' | 'markdown' | 'text'; content: string; name?: string } | null {
        try {
            const parsed = JSON.parse(toolResult)
            if (!parsed || typeof parsed !== 'object') {
                return null
            }

            if ((parsed.type === 'markdown' || parsed.type === 'text') && typeof parsed.content === 'string') {
                return {
                    type: parsed.type,
                    content: parsed.content,
                    name: typeof parsed.name === 'string' ? parsed.name : undefined,
                }
            }

            if (parsed.type === 'image' && typeof parsed.content === 'string') {
                return {
                    type: 'image',
                    content: parsed.content,
                    name: typeof parsed.name === 'string' ? parsed.name : undefined,
                }
            }

            if (parsed.type === 'file_attachment' && typeof parsed.content === 'string') {
                return {
                    type: 'file_attachment',
                    content: parsed.content,
                    name: typeof parsed.name === 'string' ? parsed.name : undefined,
                }
            }
        } catch {
            // Non-JSON tool outputs remain plain text.
        }

        return null
    }

    private async executeToolCall(
        toolName: string,
        args: Record<string, unknown>,
        context: ToolExecutionContext,
        callback?: ToolCallback,
    ): Promise<string> {
        const tool = this.tools.find((t) => t.name === toolName)
        if (!tool) {
            throw new Error(`Tool "${toolName}" not found.`)
        }

        return await tool.execute(args, context, callback)
    }

    private async requestPermission(request: ToolPermissionRequest, signal?: AbortSignal): Promise<boolean> {
        if (!this.permissionHandler) {
            throw new Error('Permission handler is not configured.')
        }

        return await this.permissionHandler(request, signal)
    }
}
