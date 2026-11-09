// keeps the whole server state in memory and exposes helpers to read/write it

import {
    Answer,
    ParticipantState,
    PresenterState,
    QuestionResult,
    VibecheckModel,
    makeId,
} from './common';

interface Session {
    id: string;
    nonce: string;
    vibecheck: VibecheckModel;
    sectionIndex: number;
    phase: 'answering' | 'results';
    presenterWs: any;
    participants: Map<string, any>;
    submittedBySection: Map<number, Set<string>>;
    answersBySection: Map<number, Map<string, Answer[]>>;
    createdAt: number;
}

export class Store {
    private sessions = new Map<string, Session>();

    createSession(vibecheck: VibecheckModel): { id: string; nonce: string } {
        const id = makeId();
        const nonce = makeId() + '-' + makeId();
        this.sessions.set(id, {
            id,
            nonce,
            vibecheck,
            sectionIndex: 0,
            phase: 'answering',
            presenterWs: null,
            participants: new Map(),
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

    setPresenter(id: string, ws: any) {
        const session = this.sessions.get(id);
        if (session) session.presenterWs = ws;
    }

    clearPresenter(id: string) {
        const session = this.sessions.get(id);
        if (session) session.presenterWs = null;
    }

    addParticipant(id: string, userId: string, ws: any) {
        const session = this.sessions.get(id);
        if (session) session.participants.set(userId, ws);
    }

    removeParticipant(id: string, userId: string) {
        const session = this.sessions.get(id);
        if (session) session.participants.delete(userId);
    }

    setSection(id: string, index: number) {
        const session = this.sessions.get(id);
        if (!session) return;
        if (!Number.isFinite(index) || index < 0 || index >= session.vibecheck.sections.length) return;
        session.sectionIndex = index;
        session.phase = 'answering';
    }

    closeSection(id: string) {
        const session = this.sessions.get(id);
        if (session) session.phase = 'results';
    }

    deleteSession(id: string) {
        this.sessions.delete(id);
    }

    submitAnswers(id: string, userId: string, answers: Record<string, Answer>) {
        const session = this.sessions.get(id);
        if (!session || session.phase !== 'answering') return;
        const section = session.vibecheck.sections[session.sectionIndex];
        if (!section) return;

        let sectionAnswers = session.answersBySection.get(session.sectionIndex);
        if (!sectionAnswers) {
            sectionAnswers = new Map();
            session.answersBySection.set(session.sectionIndex, sectionAnswers);
        }

        for (const question of section.questions) {
            const answer = answers[question.id];
            if (answer === undefined || answer === null) continue;
            let list = sectionAnswers.get(question.id);
            if (!list) {
                list = [];
                sectionAnswers.set(question.id, list);
            }
            if (Array.isArray(answer)) list.push(...answer);
            else list.push(answer);
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
        return {
            sectionIndex: session.sectionIndex,
            totalSections: session.vibecheck.sections.length,
            phase: session.phase,
            section: session.vibecheck.sections[session.sectionIndex],
            answerCount: this.answerCount(id),
            results: session.phase === 'results' ? this.computeResults(id) : null,
        };
    }

    getParticipantState(id: string, userId: string): ParticipantState | null {
        const session = this.sessions.get(id);
        if (!session) return null;
        return {
            phase: session.phase,
            section: session.phase === 'answering' ? session.vibecheck.sections[session.sectionIndex] : null,
            submitted: this.isSubmitted(id, userId),
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

    computeResults(id: string): QuestionResult[] {
        const session = this.sessions.get(id);
        if (!session) return [];
        const section = session.vibecheck.sections[session.sectionIndex];
        if (!section) return [];
        const sectionAnswers = session.answersBySection.get(session.sectionIndex);
        const results: QuestionResult[] = [];

        for (const question of section.questions) {
            const answers = sectionAnswers ? sectionAnswers.get(question.id) || [] : [];
            if (question.kind === 'dimension' || question.kind === 'opposition') {
                const numbers = answers.filter((a): a is number => typeof a === 'number');
                let average = 0;
                let variance = 0;
                if (numbers.length > 0) {
                    average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
                    variance = numbers.reduce((sum, n) => sum + (n - average) ** 2, 0) / numbers.length;
                }
                results.push({ kind: question.kind, average, variance });
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
