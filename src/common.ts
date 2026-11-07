export interface VibecheckModel {
    id: string;
    name: string;
    questions: Question[];
}

export type Question =
    | DimensionQuestion
    | OppositionQuestion
    | TextQuestion
    | ChoiceQuestion;

interface BaseQuestion {
    id: string;
    title: string;
}

export interface DimensionQuestion extends BaseQuestion {
    kind: 'dimension';
    minLabel: string;
    maxLabel: string;
}

export interface OppositionQuestion extends BaseQuestion {
    kind: 'opposition';
    minLabel: string;
    maxLabel: string;
}

export interface TextQuestion extends BaseQuestion {
    kind: 'text';
    maxLength: number; // 1..1000
    multiple: boolean; // more than one answer per person
}

export interface ChoiceQuestion extends BaseQuestion {
    kind: 'choice';
    multiple: boolean;
    choices: string[];
}

export function makeId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function makeVibecheck(): VibecheckModel {
    return { id: makeId(), name: '', questions: [] };
}

export function makeQuestion(kind: Question['kind']): Question {
    switch (kind) {
        case 'dimension':
            return { id: makeId(), kind, title: '', minLabel: '', maxLabel: '' };
        case 'opposition':
            return { id: makeId(), kind, title: '', minLabel: '', maxLabel: '' };
        case 'text':
            return { id: makeId(), kind, title: '', maxLength: 200, multiple: false };
        case 'choice':
            return { id: makeId(), kind, title: '', multiple: false, choices: ['', ''] };
    }
}
