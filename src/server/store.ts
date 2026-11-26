// keeps the whole server state in memory and exposes helpers to read/write it
// the state is plain json data (no sockets) so it can be saved to disk as-is

import * as fs from 'fs';
import {
    Answer,
    Nonce,
    ParticipantState,
    PresenterState,
    QuestionId,
    QuestionResult,
    SessionId,
    SummaryState,
    UserId,
    VibecheckModel,
    makeId,
    validateVibecheck,
} from '../common';

interface Session {
    id: SessionId;
    nonce: Nonce;
    vibecheck: VibecheckModel;
    sectionIndex: number;
    started?: boolean;
    emojiBlocked?: boolean;
    votingClosed?: boolean;
    closedSections: number[];
    participants: Record<UserId, true>;
    submittedBySection: Record<string, Record<UserId, true>>; // section index -> userId -> true
    answersBySection: Record<string, Record<QuestionId, Record<UserId, { censored: boolean | boolean[]; answer: Answer }>>>; // section index -> questionId -> userId
    votesBySection?: Record<string, Record<QuestionId, Record<string, Record<UserId, 1 | -1>>>>; // section -> question -> text -> userId
    createdAt: number;
}

function validateAnswer(raw: any): Answer {
    if (typeof raw === 'number' || typeof raw === 'string') return raw;
    if (Array.isArray(raw) && raw.every((value: any) => typeof value === 'string')) return raw;
    throw new Error('invalid answer');
}

function validateStore(raw: any): Record<string, Session> {
    if (!raw || typeof raw !== 'object' || !raw.sessions || typeof raw.sessions !== 'object' || Array.isArray(raw.sessions)) {
        throw new Error('invalid store');
    }

    for (const rawSession of Object.values(raw.sessions)) {
        const session = rawSession as any;
        if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error('invalid session');
        if (typeof session.id !== 'string') throw new Error('invalid session.id');
        if (typeof session.nonce !== 'string') throw new Error('invalid session.nonce');
        validateVibecheck(session.vibecheck);
        if (session.votingClosed !== undefined && typeof session.votingClosed !== 'boolean') throw new Error('invalid session.votingClosed');

        const sectionCount = session.vibecheck.sections.length;
        const validSectionIndex = (value: any): boolean =>
            typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < sectionCount;
        const validSectionKey = (key: string): boolean => {
            const n = Number(key);
            return Number.isInteger(n) && n >= 0 && n < sectionCount;
        };

        if (!validSectionIndex(session.sectionIndex)) throw new Error('invalid session.sectionIndex');
        if (!Array.isArray(session.closedSections) || !session.closedSections.every(validSectionIndex)) throw new Error('invalid session.closedSections');
        if (!session.participants || typeof session.participants !== 'object' || Array.isArray(session.participants)) throw new Error('invalid session.participants');

        const submitted = session.submittedBySection;
        if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new Error('invalid session.submittedBySection');
        for (const [key, value] of Object.entries(submitted)) {
            if (!validSectionKey(key)) throw new Error('invalid session.submittedBySection');
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid session.submittedBySection');
        }

        const answersBySection = session.answersBySection;
        if (!answersBySection || typeof answersBySection !== 'object' || Array.isArray(answersBySection)) throw new Error('invalid session.answersBySection');
        for (const [key, questions] of Object.entries(answersBySection)) {
            if (!validSectionKey(key)) throw new Error('invalid session.answersBySection.section');
            if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw new Error('invalid session.answersBySection.section');
            for (const userAnswers of Object.values(questions)) {
                if (!userAnswers || typeof userAnswers !== 'object' || Array.isArray(userAnswers)) throw new Error('invalid session.answersBySection.question');
                for (const rawEntry of Object.values(userAnswers)) {
                    const entry = rawEntry as any;
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                        throw new Error('invalid session.answersBySection.answer');
                    }
                    validateAnswer(entry.answer);
                    if (Array.isArray(entry.answer)) {
                        if (!Array.isArray(entry.censored) || entry.censored.length !== entry.answer.length || !entry.censored.every((flag: any) => typeof flag === 'boolean')) {
                            throw new Error('invalid session.answersBySection.censored');
                        }
                    } else if (typeof entry.censored !== 'boolean') {
                        throw new Error('invalid session.answersBySection.censored');
                    }
                }
            }
        }

        if (typeof session.createdAt !== 'number' || !Number.isFinite(session.createdAt)) throw new Error('invalid session.createdAt');
    }

    return raw.sessions as Record<string, Session>;
}

function isCensoredText(text: string, words: string[]): boolean {
    if (!words || words.length === 0) return false;
    const lower = text.toLowerCase();
    return words.some((word) => {
        if (!word) return false;
        const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(lower);
    });
}

export class Store {
    private sessions: Record<string, Session> = {};
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    load(): Promise<void> {
        return new Promise((resolve) => {
            fs.readFile(this.filePath, 'utf-8', (err, raw) => {
                if (err) {
                    resolve();
                    return;
                }
                try {
                    this.sessions = validateStore(JSON.parse(raw));
                } catch {
                    // corrupt state: start fresh
                }
                resolve();
            });
        });
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify({ sessions: this.sessions }, null, 2));
        } catch {
            // ignore write errors
        }
    }

    startAutoSave(intervalMs: number) {
        if (intervalMs <= 0) return;
        setInterval(() => this.save(), intervalMs);
    }

    createSession(vibecheck: VibecheckModel): { id: SessionId; nonce: Nonce } {
        const id = makeId() as SessionId;
        const nonce = (makeId() + '-' + makeId()) as Nonce;
        this.sessions[id] = {
            id,
            nonce,
            vibecheck,
            sectionIndex: 0,
            started: false,
            emojiBlocked: false,
            votingClosed: false,
            closedSections: [],
            participants: {},
            submittedBySection: {},
            answersBySection: {},
            votesBySection: {},
            createdAt: Date.now(),
        };
        return { id, nonce };
    }

    getSession(id: SessionId): Session | undefined {
        return this.sessions[id];
    }

    hasSession(id: SessionId): boolean {
        return !!this.sessions[id];
    }

    validateNonce(id: SessionId, nonce: Nonce): boolean {
        const session = this.sessions[id];
        return !!session && session.nonce === nonce;
    }

    addParticipant(id: SessionId, userId: UserId) {
        const session = this.sessions[id];
        if (session) session.participants[userId] = true;
    }

    removeParticipant(id: SessionId, userId: UserId) {
        const session = this.sessions[id];
        if (session) delete session.participants[userId];
    }

    getParticipantIds(id: SessionId): UserId[] {
        const session = this.sessions[id];
        return session ? Object.keys(session.participants) as UserId[] : [];
    }

    setSection(id: SessionId, index: number) {
        const session = this.sessions[id];
        if (!session) return;
        if (!Number.isFinite(index) || index < 0 || index >= session.vibecheck.sections.length) return;
        session.sectionIndex = index;
    }

    startSession(id: SessionId) {
        const session = this.sessions[id];
        if (!session) return;
        session.started = true;
        session.sectionIndex = 0;
    }

    setEmojiBlocked(id: SessionId, blocked: boolean) {
        const session = this.sessions[id];
        if (!session) return;
        session.emojiBlocked = blocked;
    }

    emojisBlocked(id: SessionId): boolean {
        const session = this.sessions[id];
        return !!session && !!session.emojiBlocked;
    }

    closeVoting(id: SessionId) {
        const session = this.sessions[id];
        if (session) session.votingClosed = true;
    }

    censorAnswer(id: SessionId, questionId: QuestionId, text: string) {
        const session = this.sessions[id];
        if (!session || this.phase(id) !== 'results') return;
        const sectionKey = String(session.sectionIndex);
        const questionAnswers = session.answersBySection[sectionKey]?.[questionId];
        if (!questionAnswers) return;
        for (const entry of Object.values(questionAnswers)) {
            if (Array.isArray(entry.answer)) {
                const index = entry.answer.indexOf(text);
                if (index < 0) continue;
                if (!Array.isArray(entry.censored)) entry.censored = entry.answer.map(() => false);
                entry.censored[index] = true;
            } else if (entry.answer === text) {
                entry.censored = true;
            }
        }
    }

    hasVotableQuestions(id: SessionId): boolean {
        const session = this.sessions[id];
        if (!session) return false;
        for (const section of session.vibecheck.sections) {
            for (const question of section.questions) {
                if (question.kind === 'text' && question.votable) return true;
            }
        }
        return false;
    }

    closeSection(id: SessionId) {
        const session = this.sessions[id];
        if (session && !session.closedSections.includes(session.sectionIndex)) {
            session.closedSections.push(session.sectionIndex);
        }
    }

    phase(id: SessionId): 'lobby' | 'answering' | 'results' {
        const session = this.sessions[id];
        if (!session) return 'answering';
        if (session.started === false) return 'lobby';
        return session.closedSections.includes(session.sectionIndex) ? 'results' : 'answering';
    }

    deleteSession(id: SessionId) {
        delete this.sessions[id];
    }

    private votesOf(id: SessionId): Record<string, Record<QuestionId, Record<string, Record<UserId, 1 | -1>>>> {
        const session = this.sessions[id];
        if (!session) return {};
        if (!session.votesBySection || typeof session.votesBySection !== 'object') session.votesBySection = {};
        return session.votesBySection;
    }

    scoreOf(id: SessionId, sectionIndex: number, questionId: QuestionId, text: string): number {
        const users = this.votesOf(id)[String(sectionIndex)]?.[questionId]?.[text];
        if (!users) return 0;
        let score = 0;
        for (const vote of Object.values(users)) {
            if (vote === 1) score++;
            else score--;
        }
        return score;
    }

    myVoteOf(id: SessionId, sectionIndex: number, userId: UserId, questionId: QuestionId, text: string): 1 | -1 | null {
        const vote = this.votesOf(id)[String(sectionIndex)]?.[questionId]?.[text]?.[userId];
        return vote === undefined ? null : vote;
    }

    vote(id: SessionId, userId: UserId, questionId: QuestionId, text: string, direction: 1 | -1) {
        const session = this.sessions[id];
        if (!session || this.phase(id) !== 'results') return;
        if (session.votingClosed) return;
        const section = session.vibecheck.sections[session.sectionIndex];
        if (!section || !section.showResults) return;
        const question = section.questions.find((q) => q.id === questionId);
        if (!question || question.kind !== 'text' || !question.votable) return;
        const votes = this.votesOf(id);
        const sectionKey = String(session.sectionIndex);
        let questionVotes = votes[sectionKey];
        if (!questionVotes) {
            questionVotes = {};
            votes[sectionKey] = questionVotes;
        }
        let textVotes = questionVotes[questionId];
        if (!textVotes) {
            textVotes = {};
            questionVotes[questionId] = textVotes;
        }
        let users = textVotes[text];
        if (!users) {
            users = {};
            textVotes[text] = users;
        }
        if (users[userId] === direction) delete users[userId];
        else users[userId] = direction;
    }

    submitAnswers(id: SessionId, userId: UserId, answers: Record<QuestionId, Answer | null>) {
        const session = this.sessions[id];
        if (!session || this.phase(id) !== 'answering') return;
        if (this.isSubmitted(id, userId)) return;
        const section = session.vibecheck.sections[session.sectionIndex];
        if (!section) return;

        // reject the whole submission if any multiple answer exceeds its question limit
        for (const question of section.questions) {
            const answer = answers[question.id];
            if (!Array.isArray(answer)) continue;
            if (question.kind === 'text' && answer.length > question.maxAnswers) return;
        }

        const sectionKey = String(session.sectionIndex);

        let sectionAnswers = session.answersBySection[sectionKey];
        if (!sectionAnswers) {
            sectionAnswers = {};
            session.answersBySection[sectionKey] = sectionAnswers;
        }

        const censoredWords = session.vibecheck.censoredWords || [];

        for (const question of section.questions) {
            const answer = answers[question.id];
            if (answer === undefined || answer === null) continue;
            const normalized = Array.isArray(answer) ? Array.from(new Set(answer)) : answer;
            let censored: boolean | boolean[] = false;
            if (question.kind === 'text') {
                if (Array.isArray(normalized)) {
                    censored = normalized.map((entry) => isCensoredText(entry, censoredWords));
                } else if (typeof normalized === 'string') {
                    censored = isCensoredText(normalized, censoredWords);
                }
            } else if (Array.isArray(normalized)) {
                censored = normalized.map(() => false);
            }
            let questionAnswers = sectionAnswers[question.id];
            if (!questionAnswers) {
                questionAnswers = {};
                sectionAnswers[question.id] = questionAnswers;
            }
            questionAnswers[userId] = { censored, answer: normalized };
        }

        let submitters = session.submittedBySection[sectionKey];
        if (!submitters) {
            submitters = {};
            session.submittedBySection[sectionKey] = submitters;
        }
        submitters[userId] = true;
    }

    getPresenterState(id: SessionId): PresenterState | null {
        const session = this.sessions[id];
        if (!session) return null;
        const phase = this.phase(id);
        const lobby = phase === 'lobby';
        return {
            phase,
            name: session.vibecheck.name,
            section: lobby ? null : session.vibecheck.sections[session.sectionIndex],
            sectionIndex: session.sectionIndex,
            totalSections: session.vibecheck.sections.length,
            participantCount: Object.keys(session.participants).length,
            answerCount: lobby ? 0 : this.answerCount(id),
            results: phase === 'results' ? this.computeResults(id, session.sectionIndex) : null,
            emojiBlocked: !!session.emojiBlocked,
            votingClosed: !!session.votingClosed,
            hasVotable: this.hasVotableQuestions(id),
            sections: session.vibecheck.sections,
        };
    }

    getPresenterCounts(id: SessionId): { participantCount: number; answerCount: number } | null {
        const session = this.sessions[id];
        if (!session) return null;
        return {
            participantCount: Object.keys(session.participants).length,
            answerCount: this.phase(id) === 'lobby' ? 0 : this.answerCount(id),
        };
    }

    correlationData(id: SessionId, xSectionIndex: number, xQuestionId: QuestionId, ySectionIndex: number, yQuestionId: QuestionId): { x: number | string; y: number | string }[] {
        const session = this.sessions[id];
        if (!session) return [];
        const xAnswers = session.answersBySection[String(xSectionIndex)]?.[xQuestionId];
        const yAnswers = session.answersBySection[String(ySectionIndex)]?.[yQuestionId];
        const points: { x: number | string; y: number | string }[] = [];
        if (!xAnswers) return points;
        for (const [userId, xEntry] of Object.entries(xAnswers)) {
            const yEntry = yAnswers?.[userId];
            if (!yEntry) continue;
            const xValue = xEntry.answer;
            const yValue = yEntry.answer;
            if (Array.isArray(xValue) || Array.isArray(yValue)) continue;
            if ((typeof xValue !== 'number' && typeof xValue !== 'string') || (typeof yValue !== 'number' && typeof yValue !== 'string')) continue;
            if (xEntry.censored || yEntry.censored) continue;
            points.push({ x: xValue, y: yValue });
        }
        return points;
    }

    getStatus(): { sessions: number; participants: number } {
        let participants = 0;
        for (const session of Object.values(this.sessions)) {
            participants += Object.keys(session.participants).length;
        }
        return { sessions: Object.keys(this.sessions).length, participants };
    }

    getParticipantState(id: SessionId, userId: UserId, baseResults?: QuestionResult[]): ParticipantState | null {
        const session = this.sessions[id];
        if (!session) return null;
        const phase = this.phase(id);
        if (phase === 'lobby') {
            return {
                phase,
                name: session.vibecheck.name,
                section: null,
                sectionIndex: session.sectionIndex,
                submitted: false,
                results: null,
                votingClosed: !!session.votingClosed,
            };
        }
        const section = session.vibecheck.sections[session.sectionIndex];
        const showResults = phase === 'results' && !!section.showResults;
        let results: QuestionResult[] | null = null;
        if (showResults) {
            const base = baseResults ?? this.computeResults(id, session.sectionIndex);
            results = this.withMyVotes(id, session.sectionIndex, userId, base);
        }
        return {
            phase,
            name: session.vibecheck.name,
            section: phase === 'answering' || showResults ? section : null,
            sectionIndex: session.sectionIndex,
            submitted: this.isSubmitted(id, userId),
            results,
            votingClosed: !!session.votingClosed,
        };
    }

    getSummary(id: SessionId): SummaryState | null {
        const session = this.sessions[id];
        if (!session) return null;

        const sections = session.vibecheck.sections.map((section, sectionIndex) => ({
            section,
            results: this.computeResults(id, sectionIndex),
        }));

        const questionOrder: { sectionIndex: number; questionId: QuestionId }[] = [];
        session.vibecheck.sections.forEach((section, sectionIndex) => {
            for (const question of section.questions) {
                questionOrder.push({ sectionIndex, questionId: question.id });
            }
        });

        const userIds = new Set<UserId>();
        for (const submitters of Object.values(session.submittedBySection)) {
            for (const userId of Object.keys(submitters) as UserId[]) userIds.add(userId);
        }

        const answers: (Answer | null)[][] = [];
        for (const userId of userIds) {
            answers.push(questionOrder.map(({ sectionIndex, questionId }) => {
                const userAnswers = session.answersBySection[String(sectionIndex)]?.[questionId];
                const entry = userAnswers?.[userId];
                return entry === undefined ? null : entry.answer;
            }));
        }

        return {
            vibecheck: session.vibecheck,
            sections,
            answers,
        };
    }

    answerCount(id: SessionId): number {
        const session = this.sessions[id];
        if (!session) return 0;
        const submitters = session.submittedBySection[String(session.sectionIndex)];
        return submitters ? Object.keys(submitters).length : 0;
    }

    isSubmitted(id: SessionId, userId: UserId): boolean {
        const session = this.sessions[id];
        if (!session) return false;
        const submitters = session.submittedBySection[String(session.sectionIndex)];
        return !!submitters && Object.hasOwn(submitters, userId);
    }

    computeResults(id: SessionId, sectionIndex: number): QuestionResult[] {
        const session = this.sessions[id];
        if (!session) return [];
        const section = session.vibecheck.sections[sectionIndex];
        if (!section) return [];
        const sectionAnswers = session.answersBySection[String(sectionIndex)];
        const results: QuestionResult[] = [];

        for (const question of section.questions) {
            const userAnswers = sectionAnswers ? sectionAnswers[question.id] : undefined;

            if (question.kind === 'text') {
                const visible: string[] = [];
                const censoredCounts = new Map<string, number>();
                if (userAnswers) {
                    for (const entry of Object.values(userAnswers)) {
                        const values = Array.isArray(entry.answer) ? entry.answer : [entry.answer];
                        const flags = Array.isArray(entry.censored) ? entry.censored : [entry.censored];
                        values.forEach((value, index) => {
                            if (typeof value !== 'string') return;
                            if (flags[index]) censoredCounts.set(value, (censoredCounts.get(value) || 0) + 1);
                            else visible.push(value);
                        });
                    }
                }
                const censored = Array.from(censoredCounts.entries()).map(([text, count]) => ({ text, count }));
                const censoredTexts = new Set(censored.map((entry) => entry.text));
                const scores: Record<string, number> = {};
                const questionVotes = this.votesOf(id)[String(sectionIndex)]?.[question.id];
                if (questionVotes) {
                    for (const [text, users] of Object.entries(questionVotes)) {
                        if (censoredTexts.has(text)) continue;
                        let score = 0;
                        for (const vote of Object.values(users)) {
                            if (vote === 1) score++;
                            else score--;
                        }
                        scores[text] = score;
                    }
                }
                results.push({ kind: 'text', answers: visible, scores, myVotes: {}, censored });
                continue;
            }

            const answers: Answer[] = [];
            if (userAnswers) {
                for (const entry of Object.values(userAnswers)) {
                    if (Array.isArray(entry.answer)) answers.push(...entry.answer);
                    else answers.push(entry.answer);
                }
            }
            if (question.kind === 'dimension' || question.kind === 'opposition') {
                const numbers = answers.filter((a): a is number => typeof a === 'number');
                let average = 0;
                let variance = 0;
                if (numbers.length > 0) {
                    average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
                    variance = numbers.reduce((sum, n) => sum + (n - average) ** 2, 0) / numbers.length;
                }
                results.push({ kind: question.kind, average, variance, values: numbers });
            } else if (question.kind === 'choice') {
                const counts: Record<string, number> = {};
                for (const answer of answers) {
                    if (typeof answer === 'string') {
                        counts[answer] = (counts[answer] || 0) + 1;
                    }
                }
                results.push({ kind: 'choice', counts });
            }
        }
        return results;
    }

    private withMyVotes(id: SessionId, sectionIndex: number, userId: UserId, base: QuestionResult[]): QuestionResult[] {
        const session = this.sessions[id];
        if (!session) return base;
        const section = session.vibecheck.sections[sectionIndex];
        if (!section) return base;
        const sectionVotes = this.votesOf(id)[String(sectionIndex)];
        return base.map((result, index) => {
            if (result.kind !== 'text') return result;
            const question = section.questions[index];
            const visibleTexts = new Set(result.answers);
            const myVotes: Record<string, 1 | -1> = {};
            const questionVotes = question && sectionVotes ? sectionVotes[question.id] : undefined;
            if (questionVotes) {
                for (const [text, users] of Object.entries(questionVotes)) {
                    if (users[userId] !== undefined && visibleTexts.has(text)) myVotes[text] = users[userId];
                }
            }
            return { ...result, myVotes, censored: [] };
        });
    }
}
