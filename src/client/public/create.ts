import {
    ChoiceQuestion,
    Question,
    TextQuestion,
    VibecheckModel,
    makeId,
    makeQuestion,
    makeVibecheck,
} from '../../common';
import { el, loadModels, renderQuestion, saveModels } from '../common';

let models: VibecheckModel[] = loadModels();
let view: 'list' | 'edit' | 'preview' = 'list';
let editingId: string | null = null;

function currentVibecheck(): VibecheckModel {
    const vibecheck = models.find((model) => model.id === editingId);
    if (!vibecheck) throw new Error('vibecheck non trovato');
    return vibecheck;
}

function render() {
    const main = view === 'list' ? renderList() : view === 'edit' ? renderEdit() : renderPreview();
    document.body.replaceChildren(main);
}

function goToList() {
    view = 'list';
    editingId = null;
    render();
}

function startEditing(id: string) {
    editingId = id;
    view = 'edit';
    render();
}

function startPreviewing(id: string) {
    editingId = id;
    view = 'preview';
    render();
}

// italian label shown in the ui for each question kind
function kindLabel(kind: Question['kind']): string {
    switch (kind) {
        case 'dimension': return 'dimensione';
        case 'opposition': return 'opposizione';
        case 'text': return 'testo libero';
        case 'choice': return 'scelta';
    }
}

// ---------- list view ----------

function renderList(): HTMLElement {
    const fileInput = el('input', {
        type: 'file',
        accept: '.json,application/json',
        hidden: true,
        onchange: () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const vibecheck = normalizeVibecheck(JSON.parse(String(reader.result)));
                    models.push(vibecheck);
                    saveModels(models);
                    render();
                } catch {
                    alert('file non valido: non sembra un file vibecheck');
                }
            };
            reader.readAsText(file);
        },
    });

    const list = el('div', {});
    if (models.length === 0) {
        list.append(el('p', { class: 'empty' }, 'nessun vibecheck ancora'));
    } else {
        for (const vibecheck of models) list.append(renderModelCard(vibecheck));
    }

    return el('main', {},
        el('h1', {}, 'i tuoi vibecheck'),
        el('div', { class: 'toolbar' },
            el('button', { onclick: () => fileInput.click() }, 'carica da file'),
            el('button', { class: 'primary', onclick: createNew }, 'nuovo vibecheck'),
        ),
        list,
        el('p', { class: 'muted' }, 'i vibecheck vengono salvati automaticamente in questo browser'),
        fileInput,
    );
}

function createNew() {
    const vibecheck = makeVibecheck();
    models.push(vibecheck);
    saveModels(models);
    startEditing(vibecheck.id);
}

function renderModelCard(vibecheck: VibecheckModel): HTMLElement {
    const count = vibecheck.questions.length;
    const countLabel = count === 1 ? '1 domanda' : count + ' domande';
    return el('div', { class: 'card' },
        el('h2', {}, vibecheck.name || 'senza nome'),
        el('p', { class: 'muted' }, countLabel),
        el('div', { class: 'row' },
            el('button', { onclick: () => startEditing(vibecheck.id) }, 'modifica'),
            el('button', { onclick: () => startPreviewing(vibecheck.id) }, 'anteprima'),
            el('button', { onclick: () => downloadVibecheck(vibecheck) }, 'salva su file'),
            el('button', { class: 'danger', onclick: () => deleteVibecheck(vibecheck.id) }, 'elimina'),
        ),
    );
}

function downloadVibecheck(vibecheck: VibecheckModel) {
    const blob = new Blob([JSON.stringify(vibecheck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = (vibecheck.name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-') || 'vibecheck') + '.json';
    const link = el('a', { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function deleteVibecheck(id: string) {
    const vibecheck = models.find((model) => model.id === id);
    if (!vibecheck) return;
    if (!confirm('eliminare "' + (vibecheck.name || 'senza nome') + '"?')) return;
    models = models.filter((model) => model.id !== id);
    saveModels(models);
    render();
}

// ---------- edit view ----------

function renderEdit(): HTMLElement {
    const vibecheck = currentVibecheck();

    const titleNode = el('h1', {}, vibecheck.name || 'nuovo vibecheck');
    const nameInput = el('input', {
        id: 'vibecheck-name',
        type: 'text',
        placeholder: 'nome del vibecheck',
        value: vibecheck.name,
        oninput: () => {
            vibecheck.name = nameInput.value;
            titleNode.textContent = vibecheck.name || 'nuovo vibecheck';
            saveModels(models);
        },
    });

    const questionsBox = el('div', {});
    vibecheck.questions.forEach((question, index) => {
        questionsBox.append(renderQuestionEditor(question, index));
    });

    return el('main', {},
        el('div', { class: 'row space-between' },
            el('button', { onclick: goToList }, '← indietro'),
            el('button', { class: 'primary', onclick: () => startPreviewing(vibecheck.id) }, 'anteprima'),
        ),
        titleNode,
        el('label', { for: 'vibecheck-name' }, 'nome'),
        nameInput,
        el('div', { class: 'toolbar' },
            el('button', { onclick: () => addQuestion('dimension') }, '+ dimensione'),
            el('button', { onclick: () => addQuestion('opposition') }, '+ opposizione'),
            el('button', { onclick: () => addQuestion('text') }, '+ testo libero'),
            el('button', { onclick: () => addQuestion('choice') }, '+ scelta'),
        ),
        questionsBox,
    );
}

function addQuestion(kind: Question['kind']) {
    currentVibecheck().questions.push(makeQuestion(kind));
    saveModels(models);
    render();
}

function removeQuestion(index: number) {
    if (!confirm('eliminare questa domanda?')) return;
    currentVibecheck().questions.splice(index, 1);
    saveModels(models);
    render();
}

function moveQuestion(index: number, delta: number) {
    const questions = currentVibecheck().questions;
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const [question] = questions.splice(index, 1);
    questions.splice(target, 0, question);
    saveModels(models);
    render();
}

function renderQuestionEditor(question: Question, index: number): HTMLElement {
    const card = el('div', { class: 'card question ' + question.kind });

    const titleInput = el('input', {
        type: 'text',
        placeholder: 'testo della domanda',
        value: question.title,
        oninput: () => {
            question.title = titleInput.value;
            saveModels(models);
        },
    });

    card.append(
        el('div', { class: 'question-header' },
            el('span', { class: 'kind-badge ' + question.kind }, kindLabel(question.kind)),
            el('span', { class: 'spacer' }),
            el('button', { class: 'icon-btn', title: 'sposta su', onclick: () => moveQuestion(index, -1) }, '↑'),
            el('button', { class: 'icon-btn', title: 'sposta giù', onclick: () => moveQuestion(index, 1) }, '↓'),
            el('button', { class: 'icon-btn danger', title: 'elimina domanda', onclick: () => removeQuestion(index) }, '✕'),
        ),
        titleInput,
        renderQuestionFields(question),
    );
    return card;
}

function renderQuestionFields(question: Question): HTMLElement {
    switch (question.kind) {
        case 'dimension':
        case 'opposition': {
            const sliderQuestion = question;
            return el('div', {},
                el('label', {}, 'etichetta minima'),
                el('input', {
                    type: 'text',
                    value: sliderQuestion.minLabel,
                    oninput: (event) => {
                        sliderQuestion.minLabel = (event.target as HTMLInputElement).value;
                        saveModels(models);
                    },
                }),
                el('label', {}, 'etichetta massima'),
                el('input', {
                    type: 'text',
                    value: sliderQuestion.maxLabel,
                    oninput: (event) => {
                        sliderQuestion.maxLabel = (event.target as HTMLInputElement).value;
                        saveModels(models);
                    },
                }),
            );
        }
        case 'text':
            return renderTextFields(question);
        case 'choice':
            return renderChoiceFields(question);
    }
}

function renderTextFields(question: TextQuestion): HTMLElement {
    const lengthLabel = el('label', {}, 'lunghezza massima: ' + question.maxLength + ' caratteri');
    const range = el('input', {
        type: 'range',
        min: '1',
        max: '1000',
        value: String(question.maxLength),
        oninput: () => {
            question.maxLength = Number(range.value);
            lengthLabel.textContent = 'lunghezza massima: ' + question.maxLength + ' caratteri';
            saveModels(models);
        },
    });
    return el('div', {},
        lengthLabel,
        range,
        el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: question.multiple || null,
                onchange: (event) => {
                    question.multiple = (event.target as HTMLInputElement).checked;
                    saveModels(models);
                },
            }),
            el('span', {}, 'più risposte per persona'),
        ),
    );
}

function renderChoiceFields(question: ChoiceQuestion): HTMLElement {
    const choicesBox = el('div', {});

    question.choices.forEach((choice, index) => {
        const input = el('input', {
            type: 'text',
            placeholder: 'opzione ' + (index + 1),
            value: choice,
            oninput: () => {
                question.choices[index] = input.value;
                saveModels(models);
            },
        });
        const removeButton = el('button', {
            class: 'icon-btn danger',
            title: 'elimina opzione',
            onclick: () => {
                question.choices.splice(index, 1);
                saveModels(models);
                render();
            },
        }, '✕');
        choicesBox.append(el('div', { class: 'choice-row' }, input, removeButton));
    });

    return el('div', {},
        choicesBox,
        el('button', { onclick: () => {
            question.choices.push('');
            saveModels(models);
            render();
        } }, '+ aggiungi opzione'),
        el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: question.multiple || null,
                onchange: (event) => {
                    question.multiple = (event.target as HTMLInputElement).checked;
                    saveModels(models);
                },
            }),
            el('span', {}, 'selezione multipla'),
        ),
    );
}

// ---------- preview view ----------

function renderPreview(): HTMLElement {
    const vibecheck = currentVibecheck();
    return el('main', {},
        el('div', { class: 'row space-between' },
            el('button', { onclick: goToList }, '← indietro'),
            el('button', { class: 'primary', onclick: () => startEditing(vibecheck.id) }, 'modifica'),
        ),
        el('h1', {}, vibecheck.name || 'senza nome'),
        vibecheck.questions.length === 0
            ? el('p', { class: 'empty' }, 'questo vibecheck non ha ancora domande')
            : el('div', {}, ...vibecheck.questions.map((question) => renderQuestion(question))),
    );
}

// ---------- file import ----------

function normalizeVibecheck(raw: any): VibecheckModel {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !Array.isArray(raw.questions)) {
        throw new Error('invalid vibecheck');
    }
    return {
        id: typeof raw.id === 'string' ? raw.id : makeId(),
        name: raw.name,
        questions: raw.questions.map(normalizeQuestion),
    };
}

function normalizeQuestion(raw: any): Question {
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

render();
