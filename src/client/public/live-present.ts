import { applyCensorDelta, applyVoteDelta, el, elLoading, makeSlider, renderQuestion, renderResults, rerenderQuestionCard, sectionHeading } from '../common';
import { ChoiceQuestion, ClientMessage, Nonce, PresenterState, Question, QuestionId, QuestionResult, SessionId, SummaryState } from '../../common';
import { PersistentWS } from '../wsock';
import { renderQrCode } from '../qrcode';
import { spawnEmoji } from '../animations';
import { drawAverageBarplot, drawBinnedStackedHistogram, drawScatter2d, drawStackedHistogram } from '../plot';

const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('id') || '') as SessionId;
const nonce = (localStorage.getItem('vibecheck.nonce.' + sessionId) || '') as Nonce;

let state: PresenterState | null = null;
let terminated = false;
let showQuestions = false;
let showQr = false;
let summaryState: SummaryState | null = null;

interface CustomPlot {
    plotId: string;
    xSectionIndex: number | null;
    xQuestionId: string | null;
    ySectionIndex: number | null;
    yQuestionId: string | null;
    singleResult: QuestionResult | null;
    points: { x: number | string; y: number | string }[] | null;
    aggregate: boolean;
    clusters: number;
    bars: number;
}

let customPlots: CustomPlot[] = [];
let lastSectionIndexForPlots: number | null = null;

let reconnectOverlay: HTMLElement | null = null;
let reconnectTimer: number | null = null;

function showReconnecting() {
    if (reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!reconnectOverlay) {
            reconnectOverlay = elLoading();
            document.documentElement.append(reconnectOverlay);
        }
        reconnectOverlay.classList.remove('reconnect-hidden');
    }, 500);
}

function hideReconnecting() {
    if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (reconnectOverlay) reconnectOverlay.classList.add('reconnect-hidden');
}

const client = new PersistentWS({
    sessionId,
    queryParams: { role: 'presenter', nonce },
    onMessage(message) {
        if (message.type === 'state') {
            state = message.state;
            if (lastSectionIndexForPlots !== null && state.sectionIndex !== lastSectionIndexForPlots) {
                customPlots = [];
            }
            lastSectionIndexForPlots = state.sectionIndex;
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
        } else if (message.type === 'correlation-data') {
            const plot = customPlots.find((p) => p.plotId === message.plotId);
            if (plot) {
                plot.points = message.points;
                render();
            }
        } else if (message.type === 'single-result') {
            const plot = customPlots.find((p) => p.plotId === message.plotId);
            if (plot) {
                plot.singleResult = message.result;
                render();
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
        children.push(...sectionHeading(section.section));
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
    children.push(el('div', { class: 'row space-between' },
        el('div', { class: 'counters' },
            el('p', { class: 'counter', 'data-counter': 'participants' }, state.participantCount + ' partecipanti'),
            el('p', { class: 'counter', 'data-counter': 'answers' }, state.answerCount + ' risposte'),
        ),
        el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: state.emojiBlocked || null,
                onchange: (event) => send({ type: 'set-emoji-blocked', blocked: (event.target as HTMLInputElement).checked }),
            }),
            el('span', {}, 'blocca emoji'),
        ),
    ));

    if (section) children.push(...sectionHeading(section));

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
        for (const plot of customPlots) {
            children.push(renderCustomPlotCard(plot));
        }
        children.push(el('button', { class: 'insert', onclick: addCustomPlot }, '+ grafico'));
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
    if (section) modal.append(...sectionHeading(section));
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

function plotQuestions(): { sectionIndex: number; question: Question }[] {
    if (!state) return [];
    const out: { sectionIndex: number; question: Question }[] = [];
    state.sections.forEach((section, sectionIndex) => {
        if (sectionIndex > state.sectionIndex) return;
        for (const question of section.questions) {
            if (question.kind === 'dimension' || question.kind === 'opposition') {
                out.push({ sectionIndex, question });
            } else if (question.kind === 'choice' && !question.multipleChoices) {
                out.push({ sectionIndex, question });
            }
        }
    });
    return out;
}

function allQuestions(): { sectionIndex: number; question: Question }[] {
    if (!state) return [];
    const out: { sectionIndex: number; question: Question }[] = [];
    state.sections.forEach((section, sectionIndex) => {
        if (sectionIndex > state.sectionIndex) return;
        for (const question of section.questions) {
            out.push({ sectionIndex, question });
        }
    });
    return out;
}

function isCorrelatable(question: Question): boolean {
    return question.kind === 'dimension' || question.kind === 'opposition' || (question.kind === 'choice' && !question.multipleChoices);
}

function questionLabel(sectionIndex: number, question: Question): string {
    const section = state?.sections[sectionIndex];
    const sectionLabel = section?.title || 'sezione ' + (sectionIndex + 1);
    const title = question.title || question.kind;
    return sectionLabel + ' · ' + title;
}

function findQuestion(sectionIndex: number, questionId: string): Question | null {
    const section = state?.sections[sectionIndex];
    if (!section) return null;
    return section.questions.find((q) => q.id === questionId) || null;
}

function addCustomPlot() {
    customPlots.push({
        plotId: 'plot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        xSectionIndex: null,
        xQuestionId: null,
        ySectionIndex: null,
        yQuestionId: null,
        singleResult: null,
        points: null,
        aggregate: false,
        clusters: 5,
        bars: 7,
    });
    render();
}

function renderCustomPlotCard(plot: CustomPlot): HTMLElement {
    const xQuestion = plot.xSectionIndex !== null && plot.xQuestionId !== null ? findQuestion(plot.xSectionIndex, plot.xQuestionId) : null;
    const yQuestion = plot.ySectionIndex !== null && plot.yQuestionId !== null ? findQuestion(plot.ySectionIndex, plot.yQuestionId) : null;

    const xOptions = allQuestions();
    const xSelect = el('select', {
        onchange: (event) => {
            const value = (event.target as HTMLSelectElement).value;
            if (!value) {
                plot.xSectionIndex = null;
                plot.xQuestionId = null;
            } else {
                const [sectionIndex, questionId] = value.split(':');
                plot.xSectionIndex = Number(sectionIndex);
                plot.xQuestionId = questionId;
            }
            plot.ySectionIndex = null;
            plot.yQuestionId = null;
            plot.singleResult = null;
            plot.points = null;
            if (plot.xSectionIndex !== null && plot.xQuestionId !== null) {
                send({
                    type: 'single-result-request',
                    plotId: plot.plotId,
                    sectionIndex: plot.xSectionIndex,
                    questionId: plot.xQuestionId as QuestionId,
                });
            }
            render();
        },
    },
        el('option', { value: '' }, 'asse x...'),
        ...xOptions.map((opt) => el('option', {
            value: opt.sectionIndex + ':' + opt.question.id,
            selected: (plot.xSectionIndex === opt.sectionIndex && plot.xQuestionId === opt.question.id) || null,
        }, questionLabel(opt.sectionIndex, opt.question))),
    );

    const header = el('div', { class: 'result-header' },
        el('div', { class: 'select-col' }, xSelect),
        el('button', { class: 'small danger', title: 'elimina grafico', onclick: () => {
            customPlots = customPlots.filter((p) => p.plotId !== plot.plotId);
            render();
        } }, '✕'),
    );

    const card = el('div', { class: 'card' }, header);

    if (xQuestion && isCorrelatable(xQuestion)) {
        const yOptions = plotQuestions().filter((opt) => !(opt.sectionIndex === plot.xSectionIndex && opt.question.id === plot.xQuestionId));
        const ySelect = el('select', {
            onchange: (event) => {
                const value = (event.target as HTMLSelectElement).value;
                if (!value) {
                    plot.ySectionIndex = null;
                    plot.yQuestionId = null;
                } else {
                    const [sectionIndex, questionId] = value.split(':');
                    plot.ySectionIndex = Number(sectionIndex);
                    plot.yQuestionId = questionId;
                }
                plot.points = null;
                if (plot.xSectionIndex !== null && plot.xQuestionId !== null && plot.ySectionIndex !== null && plot.yQuestionId !== null) {
                    send({
                        type: 'correlation-request',
                        plotId: plot.plotId,
                        xSectionIndex: plot.xSectionIndex,
                        xQuestionId: plot.xQuestionId as QuestionId,
                        ySectionIndex: plot.ySectionIndex,
                        yQuestionId: plot.yQuestionId as QuestionId,
                    });
                }
                render();
            },
        },
            el('option', { value: '' }, 'asse y...'),
            ...yOptions.map((opt) => el('option', {
                value: opt.sectionIndex + ':' + opt.question.id,
                selected: (plot.ySectionIndex === opt.sectionIndex && plot.yQuestionId === opt.question.id) || null,
            }, questionLabel(opt.sectionIndex, opt.question))),
        );
        header.insertBefore(el('div', { class: 'select-col' }, ySelect), header.lastElementChild);
    }

    const ySelected = plot.ySectionIndex !== null && plot.yQuestionId !== null;

    if (ySelected && xQuestion && yQuestion) {
        if (plot.points) {
            card.append(renderCustomPlotGraph(plot, xQuestion, yQuestion));
        } else {
            card.append(el('p', { class: 'muted' }, 'caricamento...'));
        }
    } else if (!ySelected && xQuestion) {
        if (plot.singleResult) {
            const cards = renderResults([plot.singleResult], [xQuestion], render, undefined, undefined, true);
            const resultCard = cards[0];
            if (resultCard) {
                resultCard.removeAttribute('data-question-id');
                resultCard.classList.remove('card');
                card.append(resultCard);
            }
        } else if (plot.xSectionIndex !== null && plot.xQuestionId !== null) {
            card.append(el('p', { class: 'muted' }, 'caricamento...'));
        }
    }

    return card;
}

function renderCustomPlotGraph(plot: CustomPlot, xQuestion: Question, yQuestion: Question): HTMLElement {
    const xNumeric = xQuestion.kind === 'dimension' || xQuestion.kind === 'opposition';
    const yNumeric = yQuestion.kind === 'dimension' || yQuestion.kind === 'opposition';
    const isStacked = (xNumeric && !yNumeric) || (!xNumeric && !yNumeric);
    const ratio = isStacked ? 1.5 : 1;

    const canvas = el('canvas', { class: 'result-canvas' });
    canvas.width = 400;
    canvas.height = Math.round(400 / ratio);

    const draw = () => {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.getBoundingClientRect().width;
        const cssHeight = Math.round(cssWidth / ratio);
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawCustomPlot(ctx, cssWidth, cssHeight, plot, xQuestion, yQuestion);
    };

    requestAnimationFrame(() => {
        if (canvas.isConnected) draw();
    });

    const controls = el('div', {});

    if (xNumeric && yNumeric) {
        controls.append(el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: plot.aggregate || null,
                onchange: () => {
                    plot.aggregate = !plot.aggregate;
                    render();
                },
            }),
            el('span', {}, 'aggrega'),
        ));

        if (plot.aggregate) {
            const clustersLabel = el('label', {}, 'numero punti: ' + plot.clusters);
            const clustersSlider = makeSlider({
                value: plot.clusters,
                min: 2,
                max: 10,
                step: 1,
                onChange: (value) => {
                    plot.clusters = value;
                    clustersLabel.textContent = 'numero punti: ' + value;
                    draw();
                },
            });
            controls.append(clustersLabel, clustersSlider);
        }
    } else if (xNumeric && !yNumeric) {
        const barsLabel = el('label', {}, 'barre: ' + plot.bars);
        const barsSlider = makeSlider({
            value: plot.bars,
            min: 3,
            max: 37,
            step: 2,
            onChange: (value) => {
                plot.bars = value;
                barsLabel.textContent = 'barre: ' + value;
                draw();
            },
        });
        controls.append(barsLabel, barsSlider);
    }

    return el('div', {}, canvas, controls);
}

function drawCustomPlot(ctx: CanvasRenderingContext2D, width: number, height: number, plot: CustomPlot, xQuestion: Question, yQuestion: Question): void {
    const points = plot.points || [];
    const xNumeric = xQuestion.kind === 'dimension' || xQuestion.kind === 'opposition';
    const yNumeric = yQuestion.kind === 'dimension' || yQuestion.kind === 'opposition';

    if (xNumeric && yNumeric) {
        const xMin = xQuestion.kind === 'dimension' ? 0 : -1;
        const yMin = yQuestion.kind === 'dimension' ? 0 : -1;
        drawScatter2d(ctx, width, height, points as { x: number; y: number }[], xMin, 1, yMin, 1,
            xQuestion.minLabel || String(xMin), xQuestion.maxLabel || '1',
            yQuestion.minLabel || String(yMin), yQuestion.maxLabel || '1',
            xQuestion.title || '', yQuestion.title || '',
            plot.aggregate, plot.clusters);
    } else if (xNumeric && !yNumeric) {
        const xMin = xQuestion.kind === 'dimension' ? 0 : -1;
        const yChoices = (yQuestion as ChoiceQuestion).choices;
        drawBinnedStackedHistogram(ctx, width, height, xMin, 1, xQuestion.minLabel || String(xMin), xQuestion.maxLabel || '1', xQuestion.title || '', yChoices, points as { x: number; y: string }[], plot.bars);
    } else if (!xNumeric && yNumeric) {
        const xChoices = (xQuestion as ChoiceQuestion).choices;
        const yMin = yQuestion.kind === 'dimension' ? 0 : -1;
        drawAverageBarplot(ctx, width, height, xChoices, yMin, 1, yQuestion.minLabel || String(yMin), yQuestion.maxLabel || '1', yQuestion.title || '', xQuestion.title || '', points as { x: string; y: number }[]);
    } else {
        const xChoices = (xQuestion as ChoiceQuestion).choices;
        const yChoices = (yQuestion as ChoiceQuestion).choices;
        drawStackedHistogram(ctx, width, height, xChoices, yChoices, xQuestion.title || '', yQuestion.title || '', points as { x: string; y: string }[]);
    }
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
