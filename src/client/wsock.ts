// PersistentWS: WebSocket client with automatic reconnection.
// close() is the only way to stop it permanently (e.g. after a 'terminated' message).

import { ClientMessage, FATAL_CLOSE_CODE, ServerMessage, SessionId } from '../common';

export type PersistentWSState = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed';

export interface PersistentWSOptions {
    sessionId: SessionId;
    queryParams?: Record<string, string>;
    onMessage: (message: ServerMessage) => void;
    onStateChange?: (state: PersistentWSState, failures: number) => void;
    minDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    maxAttempts?: number;
    jitter?: boolean;
    reconnectOnFocus?: boolean;
    reconnectOnOnline?: boolean;
}

export class PersistentWS {
    private socket: WebSocket | null = null;
    private sessionId: string;
    private queryParams?: Record<string, string>;
    private onMessage: (message: ServerMessage) => void;
    private onStateChange?: (state: PersistentWSState, failures: number) => void;
    private currentState: PersistentWSState = 'connecting';
    private failures = 0;
    private closed = false;
    private reconnectTimer: number | null = null;

    private minDelayMs: number;
    private maxDelayMs: number;
    private backoffFactor: number;
    private maxAttempts: number;
    private jitter: boolean;

    constructor(options: PersistentWSOptions) {
        this.sessionId = options.sessionId;
        this.queryParams = options.queryParams;
        this.onMessage = options.onMessage;
        this.onStateChange = options.onStateChange;
        this.minDelayMs = options.minDelayMs ?? 100;
        this.maxDelayMs = options.maxDelayMs ?? 1600;
        this.backoffFactor = options.backoffFactor ?? 2;
        this.maxAttempts = options.maxAttempts ?? 6;
        this.jitter = options.jitter ?? false;

        if (options.reconnectOnFocus ?? true) {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') this.wakeup();
            });
        }
        if (options.reconnectOnOnline ?? true) {
            window.addEventListener('online', () => this.wakeup());
        }

        this.connect();
    }

    get state(): PersistentWSState {
        return this.currentState;
    }

    send(message: ClientMessage): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    retry(): void {
        if (this.closed || this.state !== 'failed') return;
        this.failures = 0;
        this.connect();
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            const socket = this.socket;
            this.socket = null;
            socket.close();
        }
        this.setState('closed');
    }

    private url(): string {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const query = new URLSearchParams();
        query.set('session', this.sessionId);
        if (this.queryParams) {
            for (const [key, value] of Object.entries(this.queryParams)) {
                query.set(key, value);
            }
        }
        return `${protocol}://${window.location.host}/?${query.toString()}`;
    }

    private connect(): void {
        if (this.closed) return;
        if (this.socket) {
            const old = this.socket;
            this.socket = null;
            old.close();
        }
        const socket = new WebSocket(this.url());
        this.socket = socket;

        socket.addEventListener('message', (event) => {
            if (this.socket !== socket) return;
            if (this.currentState !== 'open') {
                this.failures = 0;
                this.setState('open');
            }
            try {
                this.onMessage(JSON.parse(event.data) as ServerMessage);
            } catch {}
        });

        socket.addEventListener('close', (event) => {
            if (this.socket !== socket) return;
            this.socket = null;
            if (this.closed) {
                this.setState('closed');
                return;
            }
            if (event.code === FATAL_CLOSE_CODE) {
                this.setState('failed');
                return;
            }
            this.failures++;
            if (this.failures >= this.maxAttempts) {
                this.setState('failed');
                return;
            }
            this.setState('reconnecting');
            this.scheduleReconnect();
        });
    }

    private scheduleReconnect(): void {
        let delay = this.minDelayMs * Math.pow(this.backoffFactor, this.failures - 1);
        if (delay > this.maxDelayMs) delay = this.maxDelayMs;
        if (this.jitter) delay *= 0.5 + Math.random();
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private wakeup(): void {
        if (this.closed || this.state === 'open' || this.state === 'connecting') return;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.failures = 0;
        this.connect();
    }

    private setState(state: PersistentWSState): void {
        if (this.currentState === state) return;
        this.currentState = state;
        if (this.onStateChange) this.onStateChange(state, this.failures);
    }
}
