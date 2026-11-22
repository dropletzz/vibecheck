import { applyCensorDelta, applyVoteDelta, el, elLoading, renderQuestion, renderResults, rerenderQuestionCard } from '../common';
import { ClientMessage, Nonce, PresenterState, QuestionId, SessionId, SummaryState } from '../../common';
import { PersistentWS } from '../wsock';
import { renderQrCode } from '../qrcode';
import { spawnEmoji } from '../animations';

const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('id') || '') as SessionId;
const nonce = (localStorage.getItem('vibecheck.nonce.' + sessionId) || '') as Nonce;

let state: PresenterState | null = null;
let terminated = false;
let showQuestions = false;
let showQr = false;
let summaryState: SummaryState | null = null;

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
    queryParams: { role: 'presenter', nonce },
    onMessage(message) {
        if (message.type === 'state') {
            state = message.state;
            patchCounters();
            render();
        } else if (message.type === 'presenter-counts') {
            if (state) {
                state.participantCount = message.participantCount;
                state.answerCount = message.answerCount;
                patchCounters();
            }
        } else if (message.type === 'vote-delta') {
            const section = state?.section;
            if (state && section && state.results) {
                if (applyVoteDelta(state.results, section.questions, message.questionId, message.text, message.score, message.myVote)) {
                    rerenderQuestionCard(state.results, section.questions, message.questionId, render, undefined, undefined, true, censorAnswer);
                }
            }
        } else if (message.type === 'censor-delta') {
            const section = state?.section;
            if (state && section && state.results) {
                if (applyCensorDelta(state.results, section.questions, message.questionId, message.text)) {
                    rerenderQuestionCard(state.results, section.questions, message.questionId, render, undefined, undefined, true, censorAnswer);
                }
            }
        } else if (message.type === 'terminated') {
            terminated = true;
            showQuestions = false;
            render();
            client.close();
        } else if (message.type === 'summary') {
            summaryState = message.summary;
            render();
        } else if (message.type === 'emoji') {
            spawnEmoji(message.emoji);
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

function renderConnectionError(): HTMLElement {
    return el('main', {},
        el('p', { class: 'empty' }, 'sembra ci siano problemi di connessione'),
        el('div', { class: 'home-actions' },
            el('button', { class: 'big', onclick: () => client.retry() }, 'riprova'),
            el('button', { class: 'big', onclick: goHome }, 'torna alla home'),
        ),
    );
}

function snapshotAnswerBoxes(): Map<string, DOMRect> {
    const map = new Map<string, DOMRect>();
    document.querySelectorAll('.text-results.detailed .answer-box[data-key]').forEach((node) => {
        const el = node as HTMLElement;
        const key = el.dataset.key || '';
        if (key) map.set(key, el.getBoundingClientRect());
    });
    return map;
}

function animateAnswerBoxes(previous: Map<string, DOMRect>) {
    document.querySelectorAll('.text-results.detailed .answer-box[data-key]').forEach((node) => {
        const el = node as HTMLElement;
        const key = el.dataset.key || '';
        const old = previous.get(key);
        if (!old) return;
        const now = el.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.animate(
            [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0, 0)' },
            ],
            { duration: 350, easing: 'ease-out' },
        );
    });
}

function render() {
    const prev = snapshotAnswerBoxes();

    if (terminated) {
        document.body.replaceChildren(renderEnd('vibecheck terminato, puoi chiudere questa pagina'));
        return;
    }
    if (!state) {
        document.body.replaceChildren(el('main', {}, el('p', { class: 'empty' }, 'connessione...')));
        return;
    }
    if (summaryState) {
        document.body.replaceChildren(renderSummaryView());
        animateAnswerBoxes(prev);
        return;
    }
    if (state.phase === 'lobby') {
        document.body.replaceChildren(renderLobbyView());
    } else {
        document.body.replaceChildren(renderPresenter());
        if (showQuestions) document.body.append(renderQuestionsModal());
    }
    if (showQr) document.body.append(renderQrModal());
    animateAnswerBoxes(prev);
}

function patchCounters() {
    if (!state) return;
    const participants = document.querySelector('[data-counter="participants"]');
    if (participants) participants.textContent = state.participantCount + ' partecipanti';
    const answers = document.querySelector('[data-counter="answers"]');
    if (answers) answers.textContent = state.answerCount + ' risposte';
}

function closeSummary() {
    summaryState = null;
    render();
}

function renderSummaryView(): HTMLElement {
    if (!summaryState) return el('div', {});
    const summary = summaryState;
    const children: HTMLElement[] = [
        el('div', { class: 'row space-between' },
            el('h1', {}, summary.vibecheck.name || 'riepilogo'),
            el('button', { class: 'small', onclick: downloadSummary }, 'scarica risposte'),
        ),
    ];
    for (const section of summary.sections) {
        if (section.section.title) children.push(el('h2', {}, section.section.title));
        children.push(el('div', {}, ...renderResults(section.results, section.section.questions, render)));
    }
    children.push(el('div', { class: 'nav-row' },
        el('button', { class: 'big', onclick: closeSummary }, '← indietro'),
        el('button', { class: 'big danger', onclick: terminate }, 'termina'),
    ));
    return el('main', { class: 'presenter' }, ...children);
}

function downloadSummary() {
    if (!summaryState) return;
    const data = { vibecheck: summaryState.vibecheck, answers: summaryState.answers };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = (summaryState.vibecheck.name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-') || 'vibecheck') + '-risposte.json';
    const link = el('a', { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
        el('div', { class: 'link-row' },
            linkInput,
            el('button', { onclick: copyLink }, 'copia'),
            el('button', { onclick: () => { showQr = true; render(); } }, 'mostra qr'),
        ),
    ];
    if (section?.title) children.push(el('h2', {}, section.title));
    children.push(
        el('div', { class: 'counters' },
            el('p', { class: 'counter', 'data-counter': 'participants' }, state.participantCount + ' partecipanti'),
            el('p', { class: 'counter', 'data-counter': 'answers' }, state.answerCount + ' risposte'),
        ),
    );

    children.push(el('label', { class: 'check-row' },
        el('input', {
            type: 'checkbox',
            checked: state.emojiBlocked || null,
            onchange: (event) => send({ type: 'set-emoji-blocked', blocked: (event.target as HTMLInputElement).checked }),
        }),
        el('span', {}, 'blocca emoji'),
    ));

    if (state.phase === 'results') {
        children.push(el('div', {}, ...renderResults(state.results || [], section?.questions || [], render, undefined, undefined, true, censorAnswer)));
        if (state.hasVotable && !state.votingClosed) {
            children.push(el('div', { class: 'flex-h' },
                el('button', { class: 'danger', onclick: () => {
                    if (!confirm('vuoi chiudere le votazioni?')) return;
                    send({ type: 'close-voting' });
                } }, 'chiudi votazioni'),
            ));
        }
    } else {
        children.push(el('div', { class: 'flex-h' },
            el('button', { onclick: () => { showQuestions = true; render(); } }, 'mostra domande'),
            el('button', { class: 'danger', onclick: () => {
                if (!confirm('vuoi chiudere le risposte?')) return;
                send({ type: 'close-section' });
            } }, 'chiudi le risposte'),
        ));
    }

    const navButtons: HTMLElement[] = [];
    if (state.sectionIndex > 0) {
        navButtons.push(el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex - 1 }) }, '← indietro'));
    }

    const forwardButtons: HTMLElement[] = [];
    if (state.phase === 'results') {
        forwardButtons.push(lastSection
            ? el('button', { class: 'big', onclick: () => send({ type: 'summary' }) }, 'riepilogo')
            : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'avanti →'));
    }
    if (lastSection && state.phase === 'results') {
        forwardButtons.push(el('button', { class: 'big danger', onclick: terminate }, 'termina'));
    }

    if (forwardButtons.length > 0) {
        navButtons.push(el('div', { class: 'nav-spacer' }));
        navButtons.push(...forwardButtons);
    }
    children.push(el('div', { class: 'nav-row' }, ...navButtons));

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

function renderQrModal(): HTMLElement {
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            showQr = false;
            render();
        }
    });

    const qrCanvas = el('canvas', { class: 'qr-canvas' });
    renderQrCode(qrCanvas, { text: participantLink() });

    const modal = el('div', { class: 'modal alt-bg' },
        el('button', { class: 'small danger modal-close', title: 'chiudi', onclick: () => { showQr = false; render(); } }, '✕'),
        qrCanvas,
    );

    overlay.append(modal);
    return overlay;
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

function renderLobbyView(): HTMLElement {
    const linkInput = el('input', {
        class: 'link-input',
        type: 'text',
        readonly: true,
        value: participantLink(),
        onclick: (event) => (event.target as HTMLInputElement).select(),
    });

    const qrCanvas = el('canvas', { class: 'qr-canvas' });
    renderQrCode(qrCanvas, { text: participantLink() });

    return el('main', { class: 'presenter' },
        el('h1', {}, state.name || 'vibecheck'),
        qrCanvas,
        el('div', { class: 'counters' },
            el('p', { class: 'counter', 'data-counter': 'participants' }, state.participantCount + ' partecipanti'),
        ),
        el('div', { class: 'link-row' },
            linkInput,
            el('button', { onclick: copyLink }, 'copia'),
        ),
        el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: state.emojiBlocked || null,
                onchange: (event) => send({ type: 'set-emoji-blocked', blocked: (event.target as HTMLInputElement).checked }),
            }),
            el('span', {}, 'blocca emoji'),
        ),
        el('button', { class: 'big', onclick: () => send({ type: 'start' }) }, 'inizia'),
    );
}

function censorAnswer(questionId: string, text: string) {
    if (!confirm('vuoi censurare questa risposta?')) return;
    send({ type: 'censor-answer', questionId: questionId as QuestionId, text });
}

function terminate() {
    if (!confirm('vuoi terminare il vibecheck?')) return;
    send({ type: 'terminate' });
}

function send(payload: ClientMessage) {
    client.send(payload);
}
