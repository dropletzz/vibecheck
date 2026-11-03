import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { WebSocketServer } from 'ws';

const SERVER_PORT = process.env.VIBECHECK_SERVER_PORT || 4747;
const PUBLIC_FOLDER = process.env.VIBECHECK_PUBLIC_FOLDER || 'build/public';

///////////////////////////
/////// HTTP SERVER ///////
///////////////////////////

let httpServer = process.env.VIBECHECK_HTTPS_ENABLED
? https.createServer({
    key: fs.readFileSync(process.env.VIBECHECK_HTTPS_KEY),
    cert: fs.readFileSync(process.env.VIBECHECK_HTTPS_CERT)
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
};

// Serviamo i file del client, usando il server appena creato
const indexHTMLFile = fs.readFileSync(path.join(PUBLIC_FOLDER, 'index.html'));

httpServer.on('request', (req, res) => {
    if (req.url.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('hello');
    }
    else if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexHTMLFile);
    }
    else {
        // Rimuoviamo eventuale query string dall'URL
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        
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
    }
});

if (httpServer) httpServer.listen(SERVER_PORT, () => {
    const protocol = httpServer instanceof https.Server ? 'https' : 'http'
    console.log(`Server ${protocol} in ascolto sulla porta ${SERVER_PORT}`);
});


////////////////////////
////// WS SERVER ///////
////////////////////////

const wsServer = new WebSocketServer({ server: httpServer })
console.log("Server ws in ascolto sulla porta " + SERVER_PORT);

let idCounter: number = 0;
const socketsById: Record<string, any> = {};

wsServer.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log("Nuova connessione da " + clientIp);
    // req.socket.setNoDelay(true);

    idCounter+= 1;
    const id = idCounter + '';
    socketsById[id] = ws;

    ws.on("message", data => {
        try {
            const payload = JSON.parse(data);
            if (payload === 'hey') {
                ws.send('yo');
            }
        } catch (e) {} // do not handle message if it's not JSON
    });

    ws.on("close", data => {
        console.log("Client disconnesso: " + clientIp);
        delete socketsById[id];
    });
});

