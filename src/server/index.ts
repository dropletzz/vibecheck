import { Store } from './store';
import { HTTPServer } from './httpserver';
import { WsServer } from './wsserver';

const SERVER_PORT = Number(process.env.VIBECHECK_SERVER_PORT) || 4747;
const PUBLIC_FOLDER = process.env.VIBECHECK_PUBLIC_FOLDER || 'build/public';
const STATE_FILE = process.env.VIBECHECK_STATE_FILE || 'state.json';

// state of currently live sessions can be periodically saved to file,
// it allows recovery if server goes down. it's turned off by default
const STORE_SAVE_INTERVAL_MS = Number(process.env.VIBECHECK_SAVE_INTERVAL_MS) || 0;

const store = new Store(STATE_FILE);

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

(async () => {
    await store.load();
    if (STORE_SAVE_INTERVAL_MS > 0) store.startAutoSave(STORE_SAVE_INTERVAL_MS);
    await httpServer.start();
    await wsServer.start();
})().catch((error) => {
    console.error('Startup error:', error);
    process.exit(1);
});

