import { escapeHtml } from '../core/text';
import type { ChatMessage } from '../types/domain';

export type MessageListHandlers = {
    onCopyMessage: (messageId: string) => void;
    onEditMessage: (messageId: string) => void;
};

export class MessageList {
    private readonly root: HTMLUListElement;

    constructor() {
        this.root = document.createElement('ul');
        this.root.className = 'message-list';
        this.root.id = 'message-list';
    }

    getRootElement(): HTMLUListElement {
        return this.root;
    }

    bind(handlers: MessageListHandlers): void {
        this.root.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const button = target.closest<HTMLButtonElement>('[data-message-action]');
            if (!button) {
                return;
            }

            const messageId = button.dataset.messageId;
            if (!messageId) {
                return;
            }

            const action = button.dataset.messageAction;
            if (action === 'copy') {
                handlers.onCopyMessage(messageId);
                return;
            }
            if (action === 'edit') {
                handlers.onEditMessage(messageId);
            }
        });
    }

    render(messages: ChatMessage[]): void {
        this.root.innerHTML = '';

        for (const message of messages) {
            const item = document.createElement('li');
            item.className = `message message-${message.role}`;
            item.dataset.messageId = message.id;
            if (message.status === 'pending') {
                item.classList.add('message-pending');
            }
            if (message.status === 'error') {
                item.classList.add('message-error');
            }

            item.innerHTML = `
        <p>${escapeHtml(message.text)}</p>
        <div class="message-meta">
          <span>${escapeHtml(this.messageLabel(message))}</span>
          <time>${new Date(message.timestamp).toLocaleTimeString()}</time>
        </div>
        <div class="message-actions">
          <button type="button" class="ghost-button icon-button" data-message-action="copy" data-message-id="${escapeHtml(message.id)}">Copy</button>
          <button type="button" class="ghost-button icon-button" data-message-action="edit" data-message-id="${escapeHtml(message.id)}">Edit</button>
        </div>
      `;
            this.root.append(item);
        }

        this.root.scrollTop = this.root.scrollHeight;
    }

    private messageLabel(message: ChatMessage): string {
        const displayName = message.metadata?.displayName;
        if (typeof displayName === 'string' && displayName.trim()) {
            return displayName;
        }

        return message.sender || message.role;
    }
}
