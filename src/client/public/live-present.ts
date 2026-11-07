// the page where the presenter directs the vibecheck

// this code is just here for reference on how to use websockets
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsHost = window.location.host;
const wsConnectionString = `${wsProtocol}://${wsHost}`;
export const socket = new WebSocket(wsConnectionString);

socket.addEventListener("message", async event => {
    let incomingMessage;
    try {
        // incomingMessage = JSON.parse(event.data);
        console.log(`server says: '${event.data}'`);
    } catch (e) {
        if (e instanceof SyntaxError) {
            console.error(`Unparsable JSON message from server: "${event.data}"`, e.message);
        } else {
            console.error('Error handling the message:', incomingMessage);
            console.error(e);
        }
    }
});

setInterval(() => {
    socket.send('"hey"');
}, 1000);

