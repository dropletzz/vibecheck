import { el, elLoading, renderQuestion, renderResults } from '../common';
import { ClientMessage, Nonce, PresenterState, SessionId, SummaryState } from '../../common';
import { PersistentWS } from '../wsock';

const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('id') || '') as SessionId;
const nonce = (localStorage.getItem('vibecheck.nonce.' + sessionId) || '') as Nonce;

let state: PresenterState | null = null;
let terminated = false;
let showQuestions = false;
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
    role: 'presenter',
    nonce,
    onMessage(message) {
        if (message.type === 'state') {
            state = message.state;
            render();
        } else if (message.type === 'terminated') {
            terminated = true;
            showQuestions = false;
            render();
            client.close();
        } else if (message.type === 'summary') {
            summaryState = message.summary;
            render();
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

function render() {
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
        return;
    }
    document.body.replaceChildren(renderPresenter());
    if (showQuestions) document.body.append(renderQuestionsModal());
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
        children.push(el('div', {}, ...renderResults(state.results || [], section?.questions || [], render)));
    } else {
        children.push(el('div', { class: 'flex-h' },
            el('button', { onclick: () => { showQuestions = true; render(); } }, 'mostra domande'),
            el('button', { class: 'danger', onclick: () => {
                if (!confirm('vuoi chiudere le risposte?')) return;
                send({ type: 'close-section' });
            } }, 'chiudi le risposte'),
        ));
    }

    const navButtons: HTMLElement[] = [
        state.sectionIndex === 0
            ? el('div', {})
            : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex - 1 }) }, '← indietro'),
        state.phase === 'results'
            ? (lastSection
                ? el('button', { class: 'big', onclick: () => send({ type: 'summary' }) }, 'riepilogo')
                : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'avanti →'))
            : el('div', {}),
    ];
    if (lastSection && state.phase === 'results') {
        navButtons.push(el('button', { class: 'big danger', onclick: terminate }, 'termina'));
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
    client.send(payload);
}
