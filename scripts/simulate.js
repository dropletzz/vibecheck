// Simula N partecipanti a un vibecheck live.
//
// Uso:
//   node scripts/simulate.js <link-partecipante> <numero-partecipanti>
//
// Esempio:
//   node scripts/simulate.js http://localhost:3000/live.html?id=abc123 20
//
// I partecipanti simulati:
//   - restano in attesa durante la lobby
//   - rispondono (con risposte casuali e un ritardo casuale) quando il
//     presentatore apre una sezione
//   - votano le risposte di testo votabili quando vedono i risultati
//   - mandano emoji a intervalli casuali
//   - si riconnettono automaticamente se il server viene riavviato
//     (a meno che la sessione non esista più)

const WebSocket = require('ws');

const FATAL_CLOSE_CODE = 4001;

const [link, countArg] = process.argv.slice(2);

if (!link || !countArg) {
    console.error('uso: node scripts/simulate.js <link-partecipante> <numero-partecipanti>');
    process.exit(1);
}

const count = Number.parseInt(countArg, 10);
if (!Number.isInteger(count) || count < 1) {
    console.error('il numero di partecipanti deve essere un intero maggiore di zero');
    process.exit(1);
}

let parsed;
try {
    parsed = new URL(link);
} catch {
    console.error('link non valido');
    process.exit(1);
}

const sessionId = parsed.searchParams.get('id');
if (!sessionId) {
    console.error('il link deve contenere ?id=... (es. http://localhost:3000/live.html?id=abc)');
    process.exit(1);
}

const wsProtocol = parsed.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${wsProtocol}://${parsed.host}/?session=${encodeURIComponent(sessionId)}&role=participant`;

const EMOJIS = ['🌸', '💩', '💣', '✨', '🔥', '💧', '👍', '👎', '😛', '🤔', '🙂', '🙃'];
const WORDS = ['ciao', 'bello', 'ok', 'non so', 'forse', 'assolutamente', 'mah', 'wow', 'sì', 'no', 'dipende'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomEmoji = () => pick(EMOJIS);
const randomWord = () => pick(WORDS);

function randomAnswer(question) {
    switch (question.kind) {
        case 'dimension':
            return Math.random();
        case 'opposition':
            return Math.random() * 2 - 1;
        case 'text': {
            if (question.multipleAnswers) {
                const n = 1 + Math.floor(Math.random() * Math.min(3, question.maxAnswers));
                return Array.from(new Set(Array.from({ length: n }, randomWord)));
            }
            return randomWord();
        }
        case 'choice': {
            const choices = (question.choices || []).filter((c) => typeof c === 'string' && c.trim().length > 0);
            if (choices.length === 0) return null;
            if (question.multipleChoices) {
                const n = 1 + Math.floor(Math.random() * Math.min(choices.length, question.maxAnswers));
                return [...choices].sort(() => Math.random() - 0.5).slice(0, n);
            }
            return pick(choices);
        }
        default:
            return null;
    }
}

function buildAnswers(section) {
    const answers = {};
    for (const question of section.questions || []) {
        if (Math.random() < 0.05) {
            answers[question.id] = null; // preferisco non rispondere
            continue;
        }
        const answer = randomAnswer(question);
        if (answer !== null) answers[question.id] = answer;
    }
    return answers;
}

let terminatedCount = 0;

function simulateParticipant(index) {
    const userId = `sim-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    const submittedSections = new Set();
    const pendingSections = new Set();
    const votedSections = new Set();
    const submitTimers = new Map();
    let ws = null;
    let terminated = false;
    let emojiTimer = null;
    let lastSectionIndex = null;
    let lastState = null;

    const stopEmojiSpam = () => {
        if (emojiTimer) {
            clearTimeout(emojiTimer);
            emojiTimer = null;
        }
    };

    const scheduleEmoji = () => {
        emojiTimer = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'emoji', emoji: randomEmoji() }));
            }
            scheduleEmoji();
        }, 600 + Math.random() * 5000);
    };

    const scheduleSubmit = (state) => {
        const sectionIndex = state.sectionIndex;
        if (pendingSections.has(sectionIndex) || submittedSections.has(sectionIndex)) return;
        pendingSections.add(sectionIndex);

        const delay = 1000 + Math.random() * 8000;
        const timer = setTimeout(() => {
            pendingSections.delete(sectionIndex);
            submitTimers.delete(sectionIndex);
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (!lastState || lastState.phase !== 'answering' || lastState.sectionIndex !== sectionIndex || lastState.submitted) return;
            if (!lastState.section) return;
            ws.send(JSON.stringify({ type: 'submit', answers: buildAnswers(lastState.section) }));
            submittedSections.add(sectionIndex);
            console.log(`[${index}] risposte inviate`);
        }, delay);
        submitTimers.set(sectionIndex, timer);
    };

    const scheduleVotes = (state) => {
        const section = state.section;
        const results = state.results;
        if (!section || !results) return;

        const targets = [];
        section.questions.forEach((question, questionIndex) => {
            if (question.kind !== 'text' || !question.votable) return;
            const result = results[questionIndex];
            if (!result || result.kind !== 'text') return;

            const texts = Array.from(new Set(result.answers || []));
            if (texts.length === 0) return;

            const n = Math.min(texts.length, 1 + Math.floor(Math.random() * 2));
            const chosen = [...texts].sort(() => Math.random() - 0.5).slice(0, n);
            for (const text of chosen) {
                targets.push({ questionId: question.id, text });
            }
        });

        for (const target of targets) {
            const delay = 500 + Math.random() * 9000;
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN && !terminated) {
                    const direction = Math.random() < 0.7 ? 1 : -1;
                    ws.send(JSON.stringify({ type: 'vote', questionId: target.questionId, text: target.text, direction }));
                    console.log(`[${index}] voto inviato`);
                }
            }, delay);
        }
    };

    const connect = () => {
        ws = new WebSocket(wsUrl, { headers: { cookie: `userId=${userId}` } });

        ws.on('open', () => {
            scheduleEmoji();
        });

        ws.on('message', (data) => {
            let message;
            try {
                message = JSON.parse(String(data));
            } catch {
                return;
            }

            if (message.type === 'participant-state') {
                const state = message.state;
                lastState = state;
                if (state.sectionIndex !== lastSectionIndex) {
                    lastSectionIndex = state.sectionIndex;
                    console.log(`[${index}] sezione ${state.sectionIndex} (${state.phase})`);
                }

                if (state.phase === 'answering' && !state.submitted && state.section) {
                    scheduleSubmit(state);
                } else if (state.phase === 'results' && state.results && !state.votingClosed && !votedSections.has(state.sectionIndex)) {
                    votedSections.add(state.sectionIndex);
                    scheduleVotes(state);
                }
            } else if (message.type === 'terminated') {
                terminated = true;
                ws.close();
            }
        });

        ws.on('close', (code) => {
            stopEmojiSpam();
            for (const [sectionIndex, timer] of submitTimers) {
                clearTimeout(timer);
                pendingSections.delete(sectionIndex);
            }
            submitTimers.clear();

            if (terminated || code === FATAL_CLOSE_CODE) {
                terminatedCount++;
                console.log(`[${index}] disconnesso definitivamente${code === FATAL_CLOSE_CODE ? ' (sessione non trovata)' : ''}`);
                if (terminatedCount >= count) {
                    console.log('tutti i partecipanti sono terminati');
                    process.exit(0);
                }
                return;
            }
            // server riavviato o connessione persa: riconnetti con backoff casuale
            setTimeout(connect, 800 + Math.random() * 2000);
        });

        ws.on('error', () => {
            // la chiusura arriverà subito dopo
        });
    };

    connect();
}

console.log(`avvio ${count} partecipanti verso ${parsed.host} (sessione ${sessionId})`);
for (let i = 0; i < count; i++) {
    simulateParticipant(i);
}
