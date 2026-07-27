import { requiredElementIn } from './utils';

export type ComposerHandlers = {
    onSendMessage: (message: string) => void;
    onPing: () => void;
};

export class ChatComposer {
    private readonly root: HTMLFormElement;
    private readonly composerForm: HTMLFormElement;
    private readonly composerInput: HTMLTextAreaElement;
    private readonly pingButton: HTMLButtonElement;

    constructor() {
        this.root = document.createElement('form');
        this.root.className = 'composer';
        this.root.id = 'composer-form';
        this.root.innerHTML = `
            <textarea
                id="composer-input"
                name="message"
                rows="3"
                placeholder="Type your message..."
                autocomplete="off"
            ></textarea>
            <div class="composer-actions">
                <button id="send-button" type="submit">Send</button>
                <button id="ping-button" type="button" class="ghost-button">Ping</button>
            </div>
        `;

        this.composerForm = this.root;
        this.composerInput = requiredElementIn<HTMLTextAreaElement>(this.root, '#composer-input');
        this.pingButton = requiredElementIn<HTMLButtonElement>(this.root, '#ping-button');
    }

    getRootElement(): HTMLFormElement {
        return this.root;
    }

    bind(handlers: ComposerHandlers): void {
        this.composerForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const message = this.composerInput.value.trim();
            if (!message) {
                return;
            }
            handlers.onSendMessage(message);
            this.composerInput.value = '';
        });

        this.pingButton.addEventListener('click', handlers.onPing);
    }

    getText(): string {
        return this.composerInput.value.trim();
    }

    clear(): void {
        this.composerInput.value = '';
    }
}
