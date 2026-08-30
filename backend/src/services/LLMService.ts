import type { ChatCompletionRequest, MessageContent, MessageContentBlockType } from 'vertex-common'

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
    execute: (args: Record<string, unknown>) => Promise<string>
}

export interface ToolParam {
    name: string
    type: string
    description: string
    required: boolean
}

interface PreparedRequest {
    model: string
    messages: any
    tools: any
    stream: true
    temperature?: number
}

export type ChatStreamCallback = (response: MessageContent) => void

export class LLMService {
    private readonly model: string
    private readonly baseUrl: string
    private readonly apiKey: string
    private readonly tools: Tool[] = []
    public temperature: number | null = null
    public maxTokens: number
    public maxOutputTokens: number

    static async initClient(options: LLMServiceOptions): Promise<LLMService> {
        const llm = new LLMService(options.baseUrl, options.apiKey, options.model)

        // Validate the connection by listing available models
        const modelNames = await llm.fetchModels()
        const modelExists = modelNames.includes(options.model)

        console.log('LLMService client initialized with baseUrl:', options.baseUrl)
        console.log('Available models:', modelNames.join(', '))
        if (!modelExists) {
            console.warn(`Warning: Model "${options.model}" not found in available models.`)
        }

        return llm
    }

    private constructor(baseUrl: string, apiKey: string, model: string) {
        this.baseUrl = baseUrl
        this.apiKey = apiKey
        this.model = model
        this.maxTokens = Number.MAX_SAFE_INTEGER
        this.maxOutputTokens = Number.MAX_SAFE_INTEGER * 0.2
    }

    registerTool(tool: Tool): void {
        this.tools.push(tool)
    }

    async chatCompletion(request: ChatCompletionRequest, callback?: ChatStreamCallback): Promise<MessageContent> {
        const response: MessageContent = []
        let lastPush = 0

        const push = (force = false) => {
            if (callback && (force || Date.now() - lastPush >= 1000)) {
                callback(response)
                lastPush = Date.now()
            }
        }

        const appendFragment = (fragment: string, type: MessageContentBlockType) => {
            if (response.at(-1)?.type === type) {
                const block = response.at(-1)!
                block.content += fragment
                push()
            } else {
                response.push({
                    type: type,
                    content: fragment,
                })
                push(true)
            }
        }

        outerLoop: while (true) {
            const optimizedRequest = await this.optimizeTokenCount(request)
            if (!optimizedRequest) {
                throw new Error('Failed to optimize token count for the request.')
            }

            const preparedRequest = await this.prepareRequest(optimizedRequest)
            const stream = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(preparedRequest),
            })

            if (!stream.ok) {
                const errorResponse = await stream.json()
                console.error('Failed to initiate chat completion:', errorResponse['error'])
                throw new Error('Failed to initiate chat completion')
            }

            const reader = stream.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            let toolArgsBuffer = ''

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop()!

                for (let line of lines) {
                    line = line.trim()
                    if (line.startsWith('data: ')) line = line.slice(6)
                    if (line === '') continue
                    if (line === '[DONE]') break

                    const data = JSON.parse(line)

                    const thinkingFragment = data['choices'][0]['delta']['reasoning_content'] || ''
                    if (thinkingFragment) appendFragment(thinkingFragment, 'thinking')

                    const fragment = data['choices'][0]['delta']['content'] || ''
                    if (fragment) appendFragment(fragment, 'text')

                    const tool = data['choices'][0]['delta']['tool_calls'] || null
                    const toolName = tool ? tool['function']['name'] || null : null
                    const toolArgs = tool ? tool['function']['arguments'] || null : null
                    const stopReason = data['choices'][0]['finish_reason'] || null

                    if (toolArgs) toolArgsBuffer += toolArgs

                    if (stopReason === 'tool_calls') {
                        try {
                            const argsJson = JSON.parse(toolArgsBuffer)
                            appendFragment(JSON.stringify({ tool: toolName, args: argsJson }), 'tool_call')

                            try {
                                const toolResult = await this.executeToolCall(toolName, argsJson)
                                request.messages.push({
                                    role: 'tool',
                                    tool_call_id: toolName,
                                    content: toolResult,
                                })
                                appendFragment(toolResult, 'tool_response')
                            } catch (error) {
                                console.error('Failed to execute tool call:', error)
                                appendFragment(
                                    `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                    'tool_response',
                                )
                            } finally {
                                continue outerLoop
                            }
                        } catch (error) {
                            console.error('Failed to parse tool arguments JSON:', error)
                        } finally {
                            toolArgsBuffer = ''
                        }
                    }
                }
            }

            break
        }

        push(true)

        console.log('LLMService chat completion finished. Total response length:', response.length)
        console.log('Response:', JSON.stringify(response, null, 2))

        return response
    }

    private async optimizeTokenCount(request: ChatCompletionRequest): Promise<ChatCompletionRequest> {
        const budget = this.maxTokens - this.maxOutputTokens

        if (budget <= 0) {
            throw new Error('Token budget is non-positive. Cannot optimize token count.')
        }

        if (request.messages.length === 0) {
            return request
        }

        const countTokensForSuffix = async (suffixLength: number): Promise<number> => {
            const start = Math.max(0, request.messages.length - suffixLength)
            return await this.countTokens({
                messages: request.messages.slice(start),
                prompt: request.prompt,
            })
        }

        try {
            const totalTokens = await countTokensForSuffix(request.messages.length)
            if (totalTokens <= budget) {
                return request
            }

            // Invariant: low fits, high does not fit.
            let low = 0
            let high = request.messages.length

            while (high - low > 1) {
                const mid = low + Math.floor((high - low) / 2)
                const midTokens = await countTokensForSuffix(mid)

                if (midTokens <= budget) {
                    low = mid
                } else {
                    high = mid
                }
            }

            return {
                prompt: request.prompt,
                messages: request.messages.slice(request.messages.length - low),
            }
        } catch (error) {
            console.error('Failed to get token count from LLMService:', error)
            throw new Error('Failed to get token count from LLMService: ' + error)
        }
    }

    private async fetchModels(): Promise<string[]> {
        const response = await fetch(`${this.baseUrl}/models`, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
        })

        if (!response.ok) {
            const errorResponse = await response.json()
            console.error('Failed to fetch models:', errorResponse['error'])
            throw new Error('Failed to fetch models')
        }

        const data = await response.json()
        return data.data.map((model: { id: string }) => model.id)
    }

    private async countTokens(request: ChatCompletionRequest): Promise<number> {
        if (request.messages.length === 0) {
            return 0
        }

        const preparedRequest = await this.prepareRequest(request)
        const response = await fetch(`${this.baseUrl}/chat/completions/input_tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(preparedRequest),
        })

        if (!response.ok) {
            const errorResponse = await response.json()
            console.error('Failed to count tokens:', errorResponse['error'])
            throw new Error('Failed to count tokens')
        }

        const data = await response.json()
        return data.input_tokens
    }

    private async prepareRequest(request: ChatCompletionRequest): Promise<PreparedRequest> {
        const messages = []

        if (request.prompt) {
            messages.push({
                role: 'system',
                content: request.prompt,
            })
        }

        for (const message of request.messages) {
            messages.push({
                role: message.role,
                content: message.content,
            })
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

    private async executeToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
        const tool = this.tools.find((t) => t.name === toolName)
        if (!tool) {
            throw new Error(`Tool "${toolName}" not found.`)
        }

        return await tool.execute(args)
    }
}
