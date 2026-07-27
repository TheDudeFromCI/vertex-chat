import type { SessionSnapshot } from '../types/domain';
import type { ClientMessage, OutboundMessage, ServerEvent } from '../types/protocol';
import { newRequestId } from './client_identity';

export type ConnectionVariant = 'connecting' | 'connected' | 'reconnecting';

export type ConnectionCallbacks = {
    onState: (label: string, variant: ConnectionVariant) => void;
    onSession: (session: SessionSnapshot) => void;
    onEvent: (payload: ServerEvent) => void;
    onLog: (entry: string) => void;
};

export class ConnectionManager {
    private readonly outboundQueue: OutboundMessage[] = [];
    private socket: WebSocket | null = null;
    private reconnectAttempts = 0;
    private reconnectTimer: number | null = null;
    private pingTimer: number | null = null;
    private pongTimer: number | null = null;
    private connected = false;

    constructor(
        private readonly clientId: string,
        private readonly callbacks: ConnectionCallbacks,
    ) { }

    connect(): void {
        const wsUrl = new URL('/ws', window.location.href);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl.searchParams.set('clientId', this.clientId);

        this.socket = new WebSocket(wsUrl.toString());
        this.callbacks.onState('Connecting', 'connecting');

        this.socket.addEventListener('open', () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.callbacks.onState('Connected', 'connected');
            this.send({ type: 'hello', clientId: this.clientId, requestId: newRequestId() });
            this.flushQueue();
            this.startHeartbeat();
            this.callbacks.onLog('Socket opened');
        });

        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data)) as ServerEvent;
            if (hasSession(payload)) {
                this.callbacks.onSession(payload.session);
            }
            this.callbacks.onEvent(payload);
        });

        this.socket.addEventListener('close', () => {
            this.connected = false;
            this.callbacks.onState('Reconnecting', 'reconnecting');
            this.stopHeartbeat();
            this.scheduleReconnect();
            this.callbacks.onLog('Socket closed');
        });

        this.socket.addEventListener('error', () => {
            this.callbacks.onLog('Socket error');
        });
    }

    enqueue(message: OutboundMessage): void {
        if (this.socket?.readyState === WebSocket.OPEN && this.connected) {
            this.send(message);
            return;
        }

        this.outboundQueue.push(message);
        this.callbacks.onLog('Queued message until reconnect');
    }

    private send(message: ClientMessage): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
            return;
        }

        if (message.type !== 'hello') {
            this.outboundQueue.push(message);
            this.callbacks.onLog('Queued message until reconnect');
        }
    }

    private flushQueue(): void {
        while (this.outboundQueue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
            const nextMessage = this.outboundQueue.shift();
            if (!nextMessage) {
                return;
            }
            this.send(nextMessage);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
        }

        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
        this.reconnectAttempts += 1;
        this.reconnectTimer = window.setTimeout(() => {
            this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.pingTimer = window.setInterval(() => {
            if (this.socket?.readyState !== WebSocket.OPEN) {
                return;
            }

            this.send({ type: 'ping', requestId: newRequestId() });
            this.stopPongTimeout();
            this.pongTimer = window.setTimeout(() => {
                this.callbacks.onLog('Heartbeat timed out');
                this.socket?.close();
            }, 10000);
        }, 20000);
    }

    private stopHeartbeat(): void {
        if (this.pingTimer !== null) {
            window.clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        this.stopPongTimeout();
    }

    private stopPongTimeout(): void {
        if (this.pongTimer !== null) {
            window.clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
    }
}

function hasSession(payload: ServerEvent): payload is Extract<ServerEvent, { session: SessionSnapshot }> {
    return (
        payload.type === 'welcome' ||
        payload.type === 'pong' ||
        payload.type === 'echo' ||
        payload.type === 'tool_started' ||
        payload.type === 'tool_result' ||
        payload.type === 'tool_error' ||
        payload.type === 'conversation_list' ||
        payload.type === 'conversation_loaded' ||
        payload.type === 'conversation_created' ||
        payload.type === 'conversation_deleted' ||
        payload.type === 'message_updated' ||
        payload.type === 'message_appended'
    );
}
