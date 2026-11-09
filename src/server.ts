import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { WebSocketServer } from 'ws';
import { Store } from './store';
import { ClientMessage, ServerMessage, makeId } from './common';

const SERVER_PORT = process.env.VIBECHECK_SERVER_PORT || 4747;
const PUBLIC_FOLDER = process.env.VIBECHECK_PUBLIC_FOLDER || 'build/public';

///////////////////////////
/////// HTTP SERVER ///////
///////////////////////////

const httpServer = process.env.VIBECHECK_HTTPS_ENABLED
    ? https.createServer({
        key: fs.readFileSync(process.env.VIBECHECK_HTTPS_KEY),
        cert: fs.readFileSync(process.env.VIBECHECK_HTTPS_CERT),
    })
    : http.createServer();

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ttf': 'font/ttf',
};

const indexHTMLFile = fs.readFileSync(path.join(PUBLIC_FOLDER, 'index.html'));

function parseCookies(req: http.IncomingMessage): Record<string, string> {
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

const store = new Store();

httpServer.on('request', (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);

    // create a live session
    if (req.method === 'POST' && parsedUrl.pathname === '/api/session') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                const vibecheck = JSON.parse(body);
                const { id, nonce } = store.createSession(vibecheck);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id, nonce }));
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid body' }));
            }
        });
        return;
    }

    // give participants a persistent anonymous id via cookie
    if (req.method === 'GET' && parsedUrl.pathname === '/live.html') {
        const cookies = parseCookies(req);
        if (!cookies.userId) {
            const userId = makeId() + '-' + Date.now().toString(36);
            res.setHeader('Set-Cookie', `userId=${userId}; Path=/; SameSite=Lax`);
        }
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexHTMLFile);
        return;
    }

    // static files
    const sanitizedPath = path
        .normalize(path.join(PUBLIC_FOLDER, parsedUrl.pathname))
        .replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(process.cwd(), sanitizedPath);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 - Asset Not Found', 'utf-8');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`500 - Server Error: ${error.code}`, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'binary');
        }
    });
});

httpServer.listen(SERVER_PORT, () => {
    const protocol = httpServer instanceof https.Server ? 'https' : 'http';
    console.log(`Server ${protocol} in ascolto sulla porta ${SERVER_PORT}`);
});

////////////////////////
////// WS SERVER ///////
////////////////////////

const wsServer = new WebSocketServer({ server: httpServer });
console.log('Server ws in ascolto sulla porta ' + SERVER_PORT);

function send(ws: any, payload: ServerMessage) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendPresenterState(sessionId: string) {
    const session = store.getSession(sessionId);
    if (session && session.presenterWs) {
        const state = store.getPresenterState(sessionId);
        if (state) send(session.presenterWs, { type: 'state', state });
    }
}

function broadcastParticipants(sessionId: string) {
    const session = store.getSession(sessionId);
    if (!session) return;
    for (const [userId, ws] of session.participants) {
        const state = store.getParticipantState(sessionId, userId);
        if (state) send(ws, { type: 'participant-state', state });
    }
}

wsServer.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session') || '';
    const role = url.searchParams.get('role') || 'participant';

    if (!sessionId || !store.hasSession(sessionId)) {
        ws.close();
        return;
    }

    if (role === 'presenter') {
        const nonce = url.searchParams.get('nonce') || '';
        if (!store.validateNonce(sessionId, nonce)) {
            ws.close();
            return;
        }
        store.setPresenter(sessionId, ws);
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(String(data)) as ClientMessage;
                if (message.type === 'set-section') {
                    store.setSection(sessionId, message.index);
                } else if (message.type === 'close-section') {
                    store.closeSection(sessionId);
                } else if (message.type === 'terminate') {
                    const session = store.getSession(sessionId);
                    if (session) {
                        for (const [, pws] of session.participants) {
                            send(pws, { type: 'terminated' });
                        }
                    }
                    store.deleteSession(sessionId);
                    send(ws, { type: 'terminated' });
                    return;
                }
                sendPresenterState(sessionId);
                broadcastParticipants(sessionId);
            } catch {}
        });
        ws.on('close', () => store.clearPresenter(sessionId));
        sendPresenterState(sessionId);
    } else {
        const cookies = parseCookies(req);
        const userId = cookies.userId || 'anon-' + makeId();
        store.addParticipant(sessionId, userId, ws);
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(String(data)) as ClientMessage;
                if (message.type === 'submit') {
                    store.submitAnswers(sessionId, userId, message.answers || {});
                    const state = store.getParticipantState(sessionId, userId);
                    if (state) send(ws, { type: 'participant-state', state });
                    sendPresenterState(sessionId);
                }
            } catch {}
        });
        ws.on('close', () => store.removeParticipant(sessionId, userId));
        send(ws, { type: 'participant-state', state: store.getParticipantState(sessionId, userId) });
    }
});
