// code shared by the frontend pages

import {
    Question,
    DimensionQuestion,
    OppositionQuestion,
    VibecheckModel,
    validateVibecheck
} from '../common';

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



