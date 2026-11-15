// keeps the whole server state in memory and exposes helpers to read/write it
// the state is plain json data (no sockets) so it can be saved to disk as-is

import * as fs from 'fs';
import {
    Answer,
    ParticipantState,
    PresenterState,
    QuestionResult,
    SummaryState,
    VibecheckModel,
    makeId,
    validateVibecheck,
} from '../common';

interface Session {
    id: string;
    nonce: string;
    vibecheck: VibecheckModel;
    sectionIndex: number;
    closedSections: number[];
    participants: Record<string, true>;
    submittedBySection: Record<string, Record<string, true>>; // section index -> userId -> true
    answersBySection: Record<string, Record<string, Record<string, Answer>>>; // section index -> questionId -> userId
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

    const sessions: Record<string, Session> = {};
    for (const [id, rawSession] of Object.entries(raw.sessions)) {
        const session = rawSession as any;
        if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error('invalid session');
        if (typeof session.id !== 'string') throw new Error('invalid session.id');
        if (typeof session.nonce !== 'string') throw new Error('invalid session.nonce');
        validateVibecheck(session.vibecheck);
        if (typeof session.sectionIndex !== 'number' || !Number.isFinite(session.sectionIndex)) throw new Error('invalid session.sectionIndex');
        if (!Array.isArray(session.closedSections) || !session.closedSections.every((value: any) => typeof value === 'number' && Number.isFinite(value))) throw new Error('invalid session.closedSections');
        if (!session.participants || typeof session.participants !== 'object' || Array.isArray(session.participants)) throw new Error('invalid session.participants');

        const submitted = session.submittedBySection;
        if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new Error('invalid session.submittedBySection');
        for (const value of Object.values(submitted)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid session.submittedBySection');
        }

        const answersBySection = session.answersBySection;
        if (!answersBySection || typeof answersBySection !== 'object' || Array.isArray(answersBySection)) throw new Error('invalid session.answersBySection');
        for (const questions of Object.values(answersBySection)) {
            if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw new Error('invalid session.answersBySection.section');
            for (const userAnswers of Object.values(questions)) {
                if (!userAnswers || typeof userAnswers !== 'object' || Array.isArray(userAnswers)) throw new Error('invalid session.answersBySection.question');
                for (const answer of Object.values(userAnswers)) validateAnswer(answer);
            }
        }

        if (typeof session.createdAt !== 'number' || !Number.isFinite(session.createdAt)) throw new Error('invalid session.createdAt');

        sessions[id] = session as Session;
    }
    return sessions;
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

    createSession(vibecheck: VibecheckModel): { id: string; nonce: string } {
        const id = makeId();
        const nonce = makeId() + '-' + makeId();
        this.sessions[id] = {
            id,
            nonce,
            vibecheck,
            sectionIndex: 0,
            closedSections: [],
            participants: {},
            submittedBySection: {},
            answersBySection: {},
            createdAt: Date.now(),
        };
        return { id, nonce };
    }

    getSession(id: string): Session | undefined {
        return this.sessions[id];
    }

    hasSession(id: string): boolean {
        return !!this.sessions[id];
    }

    validateNonce(id: string, nonce: string): boolean {
        const session = this.sessions[id];
        return !!session && session.nonce === nonce;
    }

    addParticipant(id: string, userId: string) {
        const session = this.sessions[id];
        if (session) session.participants[userId] = true;
    }

    removeParticipant(id: string, userId: string) {
        const session = this.sessions[id];
        if (session) delete session.participants[userId];
    }

    getParticipantIds(id: string): string[] {
        const session = this.sessions[id];
        return session ? Object.keys(session.participants) : [];
    }

    setSection(id: string, index: number) {
        const session = this.sessions[id];
        if (!session) return;
        if (!Number.isFinite(index) || index < 0 || index >= session.vibecheck.sections.length) return;
        session.sectionIndex = index;
    }

    closeSection(id: string) {
        const session = this.sessions[id];
        if (session && !session.closedSections.includes(session.sectionIndex)) {
            session.closedSections.push(session.sectionIndex);
        }
    }

    private phase(id: string): 'answering' | 'results' {
        const session = this.sessions[id];
        if (!session) return 'answering';
        return session.closedSections.includes(session.sectionIndex) ? 'results' : 'answering';
    }

    deleteSession(id: string) {
        delete this.sessions[id];
    }

    submitAnswers(id: string, userId: string, answers: Record<string, Answer>) {
        const session = this.sessions[id];
        if (!session || this.phase(id) !== 'answering') return;
        if (this.isSubmitted(id, userId)) return;
        const section = session.vibecheck.sections[session.sectionIndex];
        if (!section) return;

        // reject the whole submission if any multiple answer exceeds its question limit
        for (const question of section.questions) {
            const answer = answers[question.id];
            if (!Array.isArray(answer)) continue;
            if (question.kind !== 'text' && question.kind !== 'choice') continue;
            if (answer.length > question.maxAnswers) return;
        }

        const sectionKey = String(session.sectionIndex);

        let sectionAnswers = session.answersBySection[sectionKey];
        if (!sectionAnswers) {
            sectionAnswers = {};
            session.answersBySection[sectionKey] = sectionAnswers;
        }

        for (const question of section.questions) {
            const answer = answers[question.id];
            if (answer === undefined || answer === null) continue;
            const normalized = Array.isArray(answer) ? Array.from(new Set(answer)) : answer;
            let questionAnswers = sectionAnswers[question.id];
            if (!questionAnswers) {
                questionAnswers = {};
                sectionAnswers[question.id] = questionAnswers;
            }
            questionAnswers[userId] = normalized;
        }

        let submitters = session.submittedBySection[sectionKey];
        if (!submitters) {
            submitters = {};
            session.submittedBySection[sectionKey] = submitters;
        }
        submitters[userId] = true;
    }

    getPresenterState(id: string): PresenterState | null {
        const session = this.sessions[id];
        if (!session) return null;
        const phase = this.phase(id);
        return {
            sectionIndex: session.sectionIndex,
            totalSections: session.vibecheck.sections.length,
            phase,
            name: session.vibecheck.name,
            section: session.vibecheck.sections[session.sectionIndex],
            participantCount: Object.keys(session.participants).length,
            answerCount: this.answerCount(id),
            results: phase === 'results' ? this.computeResults(id, session.sectionIndex) : null,
        };
    }

    getParticipantState(id: string, userId: string): ParticipantState | null {
        const session = this.sessions[id];
        if (!session) return null;
        const phase = this.phase(id);
        return {
            phase,
            name: session.vibecheck.name,
            section: phase === 'answering' ? session.vibecheck.sections[session.sectionIndex] : null,
            submitted: this.isSubmitted(id, userId),
        };
    }

    getSummary(id: string): SummaryState | null {
        const session = this.sessions[id];
        if (!session) return null;

        const sections = session.vibecheck.sections.map((section, sectionIndex) => ({
            section,
            results: this.computeResults(id, sectionIndex),
        }));

        const questionOrder: { sectionIndex: number; questionId: string }[] = [];
        session.vibecheck.sections.forEach((section, sectionIndex) => {
            for (const question of section.questions) {
                questionOrder.push({ sectionIndex, questionId: question.id });
            }
        });

        const userIds = new Set<string>();
        for (const submitters of Object.values(session.submittedBySection)) {
            for (const userId of Object.keys(submitters)) userIds.add(userId);
        }

        const answers: (Answer | null)[][] = [];
        for (const userId of userIds) {
            answers.push(questionOrder.map(({ sectionIndex, questionId }) => {
                const userAnswers = session.answersBySection[String(sectionIndex)]?.[questionId];
                const answer = userAnswers?.[userId];
                return answer === undefined ? null : answer;
            }));
        }

        return {
            vibecheck: session.vibecheck,
            sections,
            answers,
        };
    }

    answerCount(id: string): number {
        const session = this.sessions[id];
        if (!session) return 0;
        const submitters = session.submittedBySection[String(session.sectionIndex)];
        return submitters ? Object.keys(submitters).length : 0;
    }

    isSubmitted(id: string, userId: string): boolean {
        const session = this.sessions[id];
        if (!session) return false;
        const submitters = session.submittedBySection[String(session.sectionIndex)];
        return !!submitters && Object.hasOwn(submitters, userId);
    }

    computeResults(id: string, sectionIndex: number): QuestionResult[] {
        const session = this.sessions[id];
        if (!session) return [];
        const section = session.vibecheck.sections[sectionIndex];
        if (!section) return [];
        const sectionAnswers = session.answersBySection[String(sectionIndex)];
        const results: QuestionResult[] = [];

        for (const question of section.questions) {
            const answers: Answer[] = [];
            const userAnswers = sectionAnswers ? sectionAnswers[question.id] : undefined;
            if (userAnswers) {
                for (const answer of Object.values(userAnswers)) {
                    if (Array.isArray(answer)) answers.push(...answer);
                    else answers.push(answer);
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
            } else {
                results.push({ kind: 'text', answers: answers.filter((a): a is string => typeof a === 'string') });
            }
        }
        return results;
    }
}
