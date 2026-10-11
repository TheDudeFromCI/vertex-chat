let audioContext: AudioContext | null = null

function playChime(): void {
    try {
        audioContext ??= new AudioContext()
        const ctx = audioContext
        void ctx.resume()

        const notes = [880, 1318.5]
        notes.forEach((frequency, index) => {
            const start = ctx.currentTime + index * 0.15
            const oscillator = ctx.createOscillator()
            const gain = ctx.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.value = frequency
            gain.gain.setValueAtTime(0.0001, start)
            gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6)
            oscillator.connect(gain).connect(ctx.destination)
            oscillator.start(start)
            oscillator.stop(start + 0.65)
        })
    } catch (error) {
        console.warn('Unable to play permission chime:', error)
    }
}

function showSystemNotification(toolName: string): void {
    if (typeof Notification === 'undefined' || document.hasFocus()) {
        return
    }

    const show = () => {
        const notification = new Notification('Permission needed', {
            body: `Allow tool "${toolName}" to run?`,
            tag: 'vertex-tool-permission',
        })
        notification.onclick = () => {
            window.focus()
            notification.close()
        }
    }

    if (Notification.permission === 'granted') {
        show()
    } else if (Notification.permission === 'default') {
        void Notification.requestPermission().then((result) => {
            if (result === 'granted' && !document.hasFocus()) {
                show()
            }
        })
    }
}

export function alertToolPermissionRequest(toolName: string): void {
    playChime()
    showSystemNotification(toolName)
}
