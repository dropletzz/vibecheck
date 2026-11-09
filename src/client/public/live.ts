// participant page: answer the current section

import { el, renderQuestion } from '../common';
import { ClientMessage, ParticipantState, ServerMessage } from '../../common';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id') || '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${window.location.host}/?session=${encodeURIComponent(sessionId)}&role=participant`);

let state: ParticipantState | null = null;
let terminated = false;
let questionBoxes: HTMLElement[] = [];

socket.addEventListener('message', (event) => {
    try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'participant-state') {
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
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'sessione non valida')));
    }
});

function render() {
    if (terminated) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'il vibecheck è terminato, grazie per aver partecipato')));
        return;
    }
    if (!state) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'connessione...')));
        return;
    }
    document.body.replaceChildren(renderParticipant());
}

function renderParticipant(): HTMLElement {
    const children: HTMLElement[] = [el('h1', {}, 'partecipa')];

    if (state.phase === 'results') {
        children.push(el('p', { class: 'empty' }, 'le risposte sono chiuse, attendi la prossima sezione'));
    } else if (state.submitted) {
        children.push(el('p', { class: 'empty' }, 'risposta inviata, attendi gli altri'));
    } else {
        const section = state.section;
        if (section?.title) children.push(el('h2', {}, section.title));
        questionBoxes = (section?.questions || []).map((question) => renderQuestion(question));
        children.push(el('div', {}, ...questionBoxes));
        children.push(el('button', { class: 'big', onclick: submit }, 'invia'));
    }

    return el('main', {}, ...children);
}

function submit() {
    const section = state.section;
    if (!section) return;
    const answers: Record<string, any> = {};

    section.questions.forEach((question, index) => {
        const box = questionBoxes[index];
        if (!box) return;

        if (question.kind === 'dimension' || question.kind === 'opposition') {
            const input = box.querySelector('input[type="range"]') as HTMLInputElement;
            if (input) answers[question.id] = Number(input.value);
        } else if (question.kind === 'text') {
            const textarea = box.querySelector('textarea') as HTMLTextAreaElement;
            if (textarea) answers[question.id] = textarea.value;
        } else {
            const checked = Array.from(box.querySelectorAll('input:checked')) as HTMLInputElement[];
            const values = checked.map((input) => input.value);
            answers[question.id] = question.multiple ? values : values[0] || null;
        }
    });

    const message: ClientMessage = { type: 'submit', answers };
    socket.send(JSON.stringify(message));
}
