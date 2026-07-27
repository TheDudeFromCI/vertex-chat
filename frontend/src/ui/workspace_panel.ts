import { escapeHtml } from '../core/text';
import type { ConversationMeta } from '../types/domain';
import { requiredElementIn } from './utils';

export type WorkspaceHandlers = {
    onSelectConversation: (conversationId: string) => void;
    onNewConversation: () => void;
    onDeleteConversation: (conversationId: string) => void;
    onCloneConversation: (conversationId: string) => void;
};

export class WorkspacePanel {
    private readonly root: HTMLElement;
    private readonly conversationList: HTMLUListElement;
    private readonly newConversationButton: HTMLButtonElement;

    constructor() {
        this.root = document.createElement('aside');
        this.root.className = 'sidebar panel';
        this.root.innerHTML = `
            <div class="brand">
                <p class="eyebrow">Vertex</p>
                <h1>Agent Workspace</h1>
            </div>
            <button id="new-conversation" type="button" class="ghost-button">New conversation</button>
            <ul id="conversation-list" class="conversation-list"></ul>
        `;

        this.conversationList = requiredElementIn<HTMLUListElement>(this.root, '#conversation-list');
        this.newConversationButton = requiredElementIn<HTMLButtonElement>(this.root, '#new-conversation');
    }

    getRootElement(): HTMLElement {
        return this.root;
    }

    bind(handlers: WorkspaceHandlers): void {
        this.newConversationButton.addEventListener('click', handlers.onNewConversation);

        this.conversationList.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const actionButton = target.closest<HTMLButtonElement>('[data-action]');

            if (actionButton?.dataset.action === 'clone-conversation') {
                const conversationId = actionButton.dataset.conversationId;
                if (conversationId) {
                    handlers.onCloneConversation(conversationId);
                }
                return;
            }

            if (actionButton?.dataset.action === 'delete-conversation') {
                const conversationId = actionButton.dataset.conversationId;
                if (conversationId) {
                    handlers.onDeleteConversation(conversationId);
                }
                return;
            }

            const item = target.closest<HTMLButtonElement>('[data-conversation-id]');
            if (!item) {
                return;
            }
            const conversationId = item.dataset.conversationId;
            if (!conversationId) {
                return;
            }
            handlers.onSelectConversation(conversationId);
        });
    }

    render(conversations: ConversationMeta[], activeConversationId: string): void {
        this.conversationList.innerHTML = '';
        for (const conversation of conversations) {
            const item = document.createElement('li');
            item.className = 'conversation-row';
            item.innerHTML = `
        <button
          type="button"
          class="conversation-item ${conversation.id === activeConversationId ? 'is-active' : ''}"
          data-conversation-id="${escapeHtml(conversation.id)}"
        >
          <strong>${escapeHtml(conversation.title)}</strong>
          <span>${escapeHtml(conversation.preview)}</span>
          <time>${new Date(conversation.updatedAt).toLocaleTimeString()}</time>
        </button>
        <div class="conversation-actions">
          <button type="button" class="ghost-button icon-button" data-action="clone-conversation" data-conversation-id="${escapeHtml(conversation.id)}">Clone</button>
          <button type="button" class="ghost-button icon-button danger" data-action="delete-conversation" data-conversation-id="${escapeHtml(conversation.id)}">Delete</button>
        </div>
      `;
            this.conversationList.append(item);
        }
    }
}
