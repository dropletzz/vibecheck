// code shared between the client and the server

export interface VibecheckModel {
    id: string;
    name: string;
    sections: Section[];
}

export interface Section {
    id: string;
    title: string; // optional: an empty title is not shown
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
    defaultValue: number;
}

export interface OppositionQuestion extends BaseQuestion {
    kind: 'opposition';
    minLabel: string;
    maxLabel: string;
    defaultValue: number;
}

export interface TextQuestion extends BaseQuestion {
    kind: 'text';
    maxLength: number; // 1..1000
    multipleAnswers: boolean; // more than one answer per person
    maxAnswers: number; // 2..42, used when multipleAnswers
}

export interface ChoiceQuestion extends BaseQuestion {
    kind: 'choice';
    multipleChoices: boolean;
    maxAnswers: number; // 2..42, used when multipleChoices
    choices: string[];
}

export function makeId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function makeVibecheck(): VibecheckModel {
    return { id: makeId(), name: '', sections: [makeSection()] };
}

export function makeSection(): Section {
    return { id: makeId(), title: '', questions: [] };
}

export function makeQuestion(kind: Question['kind']): Question {
    switch (kind) {
        case 'dimension':
            return { id: makeId(), kind, title: '', minLabel: '0', maxLabel: '∞', defaultValue: 0 };
        case 'opposition':
            return { id: makeId(), kind, title: '', minLabel: 'no', maxLabel: 'yes', defaultValue: 0 };
        case 'text':
            return { id: makeId(), kind, title: '', maxLength: 200, multipleAnswers: false, maxAnswers: 5 };
        case 'choice':
            return { id: makeId(), kind, title: '', multipleChoices: false, maxAnswers: 5, choices: ['', ''] };
    }
}


// ---------- live session data ----------

export type Answer = number | string | string[];

export const MAX_MULTIPLE_ANSWERS = 42;

export interface SliderResult {
    kind: 'dimension' | 'opposition';
    average: number;
    variance: number;
    values: number[];
}

export interface ChoiceResult {
    kind: 'choice';
    counts: Record<string, number>;
}

export interface TextResult {
    kind: 'text';
    answers: string[];
}

export type QuestionResult = SliderResult | ChoiceResult | TextResult;

export interface PresenterState {
    sectionIndex: number;
    totalSections: number;
    phase: 'answering' | 'results';
    name: string;
    section: Section;
    participantCount: number;
    answerCount: number;
    results: QuestionResult[] | null;
}

export interface ParticipantState {
    phase: 'answering' | 'results';
    name: string;
    section: Section | null;
    submitted: boolean;
}


// ---------- websocket messages ----------

export interface StateMessage {
    type: 'state';
    state: PresenterState;
}

export interface ParticipantStateMessage {
    type: 'participant-state';
    state: ParticipantState;
}

export interface TerminatedMessage {
    type: 'terminated';
}

export type ServerMessage = StateMessage | ParticipantStateMessage | TerminatedMessage;

export interface SetSectionMessage {
    type: 'set-section';
    index: number;
}

export interface CloseSectionMessage {
    type: 'close-section';
}

export interface TerminateMessage {
    type: 'terminate';
}

export interface SubmitMessage {
    type: 'submit';
    answers: Record<string, Answer>;
}

export type ClientMessage = SetSectionMessage | CloseSectionMessage | TerminateMessage | SubmitMessage;


// ---------- validation ----------

export function validateVibecheck(raw: any): VibecheckModel {
    if (!raw || typeof raw !== 'object') throw new Error('invalid vibecheck');
    if (typeof raw.id !== 'string') throw new Error('invalid vibecheck.id');
    if (typeof raw.name !== 'string') throw new Error('invalid vibecheck.name');
    if (!Array.isArray(raw.sections)) throw new Error('invalid vibecheck.sections');
    for (const section of raw.sections) validateSection(section);
    return raw as VibecheckModel;
}

function validateSection(raw: any): void {
    if (!raw || typeof raw !== 'object') throw new Error('invalid section');
    if (typeof raw.id !== 'string') throw new Error('invalid section.id');
    if (typeof raw.title !== 'string') throw new Error('invalid section.title');
    if (!Array.isArray(raw.questions)) throw new Error('invalid section.questions');
    for (const question of raw.questions) validateQuestion(question);
}

function validateQuestion(raw: any): void {
    if (!raw || typeof raw !== 'object') throw new Error('invalid question');
    if (typeof raw.id !== 'string') throw new Error('invalid question.id');
    if (typeof raw.title !== 'string') throw new Error('invalid question.title');

    switch (raw.kind) {
        case 'dimension':
        case 'opposition':
            if (typeof raw.minLabel !== 'string') throw new Error('invalid question.minLabel');
            if (typeof raw.maxLabel !== 'string') throw new Error('invalid question.maxLabel');
            if (typeof raw.defaultValue !== 'number' || !Number.isFinite(raw.defaultValue)) throw new Error('invalid question.defaultValue');
            break;
        case 'text':
            if (typeof raw.maxLength !== 'number' || !Number.isFinite(raw.maxLength) || raw.maxLength < 1 || raw.maxLength > 1000) {
                throw new Error('invalid question.maxLength');
            }
            if (typeof raw.multipleAnswers !== 'boolean') throw new Error('invalid question.multipleAnswers');
            if (typeof raw.maxAnswers !== 'number' || !Number.isFinite(raw.maxAnswers) || raw.maxAnswers < 2 || raw.maxAnswers > MAX_MULTIPLE_ANSWERS) {
                throw new Error('invalid question.maxAnswers');
            }
            break;
        case 'choice':
            if (typeof raw.multipleChoices !== 'boolean') throw new Error('invalid question.multipleChoices');
            if (typeof raw.maxAnswers !== 'number' || !Number.isFinite(raw.maxAnswers) || raw.maxAnswers < 2 || raw.maxAnswers > MAX_MULTIPLE_ANSWERS) {
                throw new Error('invalid question.maxAnswers');
            }
            if (!Array.isArray(raw.choices) || !raw.choices.every((choice: any) => typeof choice === 'string')) {
                throw new Error('invalid question.choices');
            }
            break;
        default:
            throw new Error('invalid question.kind');
    }
}
