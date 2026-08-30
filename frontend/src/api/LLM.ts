import type { ChatCompletionRequest, MessageContent } from 'vertex-common'

export type StreamedMessageHandler = (message: MessageContent) => Promise<void>

export async function generateMessageContent(
    request: ChatCompletionRequest,
    callback?: StreamedMessageHandler,
): Promise<MessageContent> {
    const response = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        const errorResponse = await response.json()
        throw new Error(`Failed to generate message content: ${errorResponse['error']}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let generated: MessageContent = []
    let updated = false

    while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        updated = false

        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
            if (line.trim() === '') continue
            generated = JSON.parse(line) as MessageContent
            updated = true
        }

        if (callback && updated) await callback(generated)
    }

    return generated
}
