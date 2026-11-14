import { el, renderQuestion } from '../common';
import { ChoiceResult, ClientMessage, Question, QuestionResult, PresenterState, ServerMessage, SliderResult, SummaryState, TextResult } from '../../common';
import { drawBarplot, drawContinuousDensity, drawDiscreteDensity, drawScatter1d } from '../plot';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id') || '';
const nonce = localStorage.getItem('vibecheck.nonce.' + sessionId) || '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${window.location.host}/?session=${encodeURIComponent(sessionId)}&role=presenter&nonce=${encodeURIComponent(nonce)}`);

let state: PresenterState | null = null;
let terminated = false;
let showQuestions = false;
let summaryState: SummaryState | null = null;

const DEFAULT_DENSITY_BARS = 7;
const MIN_DENSITY_BARS = 3;
const MAX_DENSITY_BARS = 37;
const DEFAULT_CLUSTERS = 5;
const MIN_CLUSTERS = 2;
const MAX_CLUSTERS = 10;
const HISTOGRAM_RATIO = 4 / 3;
const SCATTER_RATIO = 3 / 1;
let detailedQuestions = new Set<string>();
let densityBars = new Map<string, number>();
let clusterCounts = new Map<string, number>();
let numericPlotType = new Map<string, number>(); // 0 = scatter, 1 = discrete density, 2 = continuous density
let scatterAggregate = new Set<string>();

function getDensityBars(questionId: string): number {
    return densityBars.get(questionId) ?? DEFAULT_DENSITY_BARS;
}

function getClusterCount(questionId: string): number {
    return clusterCounts.get(questionId) ?? DEFAULT_CLUSTERS;
}

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
        } else if (message.type === 'summary') {
            summaryState = message.summary;
            render();
        }
    } catch {}
});

socket.addEventListener('close', () => {
    if (!terminated) {
        document.body.replaceChildren(renderConnectionError());
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

function renderConnectionError(): HTMLElement {
    return el('main', {},
        el('p', { class: 'empty' }, 'sembra ci siano problemi di connessione'),
        el('div', { class: 'home-actions' },
            el('button', { class: 'big', onclick: () => window.location.reload() }, 'ricarica la pagina'),
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
        children.push(el('div', {}, ...renderResults(section.results, section.section.questions)));
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
        state.phase === 'results'
            ? (lastSection
                ? el('button', { class: 'big', onclick: () => send({ type: 'summary' }) }, 'riepilogo')
                : el('button', { class: 'big', onclick: () => send({ type: 'set-section', index: state.sectionIndex + 1 }) }, 'avanti →'))
            : el('div', {}),
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

function toggleDetailed(questionId: string) {
    if (detailedQuestions.has(questionId)) detailedQuestions.delete(questionId);
    else detailedQuestions.add(questionId);
    render();
}

function renderResults(results: QuestionResult[], questions: Question[]): HTMLElement[] {
    return results.map((result, index) => {
        const question = questions[index];
        if (!question) return el('div', {});
        return renderResultCard(result, question);
    });
}

function renderResultCard(result: QuestionResult, question: Question): HTMLElement {
    const isNumeric = result.kind === 'dimension' || result.kind === 'opposition';
    const header = el('div', { class: 'result-header' });
    if (question.title) header.append(el('h2', {}, question.title));

    if (isNumeric) {
        header.append(
            el('div', { class: 'plot-nav' },
                el('button', { class: 'small', title: 'grafico precedente', onclick: () => cycleNumericPlot(question.id, -1) }, '←'),
                el('button', { class: 'small', title: 'grafico successivo', onclick: () => cycleNumericPlot(question.id, 1) }, '→'),
            ),
        );
    } else {
        const detailed = detailedQuestions.has(question.id);
        const toggle = getToggleLabels(result);
        if (toggle) {
            header.append(el('button', { class: 'small', onclick: () => toggleDetailed(question.id) }, detailed ? toggle.close : toggle.open));
        }
    }

    const card = el('div', { class: 'card' }, header);
    if (isNumeric) {
        card.append(renderNumericPlot(result as SliderResult, question));
    } else {
        const detailed = detailedQuestions.has(question.id);
        card.append(detailed ? renderDetailed(result, question) : renderSummary(result, question));
    }
    return card;
}

function getToggleLabels(result: QuestionResult): { open: string; close: string } | null {
    if (result.kind === 'text') {
        return groupAnswers(result.answers).length > 3 ? { open: 'espandi', close: 'riduci' } : null;
    }
    if (result.kind === 'choice') {
        return { open: 'dettaglio', close: 'riepilogo' };
    }
    return null;
}

function renderSummary(result: QuestionResult, question: Question): HTMLElement {
    if (result.kind === 'choice') return renderChoiceSummary(result, question);
    if (result.kind === 'text') return renderTextSummary(result);
    return el('div', {});
}

function renderDetailed(result: QuestionResult, question: Question): HTMLElement {
    if (result.kind === 'choice') return renderChoiceDetailed(result, question);
    if (result.kind === 'text') return renderTextDetailed(result);
    return el('div', {});
}

function createResultCanvas(aspectRatio: number, draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): HTMLCanvasElement {
    const canvas = el('canvas', { class: 'result-canvas' });
    canvas.width = 400;
    canvas.height = Math.round(400 / aspectRatio);

    requestAnimationFrame(() => {
        if (!canvas.isConnected) return;
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth;
        const cssHeight = Math.round(cssWidth / aspectRatio);
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(ctx, cssWidth, cssHeight);
    });

    return canvas;
}

function cycleNumericPlot(questionId: string, delta: number) {
    const current = numericPlotType.get(questionId) ?? 0;
    numericPlotType.set(questionId, (current + delta + 3) % 3);
    render();
}

function renderNumericPlot(result: SliderResult, question: Question): HTMLElement {
    const min = result.kind === 'dimension' ? 0 : -1;
    const sliderQuestion = question.kind === 'dimension' || question.kind === 'opposition' ? question : null;
    const minLabel = sliderQuestion?.minLabel || String(min);
    const maxLabel = sliderQuestion?.maxLabel || '1';
    const type = numericPlotType.get(question.id) ?? 0;
    const bars = getDensityBars(question.id);
    const aggregate = scatterAggregate.has(question.id);
    const clusters = getClusterCount(question.id);
    const ratio = type === 0 ? SCATTER_RATIO : HISTOGRAM_RATIO;

    const canvas = el('canvas', { class: 'result-canvas' });
    canvas.width = 400;
    canvas.height = Math.round(400 / ratio);

    const draw = (barsArg: number, kArg: number) => {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.getBoundingClientRect().width;
        const cssHeight = Math.round(cssWidth / ratio);
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (type === 0) {
            drawScatter1d(ctx, cssWidth, cssHeight, result.values, min, 1, minLabel, maxLabel, aggregate, kArg);
        } else if (type === 1) {
            drawDiscreteDensity(ctx, cssWidth, cssHeight, result.values, min, 1, minLabel, maxLabel, barsArg);
        } else {
            drawContinuousDensity(ctx, cssWidth, cssHeight, result.values, min, 1, minLabel, maxLabel);
        }
    };

    requestAnimationFrame(() => {
        if (canvas.isConnected) draw(bars, clusters);
    });

    const children: HTMLElement[] = [canvas];

    if (type === 1) {
        const barsLabel = el('label', {}, 'barre: ' + bars);
        const barsSlider = el('input', {
            type: 'range',
            min: String(MIN_DENSITY_BARS),
            max: String(MAX_DENSITY_BARS),
            value: String(bars),
            oninput: () => {
                const newBars = Number(barsSlider.value);
                densityBars.set(question.id, newBars);
                barsLabel.textContent = 'barre: ' + newBars;
                draw(newBars, clusters);
            },
        });
        children.push(barsLabel, barsSlider);
    }

    if (type === 0) {
        children.push(el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: aggregate || null,
                onchange: () => {
                    if (scatterAggregate.has(question.id)) scatterAggregate.delete(question.id);
                    else scatterAggregate.add(question.id);
                    render();
                },
            }),
            el('span', {}, 'aggrega'),
        ));

        if (aggregate) {
            const clustersLabel = el('label', {}, 'numero punti: ' + clusters);
            const clustersSlider = el('input', {
                type: 'range',
                min: String(MIN_CLUSTERS),
                max: String(MAX_CLUSTERS),
                value: String(clusters),
                oninput: () => {
                    const newK = Number(clustersSlider.value);
                    clusterCounts.set(question.id, newK);
                    clustersLabel.textContent = 'numero punti: ' + newK;
                    draw(bars, newK);
                },
            });
            children.push(clustersLabel, clustersSlider);
        }
    }

    return el('div', {}, ...children);
}

function renderTextSummary(result: TextResult): HTMLElement {
    const groups = groupAnswers(result.answers);
    if (groups.length === 0) return el('p', { class: 'muted' }, 'nessuna risposta');
    const nodes = renderTextBoxes(groups.slice(0, 3));
    if (groups.length > 3) nodes.push(el('div', { class: 'muted' }, '...'));
    return el('div', { class: 'text-results' }, ...nodes);
}

function renderTextDetailed(result: TextResult): HTMLElement {
    const groups = groupAnswers(result.answers);
    if (groups.length === 0) return el('p', { class: 'muted' }, 'nessuna risposta');
    return el('div', { class: 'text-results' }, ...renderTextBoxes(groups));
}

function renderTextBoxes(groups: { text: string; count: number }[]): HTMLElement[] {
    return groups.map((group) => {
        const box = el('div', { class: 'answer-box' });
        if (group.count > 1) box.append(el('span', { class: 'answer-count' }, String(group.count)));
        box.append(el('span', {}, group.text));
        return box;
    });
}

function groupAnswers(answers: string[]): { text: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const answer of answers) {
        counts.set(answer, (counts.get(answer) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count);
}

function orderedChoiceEntries(result: ChoiceResult, question: Question): [string, number][] {
    const choices = question.kind === 'choice' ? question.choices : [];
    return choices.map((choice) => [choice, result.counts[choice] || 0] as [string, number]);
}

function renderChoiceSummary(result: ChoiceResult, question: Question): HTMLElement {
    const entries = orderedChoiceEntries(result, question);
    if (entries.length === 0) return el('p', { class: 'muted' }, 'nessuna risposta');
    return el('div', { class: 'chips' },
        ...entries.map(([choice, count]) => {
            const label = choice.length > 20 ? choice.slice(0, 20) + '…' : choice;
            return el('span', { class: 'chip' }, label + ' (' + count + ')');
        }),
    );
}

function renderChoiceDetailed(result: ChoiceResult, question: Question): HTMLElement {
    const entries = orderedChoiceEntries(result, question);
    if (entries.length === 0) return el('p', { class: 'muted' }, 'nessuna risposta');
    return createResultCanvas(400 / (entries.length * 36), (ctx, width, height) => {
        drawBarplot(ctx, width, height, entries);
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
