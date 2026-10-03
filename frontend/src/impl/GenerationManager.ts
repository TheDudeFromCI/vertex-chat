import type { Uuid } from 'vertex-common'

export interface GenerationTask {
    readonly conversationId: Uuid
    readonly agentId: Uuid
    readonly controller: AbortController
    status: 'queued' | 'running'
    resolve: () => void
    reject: (error: unknown) => void
}

type Runner = (task: GenerationTask) => Promise<void>

// Runs one generation at a time, independent of which conversation is on screen.
export class GenerationManager {
    private readonly runner: Runner
    private readonly queue: GenerationTask[] = []
    private active: GenerationTask | null = null
    private readonly listeners = new Set<() => void>()

    constructor(runner: Runner) {
        this.runner = runner
    }

    enqueue(conversationId: Uuid, agentId: Uuid): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.queue.push({
                conversationId,
                agentId,
                controller: new AbortController(),
                status: 'queued',
                resolve,
                reject,
            })
            this.emit()
            void this.pump()
        })
    }

    isGenerating(conversationId: Uuid): boolean {
        return (
            this.active?.conversationId === conversationId ||
            this.queue.some((t) => t.conversationId === conversationId)
        )
    }

    cancel(conversationId: Uuid): void {
        for (const task of [...this.queue]) {
            if (task.conversationId !== conversationId) continue
            this.queue.splice(this.queue.indexOf(task), 1)
            task.reject(new DOMException('Generation cancelled', 'AbortError'))
        }

        if (this.active?.conversationId === conversationId) {
            this.active.controller.abort()
        }

        this.emit()
    }

    onChange(listener: () => void): void {
        this.listeners.add(listener)
    }

    private emit(): void {
        for (const listener of this.listeners) listener()
    }

    private async pump(): Promise<void> {
        if (this.active) return

        const task = this.queue.shift()
        if (!task) return

        this.active = task
        task.status = 'running'
        this.emit()

        try {
            await this.runner(task)
            task.resolve()
        } catch (error) {
            task.reject(error)
        } finally {
            this.active = null
            this.emit()
            void this.pump()
        }
    }
}
