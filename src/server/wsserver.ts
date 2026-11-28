import * as http from 'http';
import * as https from 'https';
import { WebSocketServer } from 'ws';
import { Store } from './store';
import { ClientMessage, FATAL_CLOSE_CODE, Nonce, QuestionId, ServerMessage, SessionId, UserId, makeId } from '../common';

const VOTE_DELTA_MS = 150;
const HEARTBEAT_MS = 10000;

interface WsServerConfig {
    server: http.Server | https.Server;
    store: Store;
}

export class WsServer {
    private store: Store;
    private wss: WebSocketServer;
    private presenterSockets = new Map<string, any>();
    private participantSockets = new Map<string, Map<string, any>>();
    private voteDeltaBuffers = new Map<string, Map<string, { sectionIndex: number; questionId: QuestionId; text: string }>>();
    private voteDeltaTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(config: WsServerConfig) {
        this.store = config.store;
        this.wss = new WebSocketServer({ server: config.server });
        this.wss.on('connection', (ws, req) => {
            (ws as any).isAlive = true;
            ws.on('pong', () => { (ws as any).isAlive = true; });
            this.handleConnection(ws, req);
        });
        setInterval(() => {
            this.wss.clients.forEach((client) => {
                const ws = client as any;
                if (ws.isAlive === false) {
                    ws.terminate();
                    return;
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, HEARTBEAT_MS);
    }

    async start(): Promise<void> {
        console.log('Server ws in ascolto');
    }

    private send(ws: any, payload: ServerMessage) {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    }

    private sendPresenterState(sessionId: SessionId) {
        const ws = this.presenterSockets.get(sessionId);
        if (!ws) return;
        const state = this.store.getPresenterState(sessionId);
        if (state) this.send(ws, { type: 'state', state });
    }

    private sendPresenterCounts(sessionId: SessionId) {
        const ws = this.presenterSockets.get(sessionId);
        if (!ws) return;
        const counts = this.store.getPresenterCounts(sessionId);
        if (counts) this.send(ws, { type: 'presenter-counts', participantCount: counts.participantCount, answerCount: counts.answerCount });
    }

    private broadcastVoteDelta(sessionId: SessionId, questionId: QuestionId, text: string, score: number) {
        const presenter = this.presenterSockets.get(sessionId);
        if (presenter) this.send(presenter, { type: 'vote-delta', questionId, text, score });
        const sockets = this.participantSockets.get(sessionId);
        if (sockets) {
            for (const pws of sockets.values()) {
                this.send(pws, { type: 'vote-delta', questionId, text, score });
            }
        }
    }

    private broadcastCensorDelta(sessionId: SessionId, questionId: QuestionId, text: string) {
        const presenter = this.presenterSockets.get(sessionId);
        if (presenter) this.send(presenter, { type: 'censor-delta', questionId, text });
        const sockets = this.participantSockets.get(sessionId);
        if (sockets) {
            for (const pws of sockets.values()) {
                this.send(pws, { type: 'censor-delta', questionId, text });
            }
        }
    }

    private bufferVoteDelta(sessionId: SessionId, sectionIndex: number, questionId: QuestionId, text: string) {
        let buffer = this.voteDeltaBuffers.get(sessionId);
        if (!buffer) {
            buffer = new Map();
            this.voteDeltaBuffers.set(sessionId, buffer);
        }
        const key = questionId + '\u0000' + text;
        if (!buffer.has(key)) buffer.set(key, { sectionIndex, questionId, text });
        if (!this.voteDeltaTimers.has(sessionId)) {
            this.voteDeltaTimers.set(sessionId, setTimeout(() => {
                this.voteDeltaTimers.delete(sessionId);
                this.flushVoteDeltas(sessionId);
            }, VOTE_DELTA_MS));
        }
    }

    private flushVoteDeltas(sessionId: SessionId) {
        const buffer = this.voteDeltaBuffers.get(sessionId);
        if (!buffer) return;
        this.voteDeltaBuffers.delete(sessionId);
        for (const entry of buffer.values()) {
            const score = this.store.scoreOf(sessionId, entry.sectionIndex, entry.questionId, entry.text);
            this.broadcastVoteDelta(sessionId, entry.questionId, entry.text, score);
        }
    }

    private sendEmoji(sessionId: SessionId, emoji: string) {
        if (this.store.emojisBlocked(sessionId)) return;
        const ws = this.presenterSockets.get(sessionId);
        if (!ws) return;
        this.send(ws, { type: 'emoji', emoji: emoji.slice(0, 8) });
    }

    private broadcastParticipants(sessionId: SessionId) {
        const sockets = this.participantSockets.get(sessionId);
        if (!sockets) return;
        const session = this.store.getSession(sessionId);
        if (!session) return;
        const section = session.vibecheck.sections[session.sectionIndex];
        const showResults = this.store.phase(sessionId) === 'results' && !!section && !!section.showResults;
        const baseResults = showResults ? this.store.computeResults(sessionId, session.sectionIndex) : undefined;
        for (const userId of this.store.getParticipantIds(sessionId)) {
            const ws = sockets.get(userId);
            if (!ws) continue;
            const state = this.store.getParticipantState(sessionId, userId, baseResults);
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
        const sessionId = (url.searchParams.get('session') || '') as SessionId;
        const role = url.searchParams.get('role') || 'participant';

        if (!sessionId || !this.store.hasSession(sessionId)) {
            ws.close(FATAL_CLOSE_CODE, 'sessione non trovata');
            return;
        }

        if (role === 'presenter') {
            const nonce = (url.searchParams.get('nonce') || '') as Nonce;
            if (!this.store.validateNonce(sessionId, nonce)) {
                ws.close(FATAL_CLOSE_CODE, 'nonce non valido');
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
                    } else if (message.type === 'start') {
                        this.store.startSession(sessionId);
                    } else if (message.type === 'set-emoji-blocked') {
                        this.store.setEmojiBlocked(sessionId, message.blocked);
                    } else if (message.type === 'close-voting') {
                        this.store.closeVoting(sessionId);
                    } else if (message.type === 'censor-answer') {
                        this.store.censorAnswer(sessionId, message.questionId, message.text);
                        this.broadcastCensorDelta(sessionId, message.questionId, message.text);
                        return;
                    } else if (message.type === 'correlation-request') {
                        const points = this.store.correlationData(sessionId, message.xSectionIndex, message.xQuestionId, message.ySectionIndex, message.yQuestionId);
                        this.send(ws, { type: 'correlation-data', plotId: message.plotId, points });
                        return;
                    } else if (message.type === 'single-result-request') {
                        const result = this.store.singleResult(sessionId, message.sectionIndex, message.questionId);
                        if (result) {
                            this.send(ws, { type: 'single-result', plotId: message.plotId, sectionIndex: message.sectionIndex, questionId: message.questionId, result });
                        }
                        return;
                    } else if (message.type === 'summary') {
                        const summary = this.store.getSummary(sessionId);
                        if (summary) this.send(ws, { type: 'summary', summary });
                        return;
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
                        const voteTimer = this.voteDeltaTimers.get(sessionId);
                        if (voteTimer) clearTimeout(voteTimer);
                        this.voteDeltaTimers.delete(sessionId);
                        this.voteDeltaBuffers.delete(sessionId);
                        return;
                    }
                    this.sendPresenterState(sessionId);
                    this.broadcastParticipants(sessionId);
                } catch {}
            });
            ws.on('close', () => {
                if (this.presenterSockets.get(sessionId) === ws) this.presenterSockets.delete(sessionId);
            });
            this.sendPresenterState(sessionId);
        } else {
            const cookies = this.parseCookies(req);
            const userId = (cookies.userId || 'anon-' + makeId()) as UserId;
            this.store.addParticipant(sessionId, userId);

            let sockets = this.participantSockets.get(sessionId);
            if (!sockets) {
                sockets = new Map();
                this.participantSockets.set(sessionId, sockets);
            }
            sockets.set(userId, ws);

            this.sendPresenterCounts(sessionId);
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(String(data)) as ClientMessage;
                    if (message.type === 'submit') {
                        this.store.submitAnswers(sessionId, userId, message.answers || {});
                        const state = this.store.getParticipantState(sessionId, userId);
                        if (state) this.send(ws, { type: 'participant-state', state });
                        this.sendPresenterCounts(sessionId);
                    } else if (message.type === 'vote') {
                        const session = this.store.getSession(sessionId);
                        const sectionIndex = session ? session.sectionIndex : 0;
                        this.store.vote(sessionId, userId, message.questionId, message.text, message.direction);
                        const score = this.store.scoreOf(sessionId, sectionIndex, message.questionId, message.text);
                        const myVote = this.store.myVoteOf(sessionId, sectionIndex, userId, message.questionId, message.text);
                        this.send(ws, { type: 'vote-delta', questionId: message.questionId, text: message.text, score, myVote });
                        this.bufferVoteDelta(sessionId, sectionIndex, message.questionId, message.text);
                    } else if (message.type === 'emoji') {
                        this.sendEmoji(sessionId, message.emoji);
                    }
                } catch {}
            });
            ws.on('close', () => {
                const map = this.participantSockets.get(sessionId);
                if (!map || map.get(userId) !== ws) return;
                map.delete(userId);
                if (map.size === 0) this.participantSockets.delete(sessionId);
                this.store.removeParticipant(sessionId, userId);
                this.sendPresenterCounts(sessionId);
            });
            const state = this.store.getParticipantState(sessionId, userId);
            if (state) this.send(ws, { type: 'participant-state', state });
        }
    }
}
