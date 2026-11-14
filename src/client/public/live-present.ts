import { el, renderQuestion } from '../common';
import { ChoiceResult, ClientMessage, Question, QuestionResult, PresenterState, ServerMessage, SliderResult, SummaryState, TextResult } from '../../common';

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
const HISTOGRAM_RATIO = 4 / 3;
let detailedQuestions = new Set<string>();
let densityBars = new Map<string, number>();

function getDensityBars(questionId: string): number {
    return densityBars.get(questionId) ?? DEFAULT_DENSITY_BARS;
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

function getCssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderResults(results: QuestionResult[], questions: Question[]): HTMLElement[] {
    return results.map((result, index) => {
        const question = questions[index];
        if (!question) return el('div', {});
        return renderResultCard(result, question);
    });
}

function renderResultCard(result: QuestionResult, question: Question): HTMLElement {
    const detailed = detailedQuestions.has(question.id);
    const header = el('div', { class: 'result-header' });
    if (question.title) header.append(el('h2', {}, question.title));

    const toggle = getToggleLabels(result);
    if (toggle) {
        header.append(el('button', { class: 'small', onclick: () => toggleDetailed(question.id) }, detailed ? toggle.close : toggle.open));
    }

    const card = el('div', { class: 'card' }, header);
    card.append(detailed ? renderDetailed(result, question) : renderSummary(result, question));
    return card;
}

function getToggleLabels(result: QuestionResult): { open: string; close: string } | null {
    if (result.kind === 'text') {
        return groupAnswers(result.answers).length > 3 ? { open: 'espandi', close: 'riduci' } : null;
    }
    return { open: 'dettaglio', close: 'riepilogo' };
}

function renderSummary(result: QuestionResult, question: Question): HTMLElement {
    if (result.kind === 'dimension' || result.kind === 'opposition') {
        const sliderQuestion = question.kind === 'dimension' || question.kind === 'opposition' ? question : null;
        return el('div', {},
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
    }
    if (result.kind === 'choice') return renderChoiceSummary(result, question);
    if (result.kind === 'text') return renderTextSummary(result);
    return el('div', {});
}

function renderDetailed(result: QuestionResult, question: Question): HTMLElement {
    if (result.kind === 'dimension' || result.kind === 'opposition') {
        return renderSliderDetailed(result, question);
    }
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

function renderSliderDetailed(result: SliderResult, question: Question): HTMLElement {
    const min = result.kind === 'dimension' ? 0 : -1;
    const sliderQuestion = question.kind === 'dimension' || question.kind === 'opposition' ? question : null;
    const minLabel = sliderQuestion?.minLabel || String(min);
    const maxLabel = sliderQuestion?.maxLabel || '1';

    const canvas = el('canvas', { class: 'result-canvas' });
    canvas.width = 400;
    canvas.height = Math.round(400 / HISTOGRAM_RATIO);

    const draw = (bars: number) => {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth;
        const cssHeight = Math.round(cssWidth / HISTOGRAM_RATIO);
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawDiscreteDensity(ctx, cssWidth, cssHeight, result.values, min, 1, minLabel, maxLabel, bars);
    };

    const initialBars = getDensityBars(question.id);
    requestAnimationFrame(() => {
        if (canvas.isConnected) draw(initialBars);
    });

    const barsLabel = el('label', {}, 'barre: ' + initialBars);
    const barsSlider = el('input', {
        type: 'range',
        min: String(MIN_DENSITY_BARS),
        max: String(MAX_DENSITY_BARS),
        value: String(initialBars),
        oninput: () => {
            const bars = Number(barsSlider.value);
            densityBars.set(question.id, bars);
            barsLabel.textContent = 'barre: ' + bars;
            draw(bars);
        },
    });

    return el('div', {},
        canvas,
        barsLabel,
        barsSlider,
    );
}

function drawDiscreteDensity(ctx: CanvasRenderingContext2D, width: number, height: number, values: number[], min: number, max: number, minLabel: string, maxLabel: string, bars: number) {
    ctx.clearRect(0, 0, width, height);

    const binWidth = (max - min) / bars;
    const counts = new Array(bars).fill(0);
    for (const value of values) {
        let index = Math.floor((value - min) / binWidth);
        if (index < 0) index = 0;
        if (index >= bars) index = bars - 1;
        counts[index]++;
    }
    const maxCount = Math.max(1, ...counts);
    const total = values.length;

    const color = getCssVar('--accent-strong') || '#6d95b8';
    const axisColor = '#000000';
    const fontFamily = getCssVar('--main-font') || 'sans-serif';

    const avgDotRadius = 6;
    const topPadding = 16;
    const bottomPadding = 26;
    const sidePadding = avgDotRadius + 2;

    const plotBottom = height - bottomPadding;
    const plotHeight = plotBottom - topPadding;
    const plotWidth = width - sidePadding * 2;
    const barWidth = plotWidth / bars;

    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
        const barHeight = (counts[i] / maxCount) * plotHeight;
        const x = sidePadding + i * barWidth;
        const y = plotBottom - barHeight;
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barWidth, barHeight);

        if (counts[i] > 0) {
            const percent = Math.round((counts[i] / total) * 100);
            ctx.fillStyle = axisColor;
            ctx.font = '13px ' + fontFamily;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(percent + '%', x + barWidth / 2, y - 2);
            ctx.fillStyle = color;
        }
    }

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sidePadding, plotBottom);
    ctx.lineTo(width - sidePadding, plotBottom);
    ctx.stroke();

    const tickLength = 5;
    ctx.beginPath();
    for (const x of [sidePadding, width / 2, width - sidePadding]) {
        ctx.moveTo(x, plotBottom);
        ctx.lineTo(x, plotBottom + tickLength);
    }
    ctx.stroke();

    ctx.fillStyle = axisColor;
    ctx.font = '14px ' + fontFamily;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(minLabel, sidePadding, plotBottom + tickLength + 4);
    ctx.textAlign = 'right';
    ctx.fillText(maxLabel, width - sidePadding, plotBottom + tickLength + 4);

    const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : min;
    const dotX = sidePadding + ((average - min) / (max - min)) * plotWidth;
    ctx.beginPath();
    ctx.arc(dotX, plotBottom, avgDotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.stroke();
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

function drawBarplot(ctx: CanvasRenderingContext2D, width: number, height: number, entries: [string, number][]) {
    ctx.clearRect(0, 0, width, height);

    const rowHeight = height / entries.length;
    const maxCount = Math.max(1, ...entries.map(([, count]) => count));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const barColor = getCssVar('--accent-strong') || '#6d95b8';
    const textColor = getCssVar('--text') || '#33302a';
    const fontFamily = getCssVar('--main-font') || 'sans-serif';
    const labelWidth = 110;
    const rightSpace = 56;

    entries.forEach(([label, count], i) => {
        const y = i * rowHeight;
        const barHeight = rowHeight * 0.55;
        const barWidth = (count / maxCount) * (width - labelWidth - rightSpace);
        const barY = y + (rowHeight - barHeight) / 2;

        ctx.fillStyle = barColor;
        ctx.fillRect(labelWidth, barY, barWidth > 0 ? barWidth : 1, barHeight);

        ctx.fillStyle = textColor;
        ctx.font = '14px ' + fontFamily;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const shortLabel = label.length > 12 ? label.slice(0, 12) + '…' : label;
        ctx.fillText(shortLabel, labelWidth - 8, y + rowHeight / 2);

        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        ctx.textAlign = 'left';
        ctx.fillText(percent + '%', labelWidth + barWidth + 6, y + rowHeight / 2);
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
