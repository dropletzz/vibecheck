import * as fs from 'fs';
import * as path from 'path';
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

interface HTTPServerConfig {
    port: number;
    publicFolder: string;
    https: { key: string; cert: string } | null;
    store: Store;
}

export class HTTPServer {
    private server: http.Server | https.Server;
    private store: Store;
    private publicFolder: string;
    private indexHTMLFile: Buffer;
    private port: number;

    constructor(config: HTTPServerConfig) {
        this.store = config.store;
        this.publicFolder = path.resolve(config.publicFolder);
        this.port = config.port;
        this.server = config.https
            ? https.createServer({
                key: fs.readFileSync(config.https.key),
                cert: fs.readFileSync(config.https.cert),
            })
            : http.createServer();
        this.indexHTMLFile = fs.readFileSync(path.join(this.publicFolder, 'index.html'));
        this.server.on('request', (req, res) => this.handleRequest(req, res));
    }

    getServer(): http.Server | https.Server {
        return this.server;
    }

    start() {
        this.server.listen(this.port, () => {
            const protocol = this.server instanceof https.Server ? 'https' : 'http';
            console.log(`Server ${protocol} in ascolto sulla porta ${this.port}`);
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

        if (req.method === 'GET' && parsedUrl.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(this.indexHTMLFile);
            return;
        }

        const filePath = path.normalize(path.join(this.publicFolder, parsedUrl.pathname));
        if (!filePath.startsWith(this.publicFolder + path.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('403 - Forbidden', 'utf-8');
            return;
        }
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
    }
}
