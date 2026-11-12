// participant page: answer the current section

import { el, renderQuestion } from '../common';
import { ClientMessage, ParticipantState, Question, ServerMessage, TextQuestion } from '../../common';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id') || '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${window.location.host}/?session=${encodeURIComponent(sessionId)}&role=participant`);

let state: ParticipantState | null = null;
let terminated = false;
let questionBoxes: HTMLElement[] = [];
let myAnswers: Record<string, any[]> = {};
let lastSectionId: string | null = null;

function goHome() {
    window.location.href = '/';
}

function renderEnd(message: string): HTMLElement {
    return el('main', {},
        el('p', { class: 'empty' }, message),
        el('div', { class: 'home-actions' },
            el('button', { class: 'big', onclick: goHome }, 'torna alla home'),
        ),
    );
}

socket.addEventListener('message', (event) => {
    try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'participant-state') {
            state = message.state;
            const sectionId = state.section?.id || null;
            if (sectionId !== lastSectionId) {
                lastSectionId = sectionId;
                myAnswers = {};
            }
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
        document.body.replaceChildren(renderEnd('sessione non valida'));
    }
});

function render() {
    if (terminated) {
        document.body.replaceChildren(renderEnd('il vibecheck è terminato, grazie per aver partecipato'));
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
        children.push(...renderSubmitted());
    } else {
        const section = state.section;
        if (section?.title) children.push(el('h2', {}, section.title));
        questionBoxes = (section?.questions || []).map((question) =>
            question.kind === 'text' && question.multipleAnswers
                ? renderMultipleAnswersQuestion(question)
                : renderQuestion(question),
        );
        children.push(el('div', {}, ...questionBoxes));
        children.push(el('button', { class: 'big', onclick: submit }, 'invia'));
    }

    return el('main', {}, ...children);
}

function renderSubmitted(): HTMLElement[] {
    const section = state.section;
    if (!section) return [];

    const nodes: HTMLElement[] = [];
    if (section.title) nodes.push(el('h2', {}, section.title));

    for (const question of section.questions) {
        const card = el('div', { class: 'card' });
        if (question.title) card.append(el('h2', {}, question.title));
        appendReadonlyAnswers(card, question, myAnswers[question.id] || []);
        nodes.push(card);
    }
    return nodes;
}

function appendReadonlyAnswers(card: HTMLElement, question: Question, answers: any[]) {
    if (question.kind === 'dimension' || question.kind === 'opposition') {
        const value = answers.length > 0 ? Number(answers[0]) : (question.defaultValue ?? 0);
        card.append(el('p', {}, 'la tua risposta: ' + value.toFixed(2)));
        return;
    }

    const strings = answers.filter((answer) => typeof answer === 'string');
    if (strings.length === 0) {
        card.append(el('p', { class: 'muted' }, 'nessuna risposta'));
    } else {
        for (const string of strings) card.append(el('p', {}, '• ' + string));
    }
}

function renderMultipleAnswersQuestion(question: TextQuestion): HTMLElement {
    const box = el('div', { class: 'question ' + question.kind });
    if (question.title) box.append(el('h2', {}, question.title));

    const answersBox = el('div', {});
    const addButton = el('button', { class: 'small', disabled: true }, 'aggiungi risposta');
    let currentInput: HTMLInputElement | null = null;

    const addInput = () => {
        const input = el('input', {
            type: 'text',
            maxlength: String(question.maxLength),
            placeholder: 'scrivi la risposta',
        });
        input.addEventListener('input', () => {
            if (input === currentInput) {
                addButton.disabled = input.value.length === 0;
            }
        });
        answersBox.append(input);
        currentInput = input;
        addButton.disabled = true;
    };

    addButton.addEventListener('click', addInput);
    addInput();

    box.append(answersBox, addButton);
    return box;
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
            if (input) {
                const value = Number(input.value);
                answers[question.id] = value;
                myAnswers[question.id] = [value];
            }
        } else if (question.kind === 'text') {
            if (question.multipleAnswers) {
                const inputs = Array.from(box.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
                const values = inputs.map((input) => input.value.trim()).filter((value) => value.length > 0);
                if (values.length > 0) {
                    answers[question.id] = values;
                    myAnswers[question.id] = values;
                }
            } else {
                const textarea = box.querySelector('textarea') as HTMLTextAreaElement;
                if (textarea && textarea.value) {
                    answers[question.id] = textarea.value;
                    myAnswers[question.id] = [textarea.value];
                }
            }
        } else {
            const checked = Array.from(box.querySelectorAll('input:checked')) as HTMLInputElement[];
            const values = checked.map((input) => input.value);
            if (question.multipleChoices) {
                answers[question.id] = values;
                myAnswers[question.id] = values;
            } else if (values[0]) {
                answers[question.id] = values[0];
                myAnswers[question.id] = [values[0]];
            }
        }
    });

    const message: ClientMessage = { type: 'submit', answers };
    socket.send(JSON.stringify(message));
}
