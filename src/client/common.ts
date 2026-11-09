// code shared by the frontend pages

import { makeId, Question, Section, VibecheckModel } from '../common';

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
    const box = el('div', { class: 'question ' + question.kind });

    if (question.title) {
        box.append(el('h2', {}, question.title));
    }

    if (question.kind === 'dimension' || question.kind === 'opposition') {
        const sliderBox = el('div', { class: 'slider-box' },
            el('div', { class: 'slider-labels' },
                el('span', {}, question.minLabel || 'min'),
                el('span', {}, question.maxLabel || 'max'),
            ),
        );
        const range = el('input', {
            type: 'range',
            min: question.kind === 'dimension' ? '0' : '-1',
            max: '1',
            step: '0.01',
            value: String(question.defaultValue ?? 0),
        });
        if (question.kind === 'opposition') {
            // snap to the middle (0) when the slider gets close to it
            range.addEventListener('input', () => {
                if (Math.abs(Number(range.value)) < 0.05) range.value = '0';
            });
        }
        sliderBox.append(range);
        box.append(sliderBox);
    } else if (question.kind === 'text') {
        box.append(el('textarea', { rows: '2', maxlength: String(question.maxLength), placeholder: 'scrivi qui...' }));
    } else {
        box.append(el('div', {},
            ...question.choices.map((choice) => el('label', { class: 'check-row' },
                el('input', { type: question.multiple ? 'checkbox' : 'radio', name: question.id, value: choice }),
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
                models.push(normalizeVibecheck(model));
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

// ---------- import / normalization ----------

// makes a VibecheckModel out of raw json data (from a file or from localStorage)
// legacy models without sections get their questions wrapped in a single section
export function normalizeVibecheck(raw: any): VibecheckModel {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') {
        throw new Error('invalid vibecheck');
    }
    let sections: any[];
    if (Array.isArray(raw.sections)) {
        sections = raw.sections;
    } else if (Array.isArray(raw.questions)) {
        sections = [{ id: makeId(), title: '', questions: raw.questions }];
    } else {
        sections = [];
    }
    return {
        id: typeof raw.id === 'string' ? raw.id : makeId(),
        name: raw.name,
        sections: sections.map(normalizeSection),
    };
}

export function normalizeSection(raw: any): Section {
    if (!raw || typeof raw !== 'object') throw new Error('invalid section');
    return {
        id: typeof raw.id === 'string' ? raw.id : makeId(),
        title: typeof raw.title === 'string' ? raw.title : '',
        questions: Array.isArray(raw.questions) ? raw.questions.map(normalizeQuestion) : [],
    };
}

export function normalizeQuestion(raw: any): Question {
    if (!raw || typeof raw !== 'object') throw new Error('invalid question');
    const base = {
        id: typeof raw.id === 'string' ? raw.id : makeId(),
        title: typeof raw.title === 'string' ? raw.title : '',
    };
    switch (raw.kind) {
        case 'dimension':
        case 'opposition':
            return {
                ...base,
                kind: raw.kind,
                minLabel: typeof raw.minLabel === 'string' ? raw.minLabel : '',
                maxLabel: typeof raw.maxLabel === 'string' ? raw.maxLabel : '',
                defaultValue: typeof raw.defaultValue === 'number' ? raw.defaultValue : 0,
            };
        case 'text': {
            const maxLength = Number(raw.maxLength);
            const clamped = Number.isFinite(maxLength)
                ? Math.min(1000, Math.max(1, Math.round(maxLength)))
                : 200;
            return { ...base, kind: raw.kind, maxLength: clamped, multiple: raw.multiple === true };
        }
        case 'choice':
            return {
                ...base,
                kind: raw.kind,
                multiple: raw.multiple === true,
                choices: Array.isArray(raw.choices)
                    ? raw.choices.filter((choice: any) => typeof choice === 'string')
                    : [],
            };
        default:
            throw new Error('invalid question kind');
    }
}
