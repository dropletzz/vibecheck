import { el, renderQuestion } from '../common';
import { ClientMessage, Question, QuestionResult, PresenterState, ServerMessage } from '../../common';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id') || '';
const nonce = localStorage.getItem('vibecheck.nonce.' + sessionId) || '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${window.location.host}/?session=${encodeURIComponent(sessionId)}&role=presenter&nonce=${encodeURIComponent(nonce)}`);

let state: PresenterState | null = null;
let terminated = false;
let showQuestions = false;

socket.addEventListener('message', (event) => {
    try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'state') {
            state = message.state;
            render();
        } else if (message.type === 'terminated') {
            terminated = true;
            showQuestions = false;
            render();
            socket.close();
        }
    } catch {}
});

socket.addEventListener('close', () => {
    if (!state && !terminated) {
        document.body.replaceChildren(renderEnd('sessione non valida o non autorizzata'));
    }
});

function participantLink(): string {
    return `${window.location.origin}/live.html?id=${sessionId}`;
}

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

function render() {
    if (terminated) {
        document.body.replaceChildren(renderEnd('vibecheck terminato, puoi chiudere questa pagina'));
        return;
    }
    if (!state) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'connessione...')));
        return;
    }
    document.body.replaceChildren(renderPresenter());
    if (showQuestions) document.body.append(renderQuestionsModal());
}

function renderPresenter(): HTMLElement {
    const section = state.section;
    const lastSection = state.sectionIndex >= state.totalSections - 1;

    const linkInput = el('input', {
        class: 'link-input',
        type: 'text',
        readonly: true,
        value: participantLink(),
        onclick: (event) => (event.target as HTMLInputElement).select(),
    });

    const children: HTMLElement[] = [
        el('h1', {}, state.name || 'vibecheck'),
        el('div', { class: 'link-row' }, linkInput, el('button', { onclick: copyLink }, 'copia')),
    ];
    if (section?.title) children.push(el('h2', {}, section.title));
    children.push(
        el('div', { class: 'counters' },
            el('p', { class: 'counter' }, state.participantCount + ' partecipanti'),
            el('p', { class: 'counter' }, state.answerCount + ' risposte'),
        ),
    );

    if (state.phase === 'results') {
        children.push(el('div', {}, ...renderResults(state.results || [], section?.questions || [])));
    } else {
        children.push(el('div', { class: 'flex-h' },
            el('button', { onclick: () => { showQuestions = true; render(); } }, 'mostra domande'),
            el('button', { class: 'danger', onclick: () => {
                if (!confirm('vuoi chiudere le risposte?')) return;
                send({ type: 'close-section' });
            } }, 'chiudi le risposte'),
        ));
    }

    children.push(el('div', { class: 'nav-row' },
        state.sectionIndex === 0
            ? el('div', {})
            : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex - 1 }) }, '← indietro'),
        lastSection
            ? el('button', { class: 'big danger', onclick: terminate }, 'termina')
            : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'avanti →'),
    ));

    return el('main', { class: 'presenter' }, ...children);
}

function renderQuestionsModal(): HTMLElement {
    const section = state?.section;
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            showQuestions = false;
            render();
        }
    });

    const modal = el('div', { class: 'modal alt-bg' },
        el('button', { class: 'small danger modal-close', title: 'chiudi', onclick: () => { showQuestions = false; render(); } }, '✕'),
    );
    if (section?.title) modal.append(el('h2', {}, section.title));
    modal.append(el('div', {}, ...(section?.questions || []).map((question) => renderQuestion(question))));

    overlay.append(modal);
    return overlay;
}

function renderResults(results: QuestionResult[], questions: Question[]): HTMLElement[] {
    return results.map((result, index) => {
        const question = questions[index];
        const card = el('div', { class: 'card' });
        if (question?.title) card.append(el('h2', {}, question.title));

        if (result.kind === 'dimension' || result.kind === 'opposition') {
            const sliderQuestion = question && (question.kind === 'dimension' || question.kind === 'opposition') ? question : null;
            card.append(
                el('div', { class: 'slider-labels' },
                    el('span', {}, sliderQuestion?.minLabel || 'min'),
                    el('span', {}, sliderQuestion?.maxLabel || 'max'),
                ),
                el('input', {
                    class: 'result-slider',
                    type: 'range',
                    min: result.kind === 'dimension' ? '0' : '-1',
                    max: '1',
                    step: '0.01',
                    value: String(result.average),
                    tabindex: '-1',
                }),
            );
        } else if (result.kind === 'choice') {
            const entries = Object.entries(result.counts);
            if (entries.length === 0) {
                card.append(el('p', { class: 'muted' }, 'nessuna risposta'));
            }
            for (const [choice, count] of entries) {
                card.append(el('p', {}, choice + ': ' + count));
            }
        } else if (result.kind === 'text') {
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

function copyLink() {
    const link = participantLink();
    const markCopied = () => {
        const button = document.querySelector('.link-row button') as HTMLButtonElement | null;
        if (button) {
            button.textContent = 'copiato!';
            setTimeout(() => { button.textContent = 'copia'; }, 1200);
        }
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(markCopied, () => {});
    } else {
        const input = document.querySelector('.link-input') as HTMLInputElement | null;
        if (input) {
            input.focus();
            input.select();
            try {
                document.execCommand('copy');
                markCopied();
            } catch {}
        }
    }
}

function terminate() {
    if (!confirm('vuoi terminare il vibecheck?')) return;
    send({ type: 'terminate' });
}

function send(payload: ClientMessage) {
    socket.send(JSON.stringify(payload));
}
