// code shared by the frontend pages

import { Question, VibecheckModel } from '../common';

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

// renders a question the way the participant will see it
// (used both by the preview and by the live answering pages)
export function renderQuestion(question: Question): HTMLElement {
    const card = el('div', { class: 'card question ' + question.kind },
        el('h2', {}, question.title || 'senza titolo'),
    );

    if (question.kind === 'dimension' || question.kind === 'opposition') {
        card.append(
            el('div', { class: 'slider-labels' },
                el('span', {}, question.minLabel || 'min'),
                el('span', {}, question.maxLabel || 'max'),
            ),
            el('input', {
                type: 'range',
                min: question.kind === 'dimension' ? '0' : '-1',
                max: '1',
                step: '0.01',
                value: String(0),
            }),
        );
    } else if (question.kind === 'text') {
        card.append(el('textarea', { rows: '2', maxlength: String(question.maxLength), placeholder: 'scrivi qui...' }));
    } else {
        card.append(el('div', {},
            ...question.choices.map((choice) => el('label', { class: 'check-row' },
                el('input', { type: question.multiple ? 'checkbox' : 'radio', name: question.id }),
                el('span', {}, choice || 'opzione vuota'),
            )),
        ));
    }
    return card;
}

const MODELS_KEY = 'vibecheck.models';

export function loadModels(): VibecheckModel[] {
    try {
        const raw = localStorage.getItem(MODELS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
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
