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
            return { id: makeId(), kind, title: '', maxLength: 200, multiple: false };
        case 'choice':
            return { id: makeId(), kind, title: '', multiple: false, choices: ['', ''] };
    }
}


// ---------- live session data ----------

export type Answer = number | string | string[];

export interface SliderResult {
    kind: 'dimension' | 'opposition';
    average: number;
    variance: number;
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
