import { escapeHtml } from '../core/text';
import type { Participant, Persona } from '../types/domain';
import { requiredElementIn } from './utils';

export type ParticipantsHandlers = {
    onAddAssistant: (personaId: string) => void;
    onSetActiveAssistant: (participantId: string) => void;
    onChangeParticipantPersona: (participantId: string, personaId: string) => void;
};

export class ParticipantsPanel {
    private readonly root: HTMLElement;
    private readonly personaSelect: HTMLSelectElement;
    private readonly addAssistantButton: HTMLButtonElement;
    private readonly participantsList: HTMLUListElement;

    constructor() {
        this.root = document.createElement('section');
        this.root.className = 'participants';
        this.root.innerHTML = `
            <div class="rail-header">
                <h3>Participants</h3>
            </div>
            <div class="persona-builder">
                <label for="assistant-persona">Add agent from persona</label>
                <select id="assistant-persona"></select>
                <button id="add-assistant" type="button">Add agent</button>
            </div>
            <ul id="participants-list" class="participants-list"></ul>
        `;

        this.personaSelect = requiredElementIn<HTMLSelectElement>(this.root, '#assistant-persona');
        this.addAssistantButton = requiredElementIn<HTMLButtonElement>(this.root, '#add-assistant');
        this.participantsList = requiredElementIn<HTMLUListElement>(this.root, '#participants-list');
    }

    getRootElement(): HTMLElement {
        return this.root;
    }

    bind(handlers: ParticipantsHandlers): void {
        this.addAssistantButton.addEventListener('click', () => {
            handlers.onAddAssistant(this.personaSelect.value);
        });

        this.participantsList.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const button = target.closest<HTMLButtonElement>('[data-participant-action]');
            if (!button) {
                return;
            }

            const participantId = button.dataset.participantId;
            if (!participantId) {
                return;
            }

            if (button.dataset.participantAction === 'activate') {
                handlers.onSetActiveAssistant(participantId);
            }
        });

        this.participantsList.addEventListener('change', (event) => {
            const target = event.target as HTMLElement;
            const select = target.closest<HTMLSelectElement>('[data-participant-persona-select]');
            if (!select) {
                return;
            }

            const participantId = select.dataset.participantId;
            if (!participantId) {
                return;
            }

            handlers.onChangeParticipantPersona(participantId, select.value);
        });
    }

    renderPersonas(personas: Persona[]): void {
        this.personaSelect.innerHTML = '';
        for (const persona of personas) {
            const option = document.createElement('option');
            option.value = persona.id;
            option.textContent = persona.name;
            this.personaSelect.append(option);
        }

        if (personas.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No personas available';
            this.personaSelect.append(option);
            this.personaSelect.disabled = true;
            this.addAssistantButton.disabled = true;
            return;
        }

        this.personaSelect.disabled = false;
        this.addAssistantButton.disabled = false;
    }

    renderParticipants(participants: Participant[], personas: Persona[], activeAssistantId: string): void {
        this.participantsList.innerHTML = '';
        if (participants.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No participants loaded';
            this.participantsList.append(li);
            return;
        }

        for (const participant of participants) {
            const li = document.createElement('li');
            li.className = 'participant-item';
            const role = participant.role || 'member';
            const name = participant.displayName || participant.id;
            const personaId = typeof participant.metadata?.personaId === 'string' ? participant.metadata.personaId : '';
            const isAssistant = role === 'assistant';
            const personaOptions = personas
                .map((persona) => {
                    const selected = persona.id === personaId ? 'selected' : '';
                    return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}</option>`;
                })
                .join('');
            li.innerHTML = `
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(role)}</span>
        ${isAssistant ? `<small>${participant.id === activeAssistantId ? 'Active speaker' : 'Inactive'}</small>` : ''}
        ${isAssistant ? `<select data-participant-persona-select="true" data-participant-id="${escapeHtml(participant.id)}">${personaOptions}</select>` : ''}
        ${isAssistant ? `<button type="button" class="ghost-button icon-button" data-participant-action="activate" data-participant-id="${escapeHtml(participant.id)}">Use in chat</button>` : ''}
      `;
            this.participantsList.append(li);
        }
    }
}
