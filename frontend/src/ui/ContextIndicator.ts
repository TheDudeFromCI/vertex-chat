const SVG_NS = 'http://www.w3.org/2000/svg'
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export class ContextIndicator {
    private readonly element = document.createElement('div')
    private readonly progress = document.createElementNS(SVG_NS, 'circle')

    constructor() {
        this.element.classList.add('context-indicator')

        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')

        const track = document.createElementNS(SVG_NS, 'circle')
        track.classList.add('context-indicator-track')
        this.progress.classList.add('context-indicator-progress')
        for (const circle of [track, this.progress]) {
            circle.setAttribute('cx', '12')
            circle.setAttribute('cy', '12')
            circle.setAttribute('r', String(RADIUS))
        }
        this.progress.setAttribute('stroke-dasharray', String(CIRCUMFERENCE))
        // Start the arc at 12 o'clock.
        this.progress.setAttribute('transform', 'rotate(-90 12 12)')

        svg.append(track, this.progress)
        this.element.appendChild(svg)
        this.update({ used: 0, promptTokens: 0, totalTokens: 0 }, 0)
    }

    build(): HTMLDivElement {
        return this.element
    }

    update(usage: { used: number; promptTokens: number; totalTokens: number }, max: number): void {
        const { used, promptTokens, totalTokens } = usage
        const fraction = max > 0 ? Math.min(Math.max(used / max, 0), 1) : 0
        this.progress.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - fraction)))

        this.element.classList.toggle('context-warning', fraction > 0.5 && fraction <= 0.75)
        this.element.classList.toggle('context-critical', fraction > 0.75)

        const percent = Math.round(fraction * 100)
        this.element.title =
            `Tokens: ${used.toLocaleString()} / ${max.toLocaleString()} (${percent}%)\n` +
            `Prompt: ${promptTokens.toLocaleString()}\n` +
            `Total: ${totalTokens.toLocaleString()}`
    }
}
