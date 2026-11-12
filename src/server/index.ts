import { Store } from './store';
import { HTTPServer } from './httpserver';
import { WsServer } from './wsserver';

const SERVER_PORT = Number(process.env.VIBECHECK_SERVER_PORT) || 4747;
const PUBLIC_FOLDER = process.env.VIBECHECK_PUBLIC_FOLDER || 'build/public';
const STATE_FILE = process.env.VIBECHECK_STATE_FILE || 'state.json';

const store = new Store(STATE_FILE);
store.load();
store.startAutoSave();

const httpServer = new HTTPServer({
    port: SERVER_PORT,
    publicFolder: PUBLIC_FOLDER,
    https: process.env.VIBECHECK_HTTPS_ENABLED
        ? { key: process.env.VIBECHECK_HTTPS_KEY, cert: process.env.VIBECHECK_HTTPS_CERT }
        : null,
    store,
});

const wsServer = new WsServer({
    server: httpServer.getServer(),
    store,
});

httpServer.start();
wsServer.start();
