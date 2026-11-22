
// close code the server sends for permanent errors (unknown session, invalid nonce)
export const FATAL_CLOSE_CODE = 4001;

type Brand<T, B> = T & { readonly __brand: B };

export type VibecheckId = Brand<string, 'VibecheckId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type UserId = Brand<string, 'UserId'>;
export type Nonce = Brand<string, 'Nonce'>;

export interface VibecheckModel {
    id: VibecheckId;
    name: string;
    sections: Section[];
    censoredWords?: string[];
}

export interface Section {
    title: string; // optional: an empty title is not shown
    questions: Question[];
    showResults?: boolean; // participants can see results after the section is closed
}

export type Question =
    | DimensionQuestion
    | OppositionQuestion
    | TextQuestion
    | ChoiceQuestion;

interface BaseQuestion {
    id: QuestionId;
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
    votable?: boolean; // participants can up/down-vote answers
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
    return { id: makeId() as VibecheckId, name: '', sections: [makeSection()] };
}

export function makeSection(): Section {
    return { title: '', questions: [], showResults: false };
}

export function makeQuestion(kind: Question['kind']): Question {
    const id = makeId() as QuestionId;
    switch (kind) {
        case 'dimension':
            return { id, kind, title: '', minLabel: '0', maxLabel: '∞', defaultValue: 0 };
        case 'opposition':
            return { id, kind, title: '', minLabel: 'no', maxLabel: 'yes', defaultValue: 0 };
        case 'text':
            return { id, kind, title: '', maxLength: 200, multipleAnswers: false, maxAnswers: 5, votable: false };
        case 'choice':
            return { id, kind, title: '', multipleChoices: false, maxAnswers: 5, choices: ['', ''] };
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
    scores: Record<string, number>; // text -> upvotes - downvotes
    myVotes: Record<string, 1 | -1>; // text -> viewing user's vote
    censored: { text: string; count: number }[]; // censored answers (presenter only)
}

export type QuestionResult = SliderResult | ChoiceResult | TextResult;

export interface PresenterState {
    phase: 'lobby' | 'answering' | 'results';
    name: string;
    section: Section | null;
    sectionIndex: number;
    totalSections: number;
    participantCount: number;
    answerCount: number;
    results: QuestionResult[] | null;
    emojiBlocked: boolean;
    votingClosed: boolean;
    hasVotable: boolean;
    sections: Section[];
}

export interface ParticipantState {
    phase: 'lobby' | 'answering' | 'results';
    name: string;
    section: Section | null;
    sectionIndex: number;
    submitted: boolean;
    results: QuestionResult[] | null;
    votingClosed: boolean;
}

export interface SummaryState {
    vibecheck: VibecheckModel;
    sections: { section: Section; results: QuestionResult[] }[];
    answers: (Answer | null)[][];
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

export interface SummaryMessage {
    type: 'summary';
    summary: SummaryState;
}

export interface EmojiEvent {
    type: 'emoji';
    emoji: string;
}

export interface PresenterCountsMessage {
    type: 'presenter-counts';
    participantCount: number;
    answerCount: number;
}

export interface VoteDeltaMessage {
    type: 'vote-delta';
    questionId: QuestionId;
    text: string;
    score: number;
    myVote?: 1 | -1 | null;
}

export interface CensorDeltaMessage {
    type: 'censor-delta';
    questionId: QuestionId;
    text: string;
}

export interface CorrelationDataMessage {
    type: 'correlation-data';
    plotId: string;
    points: { x: number; y: number }[];
}

export type ServerMessage = StateMessage | ParticipantStateMessage | TerminatedMessage | SummaryMessage | EmojiEvent | PresenterCountsMessage | VoteDeltaMessage | CensorDeltaMessage | CorrelationDataMessage;

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
    answers: Record<QuestionId, Answer | null>;
}

export interface SummaryRequestMessage {
    type: 'summary';
}

export interface VoteMessage {
    type: 'vote';
    questionId: QuestionId;
    text: string;
    direction: 1 | -1;
}

export interface StartMessage {
    type: 'start';
}

export interface EmojiMessage {
    type: 'emoji';
    emoji: string;
}

export interface SetEmojiBlockedMessage {
    type: 'set-emoji-blocked';
    blocked: boolean;
}

export interface CloseVotingMessage {
    type: 'close-voting';
}

export interface CensorAnswerMessage {
    type: 'censor-answer';
    questionId: QuestionId;
    text: string;
}

export interface CorrelationRequestMessage {
    type: 'correlation-request';
    plotId: string;
    xSectionIndex: number;
    xQuestionId: QuestionId;
    ySectionIndex: number;
    yQuestionId: QuestionId;
}

export type ClientMessage = SetSectionMessage | CloseSectionMessage | TerminateMessage | SubmitMessage | SummaryRequestMessage | VoteMessage | StartMessage | EmojiMessage | SetEmojiBlockedMessage | CloseVotingMessage | CensorAnswerMessage | CorrelationRequestMessage;


// ---------- validation ----------

export function validateVibecheck(raw: any): VibecheckModel {
    if (!raw || typeof raw !== 'object') throw new Error('invalid vibecheck');
    if (typeof raw.id !== 'string') throw new Error('invalid vibecheck.id');
    if (typeof raw.name !== 'string') throw new Error('invalid vibecheck.name');
    if (raw.censoredWords !== undefined) {
        if (!Array.isArray(raw.censoredWords) || !raw.censoredWords.every((word: any) => typeof word === 'string')) {
            throw new Error('invalid vibecheck.censoredWords');
        }
    }
    if (!Array.isArray(raw.sections)) throw new Error('invalid vibecheck.sections');
    for (const section of raw.sections) validateSection(section);
    return raw as VibecheckModel;
}

function validateSection(raw: any): void {
    if (!raw || typeof raw !== 'object') throw new Error('invalid section');
    if (typeof raw.title !== 'string') throw new Error('invalid section.title');
    if (raw.showResults !== undefined && typeof raw.showResults !== 'boolean') throw new Error('invalid section.showResults');
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
            if (raw.votable !== undefined && typeof raw.votable !== 'boolean') throw new Error('invalid question.votable');
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


export function throttle(fn: (...args: any[]) => void, waitMs: number): (...args: any[]) => void {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        const now = Date.now();
        const remaining = waitMs - (now - last);
        if (remaining <= 0) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            last = now;
            fn(...args);
        } else if (!timer) { // trailing call
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn(...args);
            }, remaining);
        }
    };
}

export function debounce(fn: (...args: any[]) => void, waitMs: number): (...args: any[]) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, waitMs);
    };
}

