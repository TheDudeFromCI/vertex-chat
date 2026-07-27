import type { ConnectionVariant } from '../core/connection_manager';
import { requiredElementIn } from './utils';

export class ChatHeader {
    private readonly root: HTMLElement;
    private readonly connectionState: HTMLElement;
    private readonly clientIdElement: HTMLElement;
    private readonly chatTitleElement: HTMLElement;

    constructor() {
        this.root = document.createElement('header');
        this.root.className = 'chat-header';
        this.root.innerHTML = `
            <div>
                <p class="eyebrow">Main Chat</p>
                <h2 id="chat-title"></h2>
            </div>
            <div class="chat-meta">
                <span class="status-pill" id="connection-state">Connecting</span>
                <span class="client-pill" id="client-id"></span>
            </div>
        `;

        this.connectionState = requiredElementIn<HTMLElement>(this.root, '#connection-state');
        this.clientIdElement = requiredElementIn<HTMLElement>(this.root, '#client-id');
        this.chatTitleElement = requiredElementIn<HTMLElement>(this.root, '#chat-title');
    }

    getRootElement(): HTMLElement {
        return this.root;
    }

    setClientId(label: string): void {
        this.clientIdElement.textContent = label;
    }

    setConnectionState(label: string, variant: ConnectionVariant): void {
        this.connectionState.textContent = label;
        this.connectionState.dataset.state = variant;
    }

    setChatTitle(title: string): void {
        this.chatTitleElement.textContent = title;
    }
}
