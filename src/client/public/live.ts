// participant page: answer the current section

import { el, elLoading, makeSlider, renderQuestion, renderResults, SliderElement } from '../common';
import { Answer, ParticipantState, Question, QuestionId, SessionId, TextQuestion, throttle } from '../../common';
import { PersistentWS } from '../wsock';

const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('id') || '') as SessionId;

let state: ParticipantState | null = null;
let terminated = false;
let questionBoxes: HTMLElement[] = [];
let myAnswers: Record<string, any[]> = {};
let lastSectionIndex: number | null = null;

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

function renderConnectionError(): HTMLElement {
    return el('main', {},
        el('p', { class: 'empty' }, 'sembra ci siano problemi di connessione'),
        el('div', { class: 'home-actions' },
            el('button', { class: 'big', onclick: () => client.retry() }, 'riprova'),
            el('button', { class: 'big', onclick: goHome }, 'torna alla home'),
        ),
    );
}

let reconnectOverlay: HTMLElement | null = null;

function showReconnecting() {
    if (!reconnectOverlay) {
        reconnectOverlay = elLoading();
        document.documentElement.append(reconnectOverlay);
    }
    reconnectOverlay.classList.remove('reconnect-hidden');
}

function hideReconnecting() {
    if (reconnectOverlay) reconnectOverlay.classList.add('reconnect-hidden');
}

const client = new PersistentWS({
    sessionId,
    role: 'participant',
    onMessage(message) {
        if (message.type === 'participant-state') {
            state = message.state;
            if (state.sectionIndex !== lastSectionIndex) {
                lastSectionIndex = state.sectionIndex;
                myAnswers = loadAnswers(state.sectionIndex);
            }
            render();
        } else if (message.type === 'terminated') {
            terminated = true;
            render();
            client.close();
        }
    },
    onStateChange(wsState) {
        if (wsState === 'reconnecting') showReconnecting();
        else if (wsState === 'open') hideReconnecting();
        else if (wsState === 'failed') {
            hideReconnecting();
            document.body.replaceChildren(renderConnectionError());
        }
    },
});

function render() {
    ensureEmojiUi();
    updateEmojiUiVisibility();

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
    if (state.phase === 'lobby') {
        return renderLobby();
    }

    const children: HTMLElement[] = [el('h1', {}, state.name || 'partecipa')];

    if (state.phase === 'results') {
        const section = state.section;
        if (section?.title) children.push(el('h2', {}, section.title));
        if (state.results) {
            children.push(el('div', {}, ...renderResults(state.results, section?.questions || [], render, vote)));
        } else {
            children.push(el('p', { class: 'empty' }, 'le risposte sono chiuse, attendi la prossima sezione'));
        }
    } else if (state.submitted) {
        const section = state.section;
        if (section?.title) children.push(el('h2', {}, section.title));
        children.push(el('div', {}, ...(section?.questions || []).map((question) =>
            renderQuestionDisabled(question, myAnswers[question.id] || []),
        )));
        children.push(el('p', { class: 'empty' }, 'risposte inviate'));
    } else {
        const section = state.section;
        if (section?.title) children.push(el('h2', {}, section.title));
        questionBoxes = (section?.questions || []).map((question) => {
            if (question.kind === 'text' && question.multipleAnswers) {
                const initial = (myAnswers[question.id] || []).filter((a) => typeof a === 'string') as string[];
                return renderMultipleAnswersQuestion(question, initial);
            }
            const box = renderQuestion(question);
            addPreferNot(question, box);
            prefillQuestion(question, box);
            return box;
        });
        children.push(el('div', {}, ...questionBoxes));
        children.push(el('button', { class: 'big full', onclick: submit }, 'invia'));
    }

    return el('main', {}, ...children);
}

function sendEmoji(emoji: string) {
    client.send({ type: 'emoji', emoji });
}

let emojiFab: HTMLElement | null = null;
let emojiDropup: HTMLElement | null = null;

function ensureEmojiUi() {
    if (emojiFab && emojiDropup) return;

    const pairs = [
        ['🌸', '💩'],
        ['💣', '🫧'],
        ['🔥', '💧'],
        ['👍', '👎'],
        ['😛', '🤔'],
        ['🙂', '🙃'],
    ];

    const toggleDropup = (open: boolean) => {
        if (emojiDropup) emojiDropup.classList.toggle('open', open);
        if (emojiFab) emojiFab.classList.toggle('active', open);
    };

    emojiFab = el('span', { class: 'emoji-fab', onclick: () => toggleDropup(!(emojiDropup?.classList.contains('open'))) }, '😀');
    emojiDropup = el('div', { class: 'emoji-dropup' });

    for (const pair of pairs) {
        const row = el('div', { class: 'emoji-pair' });
        for (const emoji of pair) {
            row.append(el('span', {
                class: 'emoji-item',
                onclick: () => {
                    client.send({ type: 'emoji', emoji });
                    toggleDropup(false);
                },
            }, emoji));
        }
        emojiDropup.append(row);
    }

    document.documentElement.append(emojiFab, emojiDropup);
}

function updateEmojiUiVisibility() {
    const visible = !terminated;
    if (emojiFab) emojiFab.style.display = visible ? '' : 'none';
    if (emojiDropup) {
        emojiDropup.style.display = visible ? '' : 'none';
        if (!visible) emojiDropup.classList.remove('open');
    }
}

function renderLobby(): HTMLElement {
    return el('main', { class: 'lobby' },
        el('h1', {}, state.name || 'partecipa'),
        el('p', { class: 'empty' }, 'attendiamo che il vibecheck inizi...'),
    );
}

document.addEventListener('click', (event) => {
    const dropup = document.querySelector('.emoji-dropup');
    const fab = document.querySelector('.emoji-fab');
    if (!dropup || !dropup.classList.contains('open')) return;
    const target = event.target as Node;
    if (dropup.contains(target) || (fab && fab.contains(target))) return;
    dropup.classList.remove('open');
    if (fab) fab.classList.remove('active');
});

function renderQuestionDisabled(question: Question, answers: any[]): HTMLElement {
    const box = el('div', { class: 'question ' + question.kind });
    if (question.title) box.append(el('h2', {}, question.title));

    if (answers.length > 0 && answers[0] === null) {
        box.append(el('p', {}, 'non rispondere'));
        return box;
    }

    if (question.kind === 'dimension' || question.kind === 'opposition') {
        const value = answers.length > 0 ? Number(answers[0]) : (question.defaultValue ?? 0);
        const options = {
            value,
            step: 0.01,
            minLabel: question.minLabel || 'min',
            maxLabel: question.maxLabel || 'max',
            disabled: true,
        };
        box.append(question.kind === 'dimension'
            ? makeSlider({ ...options, min: 0, max: 1 })
            : makeSlider({ ...options, min: -1, max: 1, centered: true }));
    } else if (question.kind === 'text') {
        if (question.multipleAnswers) {
            const values = answers.filter((answer) => typeof answer === 'string') as string[];
            const list = values.length > 0 ? values : [''];
            box.append(el('div', {},
                ...list.map((value) => el('input', { type: 'text', value, disabled: true })),
            ));
        } else {
            const value = (answers.find((answer) => typeof answer === 'string') as string) || '';
            box.append(el('textarea', { rows: '2', maxlength: String(question.maxLength), disabled: true }, value));
        }
    } else {
        const selected = answers.filter((answer) => typeof answer === 'string') as string[];
        box.append(el('div', {},
            ...question.choices.map((choice) => el('label', { class: 'check-row' },
                el('input', {
                    type: question.multipleChoices ? 'checkbox' : 'radio',
                    name: question.id,
                    value: choice,
                    checked: selected.includes(choice) || null,
                    disabled: true,
                }),
                el('span', {}, choice || 'opzione vuota'),
            )),
        ));
    }
    return box;
}

function renderMultipleAnswersQuestion(question: TextQuestion, initial: string[]): HTMLElement {
    const box = el('div', { class: 'question ' + question.kind });
    if (question.title) box.append(el('h2', {}, question.title));

    const answersBox = el('div', {});
    const addButton = el('button', { class: 'small', disabled: true }, 'aggiungi risposta');
    let currentInput: HTMLInputElement | null = null;
    let inputCount = 0;

    const addInput = (value = '') => {
        const input = el('input', {
            type: 'text',
            maxlength: String(question.maxLength),
            placeholder: 'scrivi la risposta',
            value,
        });
        input.addEventListener('input', () => {
            if (input === currentInput) {
                addButton.disabled = input.value.length === 0;
            }
        });
        answersBox.append(input);
        currentInput = input;
        inputCount++;
        if (inputCount >= question.maxAnswers) {
            addButton.style.display = 'none';
        } else {
            addButton.disabled = value.length === 0;
        }
    };

    addButton.addEventListener('click', () => addInput());
    const values = initial.length > 0 ? initial : [''];
    values.forEach((value) => addInput(value));

    box.append(answersBox, addButton);
    return box;
}

function collectAnswers(): Record<QuestionId, Answer | null> {
    const section = state.section;
    const answers: Record<QuestionId, Answer | null> = {};
    if (!section) return answers;

    section.questions.forEach((question, index) => {
        const box = questionBoxes[index];
        if (!box) return;

        const preferNot = box.querySelector('.prefer-not') as HTMLInputElement | null;
        if (preferNot && preferNot.checked) {
            answers[question.id] = null;
            myAnswers[question.id] = [null];
            return;
        }

        if (question.kind === 'dimension' || question.kind === 'opposition') {
            const slider = box.querySelector('.slider') as SliderElement | null;
            if (slider) {
                const value = slider.value;
                answers[question.id] = value;
                myAnswers[question.id] = [value];
            }
        } else if (question.kind === 'text') {
            if (question.multipleAnswers) {
                const inputs = Array.from(box.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
                const values = Array.from(new Set(
                    inputs.map((input) => input.value.trim()).filter((value) => value.length > 0),
                ));
                if (values.length > 0) {
                    answers[question.id] = values;
                    myAnswers[question.id] = values;
                }
            } else {
                const textarea = box.querySelector('textarea') as HTMLTextAreaElement | null;
                const value = textarea ? textarea.value.trim() : '';
                if (value.length > 0) {
                    answers[question.id] = value;
                    myAnswers[question.id] = [value];
                }
            }
        } else {
            const checked = Array.from(box.querySelectorAll('input:checked')) as HTMLInputElement[];
            const values = Array.from(new Set(checked.map((input) => input.value)));
            if (question.multipleChoices) {
                answers[question.id] = values;
                myAnswers[question.id] = values;
            } else if (values[0]) {
                answers[question.id] = values[0];
                myAnswers[question.id] = [values[0]];
            }
        }
    });

    return answers;
}

function vote(questionId: string, text: string, direction: 1 | -1) {
    client.send({ type: 'vote', questionId: questionId as QuestionId, text, direction });
}

function saveAnswers(sectionIndex: number) {
    try {
        localStorage.setItem('vibecheck.answers.' + sessionId, JSON.stringify({ sectionIndex, answers: myAnswers }));
    } catch {}
}

function loadAnswers(sectionIndex: number): Record<string, any[]> {
    try {
        const raw = localStorage.getItem('vibecheck.answers.' + sessionId);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sectionIndex === sectionIndex && parsed.answers && typeof parsed.answers === 'object') {
            return parsed.answers;
        }
    } catch {}
    return {};
}

function addPreferNot(question: Question, box: HTMLElement) {
    const relevant = question.kind === 'dimension' || question.kind === 'opposition' ||
        (question.kind === 'choice' && !question.multipleChoices);
    if (!relevant) return;

    const checkbox = el('input', { type: 'checkbox', class: 'prefer-not' });
    checkbox.addEventListener('change', () => setQuestionInputsDisabled(box, checkbox.checked));
    box.append(el('label', { class: 'check-row prefer-not-row' },
        checkbox,
        el('span', {}, 'preferisco non rispondere'),
    ));
}

function setQuestionInputsDisabled(box: HTMLElement, disabled: boolean) {
    box.querySelectorAll('input[type="radio"]').forEach((input) => {
        (input as HTMLInputElement).disabled = disabled;
    });
    const slider = box.querySelector('.slider') as SliderElement | null;
    if (slider) slider.disabled = disabled;
}

function prefillQuestion(question: Question, box: HTMLElement) {
    const saved = myAnswers[question.id] || [];
    if (saved.length > 0 && saved[0] === null) {
        const preferNot = box.querySelector('.prefer-not') as HTMLInputElement | null;
        if (preferNot) {
            preferNot.checked = true;
            setQuestionInputsDisabled(box, true);
        }
        return;
    }
    if (question.kind === 'dimension' || question.kind === 'opposition') {
        const slider = box.querySelector('.slider') as SliderElement | null;
        if (slider && saved.length > 0) slider.value = Number(saved[0]);
    } else if (question.kind === 'text') {
        const textarea = box.querySelector('textarea') as HTMLTextAreaElement | null;
        if (textarea && saved.length > 0) textarea.value = String(saved[0]);
    } else {
        const selected = saved.filter((a) => typeof a === 'string') as string[];
        box.querySelectorAll('input').forEach((input) => {
            const el = input as HTMLInputElement;
            el.checked = selected.includes(el.value);
        });
    }
}

function submit() {
    const section = state.section;
    if (!section) return;
    if (!confirm('vuoi inviare le tue risposte?')) return;
    const answers = collectAnswers();

    for (const question of section.questions) {
        const value = answers[question.id];
        if (!Array.isArray(value)) continue;
        if (question.kind !== 'text' && question.kind !== 'choice') continue;
        if (value.length > question.maxAnswers) {
            alert('troppe risposte: massimo ' + question.maxAnswers + ' per questa domanda');
            return;
        }
    }

    client.send({ type: 'submit', answers });
}

window.addEventListener('pagehide', () => {
    try {
        if (!state || state.phase !== 'answering' || state.submitted) return;
        collectAnswers();
        saveAnswers(state.sectionIndex);
    } catch {}
});

const saveAnswersThrottled = throttle(() => {
    if (!state || state.phase !== 'answering' || state.submitted) return;
    collectAnswers();
    saveAnswers(state.sectionIndex);
}, 300);

document.addEventListener('input', (event) => {
    if ((event.target as Element | null)?.closest('.question')) saveAnswersThrottled();
});

document.addEventListener('change', (event) => {
    if ((event.target as Element | null)?.closest('.question')) saveAnswersThrottled();
});
