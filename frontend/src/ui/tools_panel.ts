import { escapeHtml } from '../core/text';
import type { ToolDefinition } from '../types/domain';
import { requiredElementIn } from './utils';

export type ToolsHandlers = {
    onRunTool: () => void;
    onRefreshTools: () => void;
};

export class ToolsPanel {
    private readonly root: HTMLElement;
    private readonly toolsList: HTMLUListElement;
    private readonly runToolButton: HTMLButtonElement;
    private readonly refreshToolsButton: HTMLButtonElement;

    constructor() {
        this.root = document.createElement('section');
        this.root.className = 'tools';
        this.root.innerHTML = `
            <div class="rail-header">
                <h3>Tools</h3>
                <button id="refresh-tools" type="button" class="ghost-button">Refresh</button>
            </div>
            <ul id="tools-list" class="tools-list"></ul>
            <button id="run-tool" type="button">Run Continue Tool</button>
        `;

        this.toolsList = requiredElementIn<HTMLUListElement>(this.root, '#tools-list');
        this.runToolButton = requiredElementIn<HTMLButtonElement>(this.root, '#run-tool');
        this.refreshToolsButton = requiredElementIn<HTMLButtonElement>(this.root, '#refresh-tools');
    }

    getRootElement(): HTMLElement {
        return this.root;
    }

    bind(handlers: ToolsHandlers): void {
        this.runToolButton.addEventListener('click', handlers.onRunTool);
        this.refreshToolsButton.addEventListener('click', handlers.onRefreshTools);
    }

    render(toolsCatalog: ToolDefinition[]): void {
        this.toolsList.innerHTML = '';
        for (const tool of toolsCatalog) {
            const item = document.createElement('li');
            item.innerHTML = `
        <strong>${escapeHtml(tool.name)}</strong>
        <p>${escapeHtml(tool.description)}</p>
        <code>${escapeHtml(tool.id)}</code>
      `;
            this.toolsList.append(item);
        }
    }
}
