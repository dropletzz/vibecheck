// presenter page: drives the live session

import { el, renderQuestion } from '../common';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id') || '';
const nonce = localStorage.getItem('vibecheck.nonce.' + sessionId) || '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${window.location.host}/?session=${encodeURIComponent(sessionId)}&role=presenter&nonce=${encodeURIComponent(nonce)}`);

let state: any = null;
let terminated = false;

socket.addEventListener('message', (event) => {
    try {
        const message = JSON.parse(event.data);
        if (message.type === 'state') {
            state = message.state;
            render();
        } else if (message.type === 'terminated') {
            terminated = true;
            render();
            socket.close();
        }
    } catch {}
});

socket.addEventListener('close', () => {
    if (!state && !terminated) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'sessione non valida o non autorizzata')));
    }
});

function render() {
    if (terminated) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'vibecheck terminato, puoi chiudere questa pagina')));
        return;
    }
    if (!state) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'connessione...')));
        return;
    }
    document.body.replaceChildren(renderPresenter());
}

function renderPresenter(): HTMLElement {
    const section = state.section;
    const participantLink = `${window.location.origin}/live.html?id=${sessionId}`;

    const children: HTMLElement[] = [
        el('h1', {}, 'live'),
        el('p', { class: 'muted' }, 'link per i partecipanti:'),
        el('a', { href: participantLink }, participantLink),
    ];

    if (section?.title) children.push(el('h2', {}, section.title));

    if (state.phase === 'answering') {
        children.push(el('div', {}, ...(section?.questions || []).map((question: any) => renderQuestion(question))));
        children.push(el('p', {}, state.answerCount + ' risposte'));
        children.push(el('button', { class: 'big', onclick: () => send({ type: 'close-section' }) }, 'chiudi le risposte'));
    } else {
        children.push(el('div', {}, ...renderResults(state.results || [], section?.questions || [])));
        if (state.sectionIndex < state.totalSections - 1) {
            children.push(el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'sezione successiva'));
        } else {
            children.push(el('button', { class: 'big danger', onclick: () => send({ type: 'terminate' }) }, 'termina'));
        }
    }

    return el('main', {}, ...children);
}

function renderResults(results: any[], questions: any[]): HTMLElement[] {
    return results.map((result, index) => {
        const question = questions[index];
        const card = el('div', { class: 'card' });
        if (question?.title) card.append(el('h2', {}, question.title));

        if (result.kind === 'dimension' || result.kind === 'opposition') {
            card.append(el('p', {}, 'media: ' + result.average.toFixed(2) + ' — varianza: ' + result.variance.toFixed(2)));
        } else if (result.kind === 'choice') {
            const entries = Object.entries(result.counts);
            if (entries.length === 0) {
                card.append(el('p', { class: 'muted' }, 'nessuna risposta'));
            }
            for (const [choice, count] of entries) {
                card.append(el('p', {}, choice + ': ' + count));
            }
        } else {
            if (result.answers.length === 0) {
                card.append(el('p', { class: 'muted' }, 'nessuna risposta'));
            }
            for (const answer of result.answers) {
                card.append(el('p', {}, answer));
            }
        }
        return card;
    });
}

function send(payload: any) {
    socket.send(JSON.stringify(payload));
}
