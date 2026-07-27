import type { ChatMessage, ConversationMeta, Participant, Persona, ToolDefinition } from '../types/domain';
import type { ConnectionVariant } from '../core/connection_manager';
import { ChatHeader } from './chat_header';
import { WorkspacePanel, type WorkspaceHandlers } from './workspace_panel';
import { MessageList, type MessageListHandlers } from './message_list';
import { ChatComposer, type ComposerHandlers } from './chat_composer';
import { ToolsPanel, type ToolsHandlers } from './tools_panel';
import { ParticipantsPanel, type ParticipantsHandlers } from './participants_panel';

export type ChatViewHandlers = {
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onAddAssistant: (personaId: string) => void;
  onSetActiveAssistant: (participantId: string) => void;
  onChangeParticipantPersona: (participantId: string, personaId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onCloneConversation: (conversationId: string) => void;
  onSendMessage: (message: string) => void;
  onEditMessage: (messageId: string) => void;
  onCopyMessage: (messageId: string) => void;
  onPing: () => void;
  onRunTool: () => void;
  onRefreshTools: () => void;
};

export class ChatView {
  private readonly header: ChatHeader;
  private readonly workspacePanel: WorkspacePanel;
  private readonly messageList: MessageList;
  private readonly chatComposer: ChatComposer;
  private readonly toolsPanel: ToolsPanel;
  private readonly participantsPanel: ParticipantsPanel;

  constructor(private readonly root: HTMLDivElement) {
    // Initialize all sub-components first (each creates its own HTML)
    this.header = new ChatHeader();
    this.workspacePanel = new WorkspacePanel();
    this.messageList = new MessageList();
    this.chatComposer = new ChatComposer();
    this.toolsPanel = new ToolsPanel();
    this.participantsPanel = new ParticipantsPanel();

    // Now assemble the main layout
    const main = document.createElement('main');
    main.className = 'workspace';

    // Left sidebar
    const sidebar = this.workspacePanel.getRootElement();

    // Center chat section
    const chatSection = document.createElement('section');
    chatSection.className = 'chat panel';
    chatSection.appendChild(this.header.getRootElement());
    chatSection.appendChild(this.messageList.getRootElement());
    chatSection.appendChild(this.chatComposer.getRootElement());

    // Right rail with tools, participants, session, and events
    const rightRail = document.createElement('aside');
    rightRail.className = 'right-rail panel';
    rightRail.appendChild(this.participantsPanel.getRootElement());
    rightRail.appendChild(this.toolsPanel.getRootElement());

    // Assemble main layout
    main.appendChild(sidebar);
    main.appendChild(chatSection);
    main.appendChild(rightRail);

    // Mount to root
    this.root.innerHTML = '';
    this.root.appendChild(main);
  }

  bind(handlers: ChatViewHandlers): void {
    // Bind workspace panel
    const workspaceHandlers: WorkspaceHandlers = {
      onSelectConversation: handlers.onSelectConversation,
      onNewConversation: handlers.onNewConversation,
      onDeleteConversation: handlers.onDeleteConversation,
      onCloneConversation: handlers.onCloneConversation,
    };
    this.workspacePanel.bind(workspaceHandlers);

    // Bind message list
    const messageListHandlers: MessageListHandlers = {
      onCopyMessage: handlers.onCopyMessage,
      onEditMessage: handlers.onEditMessage,
    };
    this.messageList.bind(messageListHandlers);

    // Bind composer
    const composerHandlers: ComposerHandlers = {
      onSendMessage: handlers.onSendMessage,
      onPing: handlers.onPing,
    };
    this.chatComposer.bind(composerHandlers);

    // Bind tools panel
    const toolsHandlers: ToolsHandlers = {
      onRunTool: handlers.onRunTool,
      onRefreshTools: handlers.onRefreshTools,
    };
    this.toolsPanel.bind(toolsHandlers);

    // Bind participants panel
    const participantsHandlers: ParticipantsHandlers = {
      onAddAssistant: handlers.onAddAssistant,
      onSetActiveAssistant: handlers.onSetActiveAssistant,
      onChangeParticipantPersona: handlers.onChangeParticipantPersona,
    };
    this.participantsPanel.bind(participantsHandlers);
  }

  getComposerText(): string {
    return this.chatComposer.getText();
  }

  setClientId(label: string): void {
    this.header.setClientId(label);
  }

  setConnectionState(label: string, variant: ConnectionVariant): void {
    this.header.setConnectionState(label, variant);
  }

  renderConversations(conversations: ConversationMeta[], activeConversationId: string): void {
    this.workspacePanel.render(conversations, activeConversationId);
  }

  renderMessages(title: string, messages: ChatMessage[]): void {
    this.header.setChatTitle(title);
    this.messageList.render(messages);
  }

  renderTools(toolsCatalog: ToolDefinition[]): void {
    this.toolsPanel.render(toolsCatalog);
  }

  renderParticipants(participants: Participant[], personas: Persona[], activeAssistantId: string): void {
    this.participantsPanel.renderParticipants(participants, personas, activeAssistantId);
  }

  renderPersonas(personas: Persona[]): void {
    this.participantsPanel.renderPersonas(personas);
  }
}
