import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { Store } from './store';
import { makeId, validateVibecheck } from '../common';

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

interface StaticFile {
    file: Buffer;
    mime: string;
    hash: string;
}

function loadStaticFiles(publicFolder: string): Map<string, StaticFile> {
    const root = path.resolve(publicFolder);
    const files = new Map<string, StaticFile>();

    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                const relative = path.relative(root, full).split(path.sep).join('/');
                const ext = path.extname(entry.name).toLowerCase();
                const content = fs.readFileSync(full);
                files.set('/' + relative, {
                    file: content,
                    mime: MIME_TYPES[ext] || 'application/octet-stream',
                    hash: crypto.createHash('sha256').update(content).digest('hex'),
                });
            }
        }
    };

    walk(root);
    return files;
}

function matchesEtag(header: string, etag: string): boolean {
    return header.split(',').some((tag) => {
        const t = tag.trim();
        return t === '*' || t === etag || t.replace(/^W\//, '') === etag;
    });
}

interface HTTPServerConfig {
    port: number;
    publicFolder: string;
    https: { key: string; cert: string } | null;
    store: Store;
}

export class HTTPServer {
    private server: http.Server | https.Server;
    private store: Store;
    private staticFiles: Map<string, StaticFile>;
    private port: number;

    constructor(config: HTTPServerConfig) {
        this.store = config.store;
        this.port = config.port;
        this.staticFiles = loadStaticFiles(config.publicFolder);
        this.server = config.https
            ? https.createServer({
                key: fs.readFileSync(config.https.key),
                cert: fs.readFileSync(config.https.cert),
            })
            : http.createServer();
        this.server.on('request', (req, res) => this.handleRequest(req, res));
    }

    getServer(): http.Server | https.Server {
        return this.server;
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onError = (error: Error) => {
                this.server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                this.server.off('error', onError);
                const protocol = this.server instanceof https.Server ? 'https' : 'http';
                console.log(`Server ${protocol} in ascolto sulla porta ${this.port}`);
                resolve();
            };
            this.server.once('error', onError);
            this.server.once('listening', onListening);
            this.server.listen(this.port);
        });
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

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);

        if (req.method === 'POST' && parsedUrl.pathname === '/api/session') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try {
                    const vibecheck = validateVibecheck(JSON.parse(body));
                    const { id, nonce } = this.store.createSession(vibecheck);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ id, nonce }));
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'invalid body' }));
                }
            });
            return;
        }

        if (req.method === 'GET' && parsedUrl.pathname === '/live.html') {
            const cookies = this.parseCookies(req);
            if (!cookies.userId) {
                const userId = makeId() + '-' + Date.now().toString(36);
                res.setHeader('Set-Cookie', `userId=${userId}; Path=/; SameSite=Lax`);
            }
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('405 - Method Not Allowed', 'utf-8');
            return;
        }

        const key = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
        const asset = this.staticFiles.get(key);
        if (!asset) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 - Asset Not Found', 'utf-8');
            return;
        }

        const etag = '"' + asset.hash + '"';
        const headers = {
            'Content-Type': asset.mime,
            'Cache-Control': 'no-cache',
            'ETag': etag,
        };

        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
            res.writeHead(304, headers);
            res.end();
            return;
        }

        res.writeHead(200, headers);
        if (req.method === 'HEAD') {
            res.end();
        } else {
            res.end(asset.file);
        }
    }
}
