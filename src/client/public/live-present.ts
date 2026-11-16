import { el, elLoading, renderQuestion, renderResults } from '../common';
import { ClientMessage, Nonce, PresenterState, SessionId, SummaryState } from '../../common';
import { PersistentWS } from '../wsock';
import { renderQrCode } from '../qrcode';

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

    const navButtons: HTMLElement[] = [];
    if (state.sectionIndex > 0) {
        navButtons.push(el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex - 1 }) }, '← indietro'));
    }
    if (state.phase === 'results') {
        navButtons.push(lastSection
            ? el('button', { class: 'big', onclick: () => send({ type: 'summary' }) }, 'riepilogo')
            : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'avanti →'));
    }
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
        el('h2', {}, 'scansiona per partecipare'),
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

    return el('main', { class: 'presenter' },
        el('h1', {}, state.name || 'vibecheck'),
        el('p', { class: 'empty' }, 'in attesa dei partecipanti...'),
        el('div', { class: 'counters' },
            el('p', { class: 'counter' }, state.participantCount + ' partecipanti'),
        ),
        el('div', { class: 'link-row' },
            linkInput,
            el('button', { onclick: copyLink }, 'copia'),
            el('button', { onclick: () => { showQr = true; render(); } }, 'mostra qr'),
        ),
        el('button', { class: 'big', onclick: () => send({ type: 'start' }) }, 'inizia'),
    );
}

function spawnEmoji(emoji: string) {
    if (emoji === '💣') { spawnBomb(); return; }
    if (emoji === '🫧') { spawnBubbleEmoji(); return; }
    if (emoji === '🌸') { spawnFlower(); return; }
    if (emoji === '💩') { spawnPoop(); return; }
    if (emoji === '💧') { spawnWater(); return; }
    if (emoji === '🔥') { spawnFire(); return; }
    spawnGeneric(emoji);
}

function getEmojiLayer(): HTMLElement {
    let layer = document.querySelector('.emoji-layer') as HTMLElement | null;
    if (!layer) {
        layer = el('div', { class: 'emoji-layer' });
        document.body.append(layer);
    }
    return layer;
}

function spawnGeneric(emoji: string) {
    const span = el('span', { class: 'emoji-fly' }, emoji);
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.bottom = '-24px';
    getEmojiLayer().append(span);
    const animation = span.animate(
        [
            { transform: 'translateY(0) scale(0.5)', opacity: 0 },
            { transform: 'translateY(-120px) scale(1.3)', opacity: 1, offset: 0.15 },
            { transform: 'translateY(-360px) scale(1)', opacity: 0 },
        ],
        { duration: 2400, easing: 'ease-out' },
    );
    animation.onfinish = () => span.remove();
}

function spawnBomb() {
    const bomb = el('span', { class: 'emoji-fly' }, '💣');
    const left = (5 + Math.random() * 90) + '%';
    bomb.style.left = left;
    bomb.style.top = '-40px';
    const targetY = window.innerHeight * (0.35 + Math.random() * 0.35);
    getEmojiLayer().append(bomb);

    const fall = bomb.animate(
        [
            { transform: 'translateY(0) rotate(-15deg)', opacity: 1 },
            { transform: `translateY(${targetY}px) rotate(10deg)`, opacity: 1 },
        ],
        { duration: 900, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    );
    fall.onfinish = () => {
        bomb.textContent = '💥';
        bomb.animate(
            [
                { transform: `translateY(${targetY}px) rotate(10deg) scale(1)`, opacity: 1 },
                { transform: `translateY(${targetY}px) rotate(10deg) scale(2.8)`, opacity: 0 },
            ],
            { duration: 450, easing: 'ease-out' },
        ).onfinish = () => bomb.remove();
    };
}

function spawnBubbleEmoji() {
    const bubble = el('span', { class: 'emoji-fly' }, '🫧');
    bubble.style.left = (10 + Math.random() * 80) + '%';
    bubble.style.top = (10 + Math.random() * 70) + '%';
    getEmojiLayer().append(bubble);

    const fromSide = (Math.random() < 0.5 ? -1 : 1) * (window.innerWidth * 0.5 + 100);
    const x = () => (Math.random() - 0.5) * 240;
    bubble.animate(
        [
            { transform: `translateX(${fromSide}px) translateY(0) scale(0.6)`, opacity: 0, easing: 'ease-out' },
            { transform: 'translateX(0) translateY(0) scale(1)', opacity: 1, offset: 0.15 },
            { transform: `translateX(${x()}px) translateY(-50px) scale(1)`, opacity: 1, offset: 0.35 },
            { transform: `translateX(${x()}px) translateY(-100px) scale(1)`, opacity: 1, offset: 0.55 },
            { transform: `translateX(${x()}px) translateY(-150px) scale(1)`, opacity: 1, offset: 0.75 },
            { transform: `translateX(${x()}px) translateY(-150px) scale(1.3)`, opacity: 0.6, offset: 0.88 },
            { transform: `translateX(${x()}px) translateY(-150px) scale(0)`, opacity: 0 },
        ],
        { duration: 3400 },
    ).onfinish = () => bubble.remove();
}

function spawnFlower() {
    const span = el('span', { class: 'emoji-fly' }, '🌸');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = (10 + Math.random() * 70) + '%';
    span.style.fontSize = (1.8 + Math.random() * 1.2) + 'rem';
    getEmojiLayer().append(span);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    span.animate(
        [
            { transform: 'rotate(0deg) scale(0.5)', opacity: 0 },
            { transform: `rotate(${spin * 0.5}deg) scale(1)`, opacity: 1, offset: 0.2 },
            { transform: `rotate(${spin}deg) scale(2)`, opacity: 0 },
        ],
        { duration: 2800, easing: 'cubic-bezier(0.12, 0.6, 0.2, 1)' },
    ).onfinish = () => span.remove();
}

function spawnPoop() {
    const span = el('span', { class: 'emoji-fly' }, '💩');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = (10 + Math.random() * 70) + '%';
    span.style.fontSize = (1.8 + Math.random() * 1.2) + 'rem';
    getEmojiLayer().append(span);
    const popIn = span.animate(
        [
            { transform: 'scale(0)', opacity: 0 },
            { transform: 'scale(1.25)', opacity: 1, offset: 0.7 },
            { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 450, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
    popIn.onfinish = () => {
        window.setTimeout(() => {
            span.animate(
                [
                    { transform: 'scale(1)', opacity: 1 },
                    { transform: 'scale(0)', opacity: 0 },
                ],
                { duration: 250, easing: 'ease-in' },
            ).onfinish = () => span.remove();
        }, 600);
    };
}

function spawnWater() {
    const span = el('span', { class: 'emoji-fly' }, '💧');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = '-40px';
    getEmojiLayer().append(span);

    const fallY = window.innerHeight + 60;
    span.animate(
        [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: `translateY(${fallY}px)`, opacity: 1 },
        ],
        { duration: 1800, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    ).onfinish = () => span.remove();
}

function spawnFire() {
    const span = el('span', { class: 'emoji-fly' }, '🔥');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.bottom = '-40px';
    getEmojiLayer().append(span);

    const rise = window.innerHeight * 0.5;
    span.animate(
        [
            { transform: 'translateY(0) translateX(0)', opacity: 1 },
            { transform: `translateY(${-rise * 0.25}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.25 },
            { transform: `translateY(${-rise * 0.5}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.5 },
            { transform: `translateY(${-rise * 0.75}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.75 },
            { transform: `translateY(${-rise}px) translateX(0)`, opacity: 0 },
        ],
        { duration: 1200, easing: 'linear' },
    ).onfinish = () => span.remove();
}

function terminate() {
    if (!confirm('vuoi terminare il vibecheck?')) return;
    send({ type: 'terminate' });
}

function send(payload: ClientMessage) {
    client.send(payload);
}
