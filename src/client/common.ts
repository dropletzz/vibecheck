// code shared by the frontend pages

import {
    ChoiceResult,
    DimensionQuestion,
    OppositionQuestion,
    Question,
    QuestionResult,
    Section,
    SliderResult,
    TextResult,
    VibecheckModel,
    validateVibecheck
} from '../common';
import { drawBarplot, drawContinuousDensity, drawDiscreteDensity, drawScatter1d } from './plot';

// tiny helper to build dom elements
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, any> = {},
    ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) continue;
        if (key === 'class') {
            node.className = String(value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2), value as EventListener);
        } else if (value === true) {
            node.setAttribute(key, '');
        } else if (value !== false) {
            node.setAttribute(key, String(value));
        }
    }
    node.append(...children.filter((child): child is Node | string => child !== null && child !== undefined));
    return node;
}

export function renderQuestion(question: Question): HTMLElement {
    const box = el('div', { class: 'question ' + question.kind });

    if (question.title) {
        box.append(el('h2', {}, question.title));
    }

    if (question.kind === 'dimension' || question.kind === 'opposition') {
        const options = {
            value: question.defaultValue ?? 0,
            step: 0.01,
            minLabel: question.minLabel || 'min',
            maxLabel: question.maxLabel || 'max',
        };
        box.append(question.kind === 'dimension'
            ? makeSlider({ ...options, min: 0, max: 1 })
            : makeSlider({ ...options, min: -1, max: 1, centered: true }));
    } else if (question.kind === 'text') {
        box.append(el('textarea', { rows: '2', maxlength: String(question.maxLength), placeholder: 'scrivi qui...' }));
    } else {
        box.append(el('div', {},
            ...question.choices.map((choice) => el('label', { class: 'check-row' },
                el('input', { type: question.multipleChoices ? 'checkbox' : 'radio', name: question.id, value: choice }),
                el('span', {}, choice || 'opzione vuota'),
            )),
        ));
    }
    return box;
}

export function sectionHeading(section: Section): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    if (section.title) nodes.push(el('h2', { class: 'section-title' }, section.title));
    if (section.description) nodes.push(el('p', { class: 'section-description' }, section.description));
    return nodes;
}

const MODELS_KEY = 'vibecheck.models';

export function loadModels(): VibecheckModel[] {
    try {
        const raw = localStorage.getItem(MODELS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const models: VibecheckModel[] = [];
        for (const model of parsed) {
            try {
                models.push(validateVibecheck(model));
            } catch {
                // skip invalid entries
            }
        }
        return models;
    } catch {
        return [];
    }
}

export function saveModels(models: VibecheckModel[]): boolean {
    try {
        localStorage.setItem(MODELS_KEY, JSON.stringify(models));
        return true;
    } catch {
        alert('spazio del browser esaurito: impossibile salvare i vibecheck');
        return false;
    }
}

export function elLoading(): HTMLElement {
    return el('div', { class: 'reconnect-overlay' },
        el('div', {}, 'un secondo',
            el('span', { class: 'reconnect-dots' },
                el('span', {}, '.'),
                el('span', {}, '.'),
                el('span', {}, '.'),
            ),
        ),
    );
}

export interface SliderOptions {
    value: number;
    min?: number;
    max?: number;
    centered?: boolean;
    step?: number;
    minLabel?: string;
    maxLabel?: string;
    onChange?: (value: number) => void;
    disabled?: boolean;
}

export interface SliderElement extends HTMLElement {
    value: number;
    disabled: boolean;
}

function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function makeSlider(options: SliderOptions): SliderElement {
    const centered = options.centered ?? false;
    const min = options.min ?? (centered ? -1 : 0);
    const max = options.max ?? 1;
    const step = options.step ?? 0.01;
    const center = (min + max) / 2;
    const snapThreshold = 0.05;
    const padding = 14;

    let value = clamp(options.value);
    let disabled = !!options.disabled;

    const container = el('div', { class: 'slider' + (centered ? ' slider-centered' : '') });

    if (options.minLabel !== undefined || options.maxLabel !== undefined) {
        container.append(el('div', { class: 'slider-labels' },
            el('span', {}, options.minLabel ?? ''),
            el('span', {}, options.maxLabel ?? ''),
        ));
    }

    const canvas = el('canvas');
    container.append(canvas);
    container.setAttribute('tabindex', disabled ? '-1' : '0');
    container.setAttribute('role', 'slider');
    container.setAttribute('aria-valuemin', String(min));
    container.setAttribute('aria-valuemax', String(max));
    container.setAttribute('aria-valuenow', String(value));

    function clamp(v: number): number {
        let result = Math.min(max, Math.max(min, v));
        if (step > 0) result = Math.round((result - min) / step) * step + min;
        result = Number(result.toFixed(4));
        if (centered && Math.abs(result - center) < snapThreshold) result = center;
        return result;
    }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) return;
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const trackColor = cssVar('--border') || '#ddd7c9';
        const fillColor = cssVar('--accent-strong') || '#6d95b8';
        const thumbColor = disabled ? (cssVar('--muted') || '#8b8579') : fillColor;

        const leftX = padding;
        const rightX = width - padding;
        const span = rightX - leftX;
        const trackY = height / 2;
        const thumbX = leftX + ((value - min) / (max - min)) * span;
        const fillStart = centered ? leftX + ((center - min) / (max - min)) * span : leftX;

        ctx.strokeStyle = trackColor;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(leftX, trackY);
        ctx.lineTo(rightX, trackY);
        ctx.stroke();

        if (Math.abs(thumbX - fillStart) > 0.5) {
            ctx.strokeStyle = fillColor;
            ctx.beginPath();
            ctx.moveTo(fillStart, trackY);
            ctx.lineTo(thumbX, trackY);
            ctx.stroke();
        }

        ctx.fillStyle = thumbColor;
        ctx.beginPath();
        ctx.arc(thumbX, trackY, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(thumbX, trackY, 9, 0, Math.PI * 2);
        ctx.stroke();
    }

    function setValue(v: number, user: boolean) {
        const next = clamp(v);
        if (next === value) return;
        value = next;
        container.setAttribute('aria-valuenow', String(value));
        draw();
        if (user && options.onChange) options.onChange(value);
    }

    function valueFromPointer(event: PointerEvent): number {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const ratio = Math.min(1, Math.max(0, (x - padding) / (rect.width - padding * 2)));
        return min + ratio * (max - min);
    }

    let dragging = false;
    canvas.addEventListener('pointerdown', (event) => {
        if (disabled) return;
        dragging = true;
        canvas.setPointerCapture(event.pointerId);
        setValue(valueFromPointer(event), true);
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        setValue(valueFromPointer(event), true);
    });
    const endDrag = (event: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    container.addEventListener('keydown', (event) => {
        if (disabled) return;
        let handled = true;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') setValue(value - step, true);
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') setValue(value + step, true);
        else if (event.key === 'Home') setValue(min, true);
        else if (event.key === 'End') setValue(max, true);
        else handled = false;
        if (handled) event.preventDefault();
    });

    Object.defineProperty(container, 'value', {
        get: () => value,
        set: (v: number) => setValue(v, false),
    });
    Object.defineProperty(container, 'disabled', {
        get: () => disabled,
        set: (d: boolean) => {
            disabled = !!d;
            container.classList.toggle('disabled', disabled);
            container.setAttribute('tabindex', disabled ? '-1' : '0');
            draw();
        },
    });

    if (disabled) container.classList.add('disabled');

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);

    draw();
    return container as unknown as SliderElement;
}

// ---------- results rendering (shared by presenter riepilogo and editor answers view) ----------

const DEFAULT_DENSITY_BARS = 7;
const MIN_DENSITY_BARS = 3;
const MAX_DENSITY_BARS = 37;
const DEFAULT_CLUSTERS = 5;
const MIN_CLUSTERS = 2;
const MAX_CLUSTERS = 10;
const HISTOGRAM_RATIO = 4 / 3;
const SCATTER_RATIO = 3 / 1;
const detailedQuestions = new Set<string>();
const revealedCensored = new Set<string>();
const textOrdering = new Map<string, 'count' | 'vote'>();
const densityBars = new Map<string, number>();
const clusterCounts = new Map<string, number>();
const numericPlotType = new Map<string, number>(); // 0 = scatter, 1 = discrete density, 2 = continuous density
const scatterAggregate = new Set<string>();

function getDensityBars(questionId: string): number {
    return densityBars.get(questionId) ?? DEFAULT_DENSITY_BARS;
}

function getClusterCount(questionId: string): number {
    return clusterCounts.get(questionId) ?? DEFAULT_CLUSTERS;
}

function getTextOrdering(questionId: string): 'count' | 'vote' | null {
    return textOrdering.get(questionId) ?? null;
}

export function renderResults(results: QuestionResult[], questions: Question[], rerender: () => void, onVote?: (questionId: string, text: string, direction: 1 | -1) => void, canVote?: (question: Question) => boolean, allowOrdering: boolean = true, onCensor?: (questionId: string, text: string) => void): HTMLElement[] {
    return results.map((result, index) => {
        const question = questions[index];
        if (!question) return el('div', {});
        const vote = onVote && (!canVote || canVote(question)) ? onVote : undefined;
        return renderResultCard(result, question, rerender, vote, allowOrdering, onCensor);
    });
}

function renderResultCard(result: QuestionResult, question: Question, rerender: () => void, onVote?: (questionId: string, text: string, direction: 1 | -1) => void, allowOrdering: boolean = true, onCensor?: (questionId: string, text: string) => void): HTMLElement {
    const isNumeric = result.kind === 'dimension' || result.kind === 'opposition';
    const isText = result.kind === 'text';

    const header = el('div', { class: 'result-header' });
    if (question.title) header.append(el('h2', {}, question.title));

    if (isNumeric) {
        header.append(
            el('div', { class: 'plot-nav' },
                el('button', { class: 'small', title: 'grafico precedente', onclick: () => cycleNumericPlot(question.id, -1, rerender) }, '←'),
                el('button', { class: 'small', title: 'grafico successivo', onclick: () => cycleNumericPlot(question.id, 1, rerender) }, '→'),
            ),
        );
    } else if (isText) {
        const expanded = detailedQuestions.has(question.id);
        const textResult = result as TextResult;
        if (textResult.answers.length > 0 || textResult.censored.length > 0) {
            header.append(el('button', { class: 'small', onclick: () => toggleDetailed(question.id, rerender) }, expanded ? 'nascondi' : 'mostra'));
        }
    } else {
        const detailed = detailedQuestions.has(question.id);
        header.append(el('button', { class: 'small', onclick: () => toggleDetailed(question.id, rerender) }, detailed ? 'riepilogo' : 'dettaglio'));
    }

    const card = el('div', { class: 'card', 'data-question-id': question.id }, header);
    if (isNumeric) {
        card.append(renderNumericPlot(result as SliderResult, question, rerender));
    } else if (isText) {
        const vote = onVote ? (text: string, direction: 1 | -1) => onVote(question.id, text, direction) : undefined;
        const censor = onCensor ? (text: string) => onCensor(question.id, text) : undefined;
        card.append(renderTextResult(result as TextResult, question, vote, question.id, rerender, allowOrdering, censor));
    } else {
        const detailed = detailedQuestions.has(question.id);
        card.append(detailed ? renderChoiceDetailed(result as ChoiceResult, question) : renderChoiceSummary(result as ChoiceResult, question));
    }
    return card;
}

function findTextResult(results: QuestionResult[] | null, questions: Question[], questionId: string): TextResult | null {
    if (!results) return null;
    const index = questions.findIndex((q) => q.id === questionId);
    if (index < 0) return null;
    const result = results[index];
    return result && result.kind === 'text' ? result : null;
}

export function applyVoteDelta(results: QuestionResult[] | null, questions: Question[], questionId: string, text: string, score: number, myVote?: 1 | -1 | null): boolean {
    const result = findTextResult(results, questions, questionId);
    if (!result) return false;
    result.scores[text] = score;
    if (myVote !== undefined) {
        if (myVote === null) delete result.myVotes[text];
        else result.myVotes[text] = myVote;
    }
    return true;
}

export function applyCensorDelta(results: QuestionResult[] | null, questions: Question[], questionId: string, text: string, trackCensored: boolean = true): boolean {
    const result = findTextResult(results, questions, questionId);
    if (!result) return false;
    let count = 0;
    result.answers = result.answers.filter((answer) => {
        if (answer === text) {
            count++;
            return false;
        }
        return true;
    });
    delete result.scores[text];
    delete result.myVotes[text];
    if (trackCensored) {
        const existing = result.censored.find((entry) => entry.text === text);
        if (existing) existing.count += count;
        else if (count > 0) result.censored.push({ text, count });
    }
    return true;
}

export function rerenderQuestionCard(
    results: QuestionResult[] | null,
    questions: Question[],
    questionId: string,
    rerender: () => void,
    onVote?: (questionId: string, text: string, direction: 1 | -1) => void,
    canVote?: (question: Question) => boolean,
    allowOrdering: boolean = true,
    onCensor?: (questionId: string, text: string) => void,
): void {
    if (!results) return;
    // only re-render when the answers are visible
    if (!detailedQuestions.has(questionId)) return;

    const index = questions.findIndex((q) => q.id === questionId);
    if (index < 0) return;
    const result = results[index];
    if (!result || result.kind !== 'text') return;

    const cardEl = document.querySelector(`[data-question-id="${CSS.escape(questionId)}"]`) as HTMLElement | null;
    if (!cardEl) return;
    const answers = cardEl.querySelector('.text-answers') as HTMLElement | null;
    if (!answers) return;

    const question = questions[index];
    const vote = onVote && (!canVote || canVote(question)) ? (text: string, direction: 1 | -1) => onVote(questionId, text, direction) : undefined;
    const censor = onCensor ? (text: string) => onCensor(questionId, text) : undefined;

    const previous = new Map<string, DOMRect>();
    answers.querySelectorAll('.answer-box[data-key]').forEach((node) => {
        const box = node as HTMLElement;
        const key = box.dataset.key || '';
        if (key) previous.set(key, box.getBoundingClientRect());
    });

    answers.replaceChildren(...buildAnswersContent(result, questionId, rerender, vote, censor));

    answers.querySelectorAll('.answer-box[data-key]').forEach((node) => {
        const box = node as HTMLElement;
        const key = box.dataset.key || '';
        const old = previous.get(key);
        if (!old) return;
        const now = box.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        box.animate(
            [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0, 0)' },
            ],
            { duration: 350, easing: 'ease-out' },
        );
    });
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

function cycleNumericPlot(questionId: string, delta: number, rerender: () => void) {
    const current = numericPlotType.get(questionId) ?? 0;
    numericPlotType.set(questionId, (current + delta + 3) % 3);
    rerender();
}

function renderNumericPlot(result: SliderResult, question: Question, rerender: () => void): HTMLElement {
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
        const barsSlider = makeSlider({
            value: bars,
            min: MIN_DENSITY_BARS,
            max: MAX_DENSITY_BARS,
            step: 2,
            onChange: (newBars) => {
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
                    rerender();
                },
            }),
            el('span', {}, 'aggrega'),
        ));

        if (aggregate) {
            const clustersLabel = el('label', {}, 'numero punti: ' + clusters);
            const clustersSlider = makeSlider({
                value: clusters,
                min: MIN_CLUSTERS,
                max: MAX_CLUSTERS,
                step: 1,
                onChange: (newK) => {
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

function toggleDetailed(questionId: string, rerender: () => void) {
    if (detailedQuestions.has(questionId)) detailedQuestions.delete(questionId);
    else detailedQuestions.add(questionId);
    rerender();
}

function buildOrderButtons(question: Question, questionId: string, rerender: (() => void) | undefined, allowOrdering: boolean): HTMLElement | null {
    if (!allowOrdering) return null;
    const mode = getTextOrdering(questionId);
    const votable = question.kind === 'text' && !!question.votable;

    const toggleOrder = (next: 'count' | 'vote') => {
        if (textOrdering.get(questionId) === next) textOrdering.delete(questionId);
        else textOrdering.set(questionId, next);
        if (rerender) rerender();
    };

    const orderButtons = el('div', { class: 'text-order' },
        el('span', {}, 'ordina per '),
        el('button', {
            class: 'small' + (mode === 'count' ? ' active' : ''),
            onclick: () => toggleOrder('count'),
        }, 'conteggio'),
    );
    if (votable) {
        orderButtons.append(el('button', {
            class: 'small' + (mode === 'vote' ? ' active' : ''),
            onclick: () => toggleOrder('vote'),
        }, 'voto'));
    }
    return orderButtons;
}

function buildAnswersContent(result: TextResult, questionId: string, rerender: (() => void) | undefined, onVote: ((text: string, direction: 1 | -1) => void) | undefined, onCensor: ((text: string) => void) | undefined): HTMLElement[] {
    const groups = groupTextAnswers(result);
    const mode = getTextOrdering(questionId);
    const ordered = mode ? orderTextGroups(groups, mode) : groups;

    const children: HTMLElement[] = [];
    children.push(...renderTextBoxes(ordered, onVote, questionId, onCensor));

    const censoredBlock = renderCensoredBlock(result.censored, questionId, rerender);
    if (censoredBlock) children.push(censoredBlock);

    return children;
}

function renderTextResult(result: TextResult, question: Question, onVote?: (text: string, direction: 1 | -1) => void, questionId?: string, rerender?: () => void, allowOrdering: boolean = true, onCensor?: (text: string) => void): HTMLElement {
    const groups = groupTextAnswers(result);
    if (groups.length === 0 && result.censored.length === 0) return el('p', { class: 'muted' }, 'nessuna risposta');

    const id = questionId ?? '';
    if (!detailedQuestions.has(id)) return el('div', {});

    const children: HTMLElement[] = [];
    const orderButtons = buildOrderButtons(question, id, rerender, allowOrdering);
    if (orderButtons) children.push(orderButtons);
    children.push(el('div', { class: 'text-answers' }, ...buildAnswersContent(result, id, rerender, onVote, onCensor)));

    return el('div', { class: 'text-results detailed' }, ...children);
}

function renderTextBoxes(groups: { text: string; count: number; score: number; myVote: 1 | -1 | undefined }[], onVote?: (text: string, direction: 1 | -1) => void, questionId?: string, onCensor?: (text: string) => void): HTMLElement[] {
    return groups.map((group) => {
        const key = (questionId ?? '') + '\u0000' + group.text;
        if (onVote) {
            const box = el('div', { class: 'answer-box has-vote' + (group.myVote === 1 ? ' voted-up' : group.myVote === -1 ? ' voted-down' : ''), 'data-key': key });
            if (group.count > 1) box.append(el('span', { class: 'answer-count' }, 'conteggio: ' + group.count));
            box.append(el('span', {}, group.text));
            box.append(el('div', { class: 'vote' },
                el('button', { class: 'small vote-up' + (group.myVote === 1 ? ' active' : ''), onclick: () => onVote(group.text, 1) }, '▲'),
                el('button', { class: 'small vote-down' + (group.myVote === -1 ? ' active' : ''), onclick: () => onVote(group.text, -1) }, '▼'),
            ));
            return box;
        }
        const box = el('div', { class: 'answer-box with-score' + (group.score > 0 ? ' voted-up' : group.score < 0 ? ' voted-down' : ''), 'data-key': key });
        box.append(el('span', { class: 'answer-count' }, 'conteggio: ' + group.count));
        box.append(el('span', { class: 'answer-text' }, group.text));
        if (group.score !== 0) box.append(el('span', { class: 'vote-score' }, (group.score > 0 ? '+' : '') + group.score));
        if (onCensor) box.append(el('button', { class: 'small danger censor-x', title: 'censura risposta', onclick: () => onCensor(group.text) }, '✕'));
        return box;
    });
}

function renderCensoredBlock(censored: { text: string; count: number }[], questionId: string, rerender?: () => void): HTMLElement | null {
    if (censored.length === 0) return null;
    const total = censored.reduce((sum, entry) => sum + entry.count, 0);
    const revealed = revealedCensored.has(questionId);
    const toggle = () => {
        if (revealedCensored.has(questionId)) revealedCensored.delete(questionId);
        else revealedCensored.add(questionId);
        if (rerender) rerender();
    };

    const block = el('div', { class: 'censored-block' },
        el('div', { class: 'censored-header' },
            el('span', { class: 'muted' }, 'censurate: ' + total),
            el('button', { class: 'small', onclick: toggle }, revealed ? 'nascondi' : 'mostra'),
        ),
    );
    if (revealed) {
        const answers = el('div', { class: 'text-results' });
        for (const entry of censored) {
            answers.append(el('div', { class: 'answer-box with-score censored-answer' },
                el('span', { class: 'answer-count' }, 'conteggio: ' + entry.count),
                el('span', { class: 'answer-text' }, entry.text),
            ));
        }
        block.append(answers);
    }
    return block;
}

function groupTextAnswers(result: TextResult): { text: string; count: number; score: number; myVote: 1 | -1 | undefined }[] {
    const counts = new Map<string, number>();
    for (const answer of result.answers) {
        counts.set(answer, (counts.get(answer) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([text, count]) => ({
        text,
        count,
        score: result.scores[text] || 0,
        myVote: result.myVotes[text],
    }));
}

function orderTextGroups(groups: { text: string; count: number; score: number; myVote: 1 | -1 | undefined }[], mode: 'count' | 'vote') {
    if (mode === 'vote') {
        return groups.sort((a, b) => b.score - a.score || b.count - a.count || a.text.localeCompare(b.text));
    }
    return groups.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
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



