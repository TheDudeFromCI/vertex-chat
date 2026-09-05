import type { ChatCompletionRequest, MessageContent, StreamedMessageContent } from 'vertex-common'

export type StreamedMessageHandler = (message: StreamedMessageContent) => Promise<void>
type FromLLM = StreamedMessageContent | MessageContent

export async function generateMessageContent(
    request: ChatCompletionRequest,
    callback?: StreamedMessageHandler,
    signal?: AbortSignal,
): Promise<MessageContent> {
    const response = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to generate message content: ${errorResponse['error']}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let generated: MessageContent = []

    while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
            if (line.trim() === '') continue
            const fragment = JSON.parse(line) as FromLLM

            if ('delta' in fragment) {
                if (callback) await callback(fragment)
            } else {
                generated = fragment
            }
        }
    }

    return generated
}
