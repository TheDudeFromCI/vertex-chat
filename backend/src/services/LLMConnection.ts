export interface LLMPreparedRequest {
    model: string
    messages: any
    tools: any
    stream: true
    temperature?: number
}

export interface LLMConnection {
    listModels(): Promise<string[]>
    createChatCompletion(payload: LLMPreparedRequest, signal?: AbortSignal): Promise<Response>
    countInputTokens(payload: LLMPreparedRequest, signal?: AbortSignal): Promise<number>
}

export interface LLMConnectionOptions {
    apiKey: string
    baseUrl: string
    timeout?: number
    model: string
}

export class FetchLLMConnection implements LLMConnection {
    private readonly baseUrl: string
    private readonly apiKey: string

    constructor(options: LLMConnectionOptions) {
        this.baseUrl = options.baseUrl
        this.apiKey = options.apiKey
    }

    async listModels(): Promise<string[]> {
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

    async createChatCompletion(payload: LLMPreparedRequest, signal?: AbortSignal): Promise<Response> {
        return await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(payload),
            signal,
        })
    }

    async countInputTokens(payload: LLMPreparedRequest, signal?: AbortSignal): Promise<number> {
        const response = await fetch(`${this.baseUrl}/chat/completions/input_tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(payload),
            signal,
        })

        if (!response.ok) {
            const errorResponse = await response.json()
            console.error('Failed to count tokens:', errorResponse['error'])
            throw new Error('Failed to count tokens')
        }

        const data = await response.json()
        return data.input_tokens
    }
}
