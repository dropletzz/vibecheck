import * as http from 'http';
import * as https from 'https';
import { WebSocketServer } from 'ws';
import { Store } from './store';
import { ClientMessage, ServerMessage, makeId } from '../common';

interface WsServerConfig {
    server: http.Server | https.Server;
    store: Store;
}

export class WsServer {
    private store: Store;
    private wss: WebSocketServer;
    private presenterSockets = new Map<string, any>();
    private participantSockets = new Map<string, Map<string, any>>();

    constructor(config: WsServerConfig) {
        this.store = config.store;
        this.wss = new WebSocketServer({ server: config.server });
        this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    }

    start() {
        console.log('Server ws in ascolto');
    }

    private send(ws: any, payload: ServerMessage) {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    }

    private sendPresenterState(sessionId: string) {
        const ws = this.presenterSockets.get(sessionId);
        if (!ws) return;
        const state = this.store.getPresenterState(sessionId);
        if (state) this.send(ws, { type: 'state', state });
    }

    private broadcastParticipants(sessionId: string) {
        const sockets = this.participantSockets.get(sessionId);
        if (!sockets) return;
        for (const userId of this.store.getParticipantIds(sessionId)) {
            const ws = sockets.get(userId);
            if (!ws) continue;
            const state = this.store.getParticipantState(sessionId, userId);
            if (state) this.send(ws, { type: 'participant-state', state });
        }
    }

    private parseCookies(req: http.IncomingMessage): Record<string, string> {
        const header = req.headers.cookie || '';
        const result: Record<string, string> = {};
        for (const part of header.split(';')) {
            const index = part.indexOf('=');
            if (index >= 0) {
                result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
            }
        }
        return result;
    }

    private handleConnection(ws: any, req: http.IncomingMessage) {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const sessionId = url.searchParams.get('session') || '';
        const role = url.searchParams.get('role') || 'participant';

        if (!sessionId || !this.store.hasSession(sessionId)) {
            ws.close();
            return;
        }

        if (role === 'presenter') {
            const nonce = url.searchParams.get('nonce') || '';
            if (!this.store.validateNonce(sessionId, nonce)) {
                ws.close();
                return;
            }
            this.presenterSockets.set(sessionId, ws);
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(String(data)) as ClientMessage;
                    if (message.type === 'set-section') {
                        this.store.setSection(sessionId, message.index);
                    } else if (message.type === 'close-section') {
                        this.store.closeSection(sessionId);
                    } else if (message.type === 'terminate') {
                        const sockets = this.participantSockets.get(sessionId);
                        if (sockets) {
                            for (const pws of sockets.values()) {
                                this.send(pws, { type: 'terminated' });
                            }
                        }
                        this.store.deleteSession(sessionId);
                        this.send(ws, { type: 'terminated' });
                        this.presenterSockets.delete(sessionId);
                        this.participantSockets.delete(sessionId);
                        return;
                    }
                    this.sendPresenterState(sessionId);
                    this.broadcastParticipants(sessionId);
                } catch {}
            });
            ws.on('close', () => this.presenterSockets.delete(sessionId));
            this.sendPresenterState(sessionId);
        } else {
            const cookies = this.parseCookies(req);
            const userId = cookies.userId || 'anon-' + makeId();
            this.store.addParticipant(sessionId, userId);

            let sockets = this.participantSockets.get(sessionId);
            if (!sockets) {
                sockets = new Map();
                this.participantSockets.set(sessionId, sockets);
            }
            sockets.set(userId, ws);

            this.sendPresenterState(sessionId);
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(String(data)) as ClientMessage;
                    if (message.type === 'submit') {
                        this.store.submitAnswers(sessionId, userId, message.answers || {});
                        const state = this.store.getParticipantState(sessionId, userId);
                        if (state) this.send(ws, { type: 'participant-state', state });
                        this.sendPresenterState(sessionId);
                    }
                } catch {}
            });
            ws.on('close', () => {
                this.store.removeParticipant(sessionId, userId);
                const map = this.participantSockets.get(sessionId);
                if (map) {
                    map.delete(userId);
                    if (map.size === 0) this.participantSockets.delete(sessionId);
                }
                this.sendPresenterState(sessionId);
            });
            const state = this.store.getParticipantState(sessionId, userId);
            if (state) this.send(ws, { type: 'participant-state', state });
        }
    }
}
