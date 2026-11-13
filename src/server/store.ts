// keeps the whole server state in memory and exposes helpers to read/write it
// the state is plain json data (no sockets) so it can be saved to disk

import * as fs from 'fs';
import {
    Answer,
    ParticipantState,
    PresenterState,
    QuestionResult,
    SummaryState,
    VibecheckModel,
    makeId,
} from '../common';

interface Session {
    id: string;
    nonce: string;
    vibecheck: VibecheckModel;
    sectionIndex: number;
    closedSections: Set<number>;
    participants: Set<string>;
    submittedBySection: Map<number, Set<string>>;
    // section number -> questionId -> userId
    answersBySection: Map<number, Map<string, Map<string, Answer>>>;
    createdAt: number;
}

const DEFAULT_SAVE_INTERVAL_MS = 5000;

export class Store {
    private sessions = new Map<string, Session>();
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    load() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            this.deserialize(JSON.parse(raw));
        } catch {
            // no saved state: start fresh
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.serialize(), null, 2));
        } catch {
            // ignore write errors
        }
    }

    startAutoSave(intervalMs: number = DEFAULT_SAVE_INTERVAL_MS) {
        setInterval(() => this.save(), intervalMs);
    }

    private serialize(): any {
        const sessions: Record<string, any> = {};
        for (const [id, session] of this.sessions) {
            sessions[id] = {
                id: session.id,
                nonce: session.nonce,
                vibecheck: session.vibecheck,
                sectionIndex: session.sectionIndex,
                closedSections: Array.from(session.closedSections),
                participants: Array.from(session.participants),
                submittedBySection: Object.fromEntries(
                    Array.from(session.submittedBySection.entries()).map(([key, value]) => [String(key), Array.from(value)]),
                ),
                answersBySection: Object.fromEntries(
                    Array.from(session.answersBySection.entries()).map(([sectionIndex, questions]) => [
                        String(sectionIndex),
                        Object.fromEntries(
                            Array.from(questions.entries()).map(([questionId, userAnswers]) => [
                                questionId,
                                Object.fromEntries(userAnswers),
                            ]),
                        ),
                    ]),
                ),
                createdAt: session.createdAt,
            };
        }
        return { sessions };
    }

    private deserialize(data: any) {
        if (!data || typeof data !== 'object' || typeof data.sessions !== 'object') return;
        const sessions = new Map<string, Session>();
        for (const [id, raw] of Object.entries(data.sessions)) {
            const session = raw as any;
            sessions.set(id, {
                id: session.id,
                nonce: session.nonce,
                vibecheck: session.vibecheck,
                sectionIndex: session.sectionIndex ?? 0,
                closedSections: new Set(session.closedSections || []),
                participants: new Set(session.participants || []),
                submittedBySection: new Map(
                    Object.entries(session.submittedBySection || {}).map(([key, value]) => [Number(key), new Set(value as string[])]),
                ),
                answersBySection: new Map(
                    Object.entries(session.answersBySection || {}).map(([sectionIndex, questions]) => [
                        Number(sectionIndex),
                        new Map(
                            Object.entries(questions as Record<string, Record<string, Answer>>).map(([questionId, userAnswers]) => [
                                questionId,
                                new Map(Object.entries(userAnswers)),
                            ]),
                        ),
                    ]),
                ),
                createdAt: session.createdAt ?? Date.now(),
            });
        }
        this.sessions = sessions;
    }

    createSession(vibecheck: VibecheckModel): { id: string; nonce: string } {
        const id = makeId();
        const nonce = makeId() + '-' + makeId();
        this.sessions.set(id, {
            id,
            nonce,
            vibecheck,
            sectionIndex: 0,
            closedSections: new Set(),
            participants: new Set(),
            submittedBySection: new Map(),
            answersBySection: new Map(),
            createdAt: Date.now(),
        });
        return { id, nonce };
    }

    getSession(id: string): Session | undefined {
        return this.sessions.get(id);
    }

    hasSession(id: string): boolean {
        return this.sessions.has(id);
    }

    validateNonce(id: string, nonce: string): boolean {
        const session = this.sessions.get(id);
        return !!session && session.nonce === nonce;
    }

    addParticipant(id: string, userId: string) {
        const session = this.sessions.get(id);
        if (session) session.participants.add(userId);
    }

    removeParticipant(id: string, userId: string) {
        const session = this.sessions.get(id);
        if (session) session.participants.delete(userId);
    }

    getParticipantIds(id: string): string[] {
        const session = this.sessions.get(id);
        return session ? Array.from(session.participants) : [];
    }

    setSection(id: string, index: number) {
        const session = this.sessions.get(id);
        if (!session) return;
        if (!Number.isFinite(index) || index < 0 || index >= session.vibecheck.sections.length) return;
        session.sectionIndex = index;
    }

    closeSection(id: string) {
        const session = this.sessions.get(id);
        if (session) session.closedSections.add(session.sectionIndex);
    }

    private phase(id: string): 'answering' | 'results' {
        const session = this.sessions.get(id);
        if (!session) return 'answering';
        return session.closedSections.has(session.sectionIndex) ? 'results' : 'answering';
    }

    deleteSession(id: string) {
        this.sessions.delete(id);
    }

    submitAnswers(id: string, userId: string, answers: Record<string, Answer>) {
        const session = this.sessions.get(id);
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

        let sectionAnswers = session.answersBySection.get(session.sectionIndex);
        if (!sectionAnswers) {
            sectionAnswers = new Map();
            session.answersBySection.set(session.sectionIndex, sectionAnswers);
        }

        for (const question of section.questions) {
            const answer = answers[question.id];
            if (answer === undefined || answer === null) continue;
            const normalized = Array.isArray(answer) ? Array.from(new Set(answer)) : answer;
            let questionAnswers = sectionAnswers.get(question.id);
            if (!questionAnswers) {
                questionAnswers = new Map();
                sectionAnswers.set(question.id, questionAnswers);
            }
            questionAnswers.set(userId, normalized);
        }

        let submitters = session.submittedBySection.get(session.sectionIndex);
        if (!submitters) {
            submitters = new Set();
            session.submittedBySection.set(session.sectionIndex, submitters);
        }
        submitters.add(userId);
    }

    getPresenterState(id: string): PresenterState | null {
        const session = this.sessions.get(id);
        if (!session) return null;
        const phase = this.phase(id);
        return {
            sectionIndex: session.sectionIndex,
            totalSections: session.vibecheck.sections.length,
            phase,
            name: session.vibecheck.name,
            section: session.vibecheck.sections[session.sectionIndex],
            participantCount: session.participants.size,
            answerCount: this.answerCount(id),
            results: phase === 'results' ? this.computeResults(id, session.sectionIndex) : null,
        };
    }

    getParticipantState(id: string, userId: string): ParticipantState | null {
        const session = this.sessions.get(id);
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
        const session = this.sessions.get(id);
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
        for (const submitters of session.submittedBySection.values()) {
            for (const userId of submitters) userIds.add(userId);
        }

        const answers: (Answer | null)[][] = [];
        for (const userId of userIds) {
            answers.push(questionOrder.map(({ sectionIndex, questionId }) => {
                const userAnswers = session.answersBySection.get(sectionIndex)?.get(questionId);
                const answer = userAnswers?.get(userId);
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
        const session = this.sessions.get(id);
        if (!session) return 0;
        const submitters = session.submittedBySection.get(session.sectionIndex);
        return submitters ? submitters.size : 0;
    }

    isSubmitted(id: string, userId: string): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;
        const submitters = session.submittedBySection.get(session.sectionIndex);
        return !!submitters && submitters.has(userId);
    }

    computeResults(id: string, sectionIndex: number): QuestionResult[] {
        const session = this.sessions.get(id);
        if (!session) return [];
        const section = session.vibecheck.sections[sectionIndex];
        if (!section) return [];
        const sectionAnswers = session.answersBySection.get(sectionIndex);
        const results: QuestionResult[] = [];

        for (const question of section.questions) {
            const answers: Answer[] = [];
            const userAnswers = sectionAnswers ? sectionAnswers.get(question.id) : undefined;
            if (userAnswers) {
                for (const answer of userAnswers.values()) {
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
