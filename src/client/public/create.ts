import {
    Answer,
    ChoiceQuestion,
    MAX_MULTIPLE_ANSWERS,
    Question,
    QuestionResult,
    Section,
    TextQuestion,
    VibecheckId,
    VibecheckModel,
    makeId,
    makeQuestion,
    makeSection,
    makeVibecheck,
    validateVibecheck,
} from '../../common';
import { el, loadModels, makeSlider, renderQuestion, renderResults, saveModels, sectionHeading } from '../common';

let models: VibecheckModel[] = loadModels();
let view: 'list' | 'edit' | 'results' = 'list';
let editingId: string | null = null;
let previewState: { id: string; sectionIndex: number } | null = null;
let questionPicker: { sectionIndex: number; questionIndex: number } | null = null;
let answersView: { vibecheck: VibecheckModel; sections: { section: Section; results: QuestionResult[] }[] } | null = null;

const PREDEFINED_SLURS = [
    'negro', 'negra', 'negri', 'negre',
    'giauro', 'giaura', 'giauri', 'giaure',
    'frocio', 'frocia', 'froci', 'frocie',
    'culattone', 'culattoni',
    'troia', 'troie', 'puttana', 'puttane',
    'bastardo', 'bastarda', 'bastardi', 'bastarde',
    'coglione', 'coglioni', 'cogliona',
    'stronzo', 'stronza', 'stronzi', 'stronze',
    'ritardato', 'ritardata', 'ritardati', 'ritardate',
    'handicappato', 'handicappata', 'handicappati',
    'mongoloide', 'mongoloidi',
    'cazzo', 'figa',
];

function currentVibecheck(): VibecheckModel {
    const vibecheck = models.find((model) => model.id === editingId);
    if (!vibecheck) throw new Error('vibecheck non trovato');
    return vibecheck;
}

function render(preserveScroll = false) {
    const scrollY = window.scrollY;
    document.body.replaceChildren(renderMain());
    if (preserveScroll) window.scrollTo(0, scrollY);
    renderModals();
}

function renderMain(): HTMLElement {
    if (view === 'list') return renderList();
    if (view === 'edit') return renderEdit();
    return renderResultsView();
}

function renderModals() {
    document.querySelector('.modal-root')?.remove();
    if (!previewState && !questionPicker) return;

    const modalRoot = el('div', { class: 'modal-root' });
    if (previewState) modalRoot.append(renderPreviewModal());
    else if (questionPicker) modalRoot.append(renderQuestionPickerModal());

    document.body.append(modalRoot);
}

function goToList() {
    view = 'list';
    editingId = null;
    previewState = null;
    questionPicker = null;
    answersView = null;
    history.replaceState(null, '', window.location.pathname);
    render();
}

function startEditing(id: string) {
    editingId = id;
    view = 'edit';
    previewState = null;
    questionPicker = null;
    history.replaceState(null, '', '?id=' + id);
    render();
}

function startPreviewing(id: string) {
    previewState = { id, sectionIndex: 0 };
    renderModals();
}

function closePreview() {
    previewState = null;
    renderModals();
}

function previewNav(delta: number) {
    if (!previewState) return;
    const vibecheck = models.find((model) => model.id === previewState.id);
    if (!vibecheck) return;
    previewState.sectionIndex = Math.min(
        Math.max(0, previewState.sectionIndex + delta),
        vibecheck.sections.length - 1,
    );
    renderModals();
}

function kindLabel(kind: Question['kind']): string {
    switch (kind) {
        case 'dimension': return 'dimensione';
        case 'opposition': return 'opposizione';
        case 'text': return 'testo';
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
                    const vibecheck = validateVibecheck(JSON.parse(String(reader.result)));
                    vibecheck.id = makeId() as VibecheckId;
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

    const answersInput = el('input', {
        type: 'file',
        accept: '.json,application/json',
        hidden: true,
        onchange: () => {
            const file = answersInput.files && answersInput.files[0];
            answersInput.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(String(reader.result));
                    const vibecheck = validateVibecheck(data.vibecheck);
                    if (!Array.isArray(data.answers) || !data.answers.every((row: any) => Array.isArray(row))) {
                        throw new Error('invalid answers');
                    }
                    answersView = { vibecheck, sections: computeResults(vibecheck, data.answers) };
                    view = 'results';
                    render();
                } catch {
                    alert('file non valido: non sembra un file di risposte');
                }
            };
            reader.readAsText(file);
        },
    });

    const list = el('div', {});
    if (models.length === 0) {
        list.append(el('p', { class: 'empty' }, 'nessun vibecheck'));
    } else {
        for (const vibecheck of models) list.append(renderModelCard(vibecheck));
    }

    return el('main', {},
        el('h1', {}, 'i tuoi vibecheck'),
        el('p', { class: 'muted' }, '(i vibecheck vengono salvati automaticamente in questo browser, se vuoi spostarli da un computer ad un altro salvali su file)'),
        el('div', { class: 'toolbar' },
            el('button', { onclick: () => fileInput.click() }, 'carica da file'),
            el('button', { onclick: () => answersInput.click() }, 'carica risposte'),
            el('button', { onclick: createNew }, 'nuovo'),
        ),
        list,
        fileInput,
        answersInput,
    );
}

function createNew() {
    const vibecheck = makeVibecheck();
    models.push(vibecheck);
    saveModels(models);
    startEditing(vibecheck.id);
}

async function startLive(vibecheck: VibecheckModel) {
    try {
        const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vibecheck),
        });
        const data = await response.json();
        localStorage.setItem('vibecheck.nonce.' + data.id, data.nonce);
        window.location.href = '/live-present.html?id=' + data.id;
    } catch {
        alert('impossibile avviare la sessione live');
    }
}

function renderModelCard(vibecheck: VibecheckModel): HTMLElement {
    const sectionCount = vibecheck.sections.length;
    const questionCount = vibecheck.sections.reduce((total, section) => total + section.questions.length, 0);
    const countLabel = (sectionCount === 1 ? '1 sezione' : sectionCount + ' sezioni')
        + ', '
        + (questionCount === 1 ? '1 domanda' : questionCount + ' domande');
    const card = el('div', { class: 'card' });
    if (vibecheck.name) card.append(el('h2', {}, vibecheck.name));
    card.append(
        el('p', { class: 'muted' }, countLabel),
        el('div', { class: 'row' },
            el('button', { class: 'small', onclick: () => startLive(vibecheck) }, 'avvia live'),
            el('button', { class: 'small', onclick: () => startEditing(vibecheck.id) }, 'modifica'),
            el('button', { class: 'small', onclick: () => startPreviewing(vibecheck.id) }, 'anteprima'),
            el('button', { class: 'small', onclick: () => downloadVibecheck(vibecheck) }, 'salva su file'),
            el('button', { class: 'small danger', onclick: () => deleteVibecheck(vibecheck.id) }, 'elimina'),
        ),
    );
    return card;
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
    if (!confirm('vuoi eliminare "' + (vibecheck.name || 'senza nome') + '"?')) return;
    models = models.filter((model) => model.id !== id);
    saveModels(models);
    render();
}

// ---------- edit view ----------

function renderEdit(): HTMLElement {
    const vibecheck = currentVibecheck();

    const nameInput = el('input', {
        id: 'vibecheck-name',
        class: 'title',
        type: 'text',
        placeholder: 'nome del vibecheck',
        value: vibecheck.name,
        oninput: () => {
            vibecheck.name = nameInput.value;
            saveModels(models);
        },
    });

    const sectionsBox = el('div', {});
    sectionsBox.append(insertSectionButton(0));
    vibecheck.sections.forEach((section, sectionIndex) => {
        sectionsBox.append(renderSectionEditor(section, sectionIndex));
        sectionsBox.append(insertSectionButton(sectionIndex + 1));
    });

    return el('main', { class: 'editor' },
        el('div', { class: 'row space-between' },
            el('button', { onclick: goToList }, '← indietro'),
            el('button', { onclick: () => startPreviewing(vibecheck.id) }, 'anteprima'),
        ),
        el('div', { class: 'vspace' }),
        nameInput,
        sectionsBox,
        renderCensorToggle(vibecheck),
    );
}

function renderCensorToggle(vibecheck: VibecheckModel): HTMLElement {
    const listBox = el('div', { class: 'chips' });
    const input = el('input', { type: 'text', placeholder: 'parola da censurare' });
    const summary = el('p', { class: 'muted' });
    let editing = false;

    const addRow = el('div', { class: 'link-row' },
        input,
        el('button', { class: 'small', onclick: addWord }, 'aggiungi'),
    );
    const editArea = el('div', {}, addRow, listBox);
    const editButton = el('button', { class: 'small', onclick: () => { editing = !editing; refresh(); } }, 'modifica parole');

    function refresh() {
        const enabled = Array.isArray(vibecheck.censoredWords);
        const words = vibecheck.censoredWords || [];

        editButton.style.display = enabled ? '' : 'none';
        summary.style.display = enabled && !editing ? '' : 'none';
        editArea.style.display = enabled && editing ? '' : 'none';

        if (enabled) {
            summary.textContent = words.length === 1
                ? '1 parola sarà censurata'
                : words.length + ' parole saranno censurate';
            editButton.textContent = editing ? 'chiudi' : 'modifica parole';
            listBox.replaceChildren();
            for (const word of words) {
                listBox.append(el('span', { class: 'chip censor-word' },
                    word,
                    el('button', { class: 'small danger', title: 'rimuovi parola', onclick: () => {
                        vibecheck.censoredWords = (vibecheck.censoredWords || []).filter((existing) => existing !== word);
                        saveModels(models);
                        refresh();
                    } }, '✕'),
                ));
            }
        }
    }

    function addWord() {
        const word = input.value.trim().toLowerCase();
        if (!word) return;
        if (!Array.isArray(vibecheck.censoredWords)) vibecheck.censoredWords = [...PREDEFINED_SLURS];
        if (!vibecheck.censoredWords.includes(word)) vibecheck.censoredWords.push(word);
        input.value = '';
        saveModels(models);
        refresh();
    }

    const checkbox = el('input', {
        type: 'checkbox',
        checked: Array.isArray(vibecheck.censoredWords) || null,
        onchange: (event) => {
            const checked = (event.target as HTMLInputElement).checked;
            vibecheck.censoredWords = checked ? [...PREDEFINED_SLURS] : undefined;
            editing = false;
            saveModels(models);
            refresh();
        },
    });

    const headerRow = el('div', { class: 'row space-between' },
        el('label', { class: 'check-row' }, checkbox, el('span', {}, 'censura parole')),
        editButton,
    );

    refresh();

    return el('div', { class: 'censor-box' },
        headerRow,
        summary,
        editArea,
    );
}

function insertSectionButton(index: number): HTMLElement {
    return el('button', { class: 'insert', onclick: () => {
        const section = makeSection();
        currentVibecheck().sections.splice(index, 0, section);
        saveModels(models);
        render(true);
        document.querySelector('[data-section-index="' + index + '"]')?.scrollIntoView({ block: 'center' });
    } }, '+ sezione');
}

function renderSectionEditor(section: Section, sectionIndex: number): HTMLElement {
    const vibecheck = currentVibecheck();

    const titleInput = el('input', {
        class: 'section-title-input',
        type: 'text',
        placeholder: 'titolo della sezione (opzionale)',
        value: section.title,
        oninput: () => {
            section.title = titleInput.value;
            saveModels(models);
        },
    });

    const descriptionInput = el('textarea', {
        rows: '2',
        placeholder: 'descrizione della sezione (opzionale)',
        oninput: () => {
            section.description = descriptionInput.value;
            saveModels(models);
        },
    }, section.description || '');

    const questionsBox = el('div', {});
    const renderQuestions = () => {
        questionsBox.replaceChildren(insertQuestionButton(sectionIndex, 0));
        section.questions.forEach((question, questionIndex) => {
            questionsBox.append(renderQuestionEditor(question, sectionIndex, questionIndex));
            questionsBox.append(insertQuestionButton(sectionIndex, questionIndex + 1));
        });
    };
    renderQuestions();

    return el('div', { class: 'card', 'data-section-index': sectionIndex },
        el('div', { class: 'section-header' },
            titleInput,
            el('button', { class: 'small danger', title: 'elimina sezione', onclick: () => {
                if (!confirm('vuoi eliminare questa intera sezione?')) return;
                vibecheck.sections.splice(sectionIndex, 1);
                saveModels(models);
                render(true);
            } }, '✕'),
        ),
        descriptionInput,
        el('label', { class: 'check-row' },
            el('input', {
                type: 'checkbox',
                checked: section.showResults || null,
                onchange: (event) => {
                    section.showResults = (event.target as HTMLInputElement).checked;
                    if (!section.showResults) {
                        for (const question of section.questions) {
                            if (question.kind === 'text') question.votable = false;
                        }
                    }
                    saveModels(models);
                    renderQuestions();
                },
            }),
            el('span', {}, 'i partecipanti vedono i risultati'),
        ),
        questionsBox,
    );
}

function insertQuestionButton(sectionIndex: number, questionIndex: number): HTMLElement {
    return el('button', { class: 'insert', onclick: () => openQuestionPicker(sectionIndex, questionIndex) }, '+ domanda');
}

function openQuestionPicker(sectionIndex: number, questionIndex: number) {
    questionPicker = { sectionIndex, questionIndex };
    renderModals();
}

function closeQuestionPicker() {
    questionPicker = null;
    renderModals();
}

function pickQuestionKind(kind: Question['kind']) {
    if (!questionPicker) return;
    const section = currentVibecheck().sections[questionPicker.sectionIndex];
    const question = makeQuestion(kind);
    section.questions.splice(questionPicker.questionIndex, 0, question);
    questionPicker = null;
    saveModels(models);
    render(true);
    document.querySelector('[data-question-id="' + question.id + '"]')?.scrollIntoView({ block: 'center' });
}

function removeQuestion(sectionIndex: number, questionIndex: number) {
    currentVibecheck().sections[sectionIndex].questions.splice(questionIndex, 1);
    saveModels(models);
    render(true);
}

function moveQuestion(sectionIndex: number, questionIndex: number, delta: number) {
    const sections = currentVibecheck().sections;
    const questions = sections[sectionIndex].questions;
    const target = questionIndex + delta;

    if (target >= 0 && target < questions.length) {
        // move within the same section
        const [question] = questions.splice(questionIndex, 1);
        questions.splice(target, 0, question);
    } else if (delta < 0 && sectionIndex > 0) {
        // move up into the end of the previous section
        const [question] = questions.splice(questionIndex, 1);
        sections[sectionIndex - 1].questions.push(question);
    } else if (delta > 0 && sectionIndex < sections.length - 1) {
        // move down into the start of the next section
        const [question] = questions.splice(questionIndex, 1);
        sections[sectionIndex + 1].questions.unshift(question);
    } else {
        return; // nothing to move
    }

    saveModels(models);
    render(true);
}

function renderQuestionEditor(question: Question, sectionIndex: number, questionIndex: number): HTMLElement {
    const box = el('div', { class: 'question-editor ' + question.kind, 'data-question-id': question.id });
    const section = currentVibecheck().sections[sectionIndex];

    const titleInput = el('input', {
        type: 'text',
        placeholder: 'testo della domanda',
        value: question.title,
        oninput: () => {
            question.title = titleInput.value;
            saveModels(models);
        },
    });

    box.append(
        el('span', { class: 'kind-badge ' + question.kind }, kindLabel(question.kind)),
        el('div', { class: 'question-header' },
            el('button', { class: 'small', title: 'sposta su', onclick: () => moveQuestion(sectionIndex, questionIndex, -1) }, '↑'),
            el('button', { class: 'small', title: 'sposta giù', onclick: () => moveQuestion(sectionIndex, questionIndex, 1) }, '↓'),
            el('button', { class: 'small danger', title: 'elimina domanda', onclick: () => removeQuestion(sectionIndex, questionIndex) }, '✕'),
        ),
        titleInput,
        renderQuestionFields(question, !!section.showResults),
    );
    return box;
}

function renderQuestionFields(question: Question, showResults: boolean): HTMLElement {
    switch (question.kind) {
        case 'dimension':
        case 'opposition': {
            const sliderQuestion = question;
            return el('div', { class: 'flex-h' },
                el('div', {},
                    el('label', {}, 'da'),
                    el('input', {
                        type: 'text',
                        value: sliderQuestion.minLabel,
                        oninput: (event: InputEvent) => {
                            sliderQuestion.minLabel = (event.target as HTMLInputElement).value;
                            saveModels(models);
                        },
                    }),
                ),
                el('div', {},
                    el('label', {}, 'a'),
                    el('input', {
                        type: 'text',
                        value: sliderQuestion.maxLabel,
                        oninput: (event: InputEvent) => {
                            sliderQuestion.maxLabel = (event.target as HTMLInputElement).value;
                            saveModels(models);
                        },
                    }),
                ),
            );
        }
        case 'text':
            return renderTextFields(question, showResults);
        case 'choice':
            return renderChoiceFields(question);
    }
}

function renderTextFields(question: TextQuestion, showResults: boolean): HTMLElement {
    const lengthLabel = el('label', {}, 'lunghezza massima: ' + question.maxLength + ' caratteri');
    const range = makeSlider({
        value: question.maxLength,
        min: 1,
        max: 1000,
        step: 1,
        onChange: (value) => {
            question.maxLength = value;
            lengthLabel.textContent = 'lunghezza massima: ' + question.maxLength + ' caratteri';
            saveModels(models);
        },
    });

    const maxAnswersLabel = el('label', {}, 'risposte massime: ' + question.maxAnswers);
    const maxAnswersRange = makeSlider({
        value: question.maxAnswers,
        min: 2,
        max: MAX_MULTIPLE_ANSWERS,
        step: 1,
        onChange: (value) => {
            question.maxAnswers = value;
            maxAnswersLabel.textContent = 'risposte massime: ' + question.maxAnswers;
            saveModels(models);
        },
    });
    const maxAnswersBox = el('div', {}, maxAnswersLabel, maxAnswersRange);
    maxAnswersBox.style.display = question.multipleAnswers ? 'block' : 'none';

    const multipleCheckbox = el('input', {
        type: 'checkbox',
        checked: question.multipleAnswers || null,
        onchange: (event: Event) => {
            question.multipleAnswers = (event.target as HTMLInputElement).checked;
            maxAnswersBox.style.display = question.multipleAnswers ? 'block' : 'none';
            saveModels(models);
        },
    });

    const votableCheckbox = el('input', {
        type: 'checkbox',
        checked: question.votable || null,
        disabled: !showResults || null,
        onchange: (event: Event) => {
            question.votable = (event.target as HTMLInputElement).checked;
            saveModels(models);
        },
    });

    return el('div', {},
        lengthLabel,
        range,
        el('label', { class: 'check-row' }, votableCheckbox, el('span', {}, 'i partecipanti votano le risposte')),
        el('label', { class: 'check-row' }, multipleCheckbox, el('span', {}, 'più risposte per persona')),
        maxAnswersBox,
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
            class: 'icon-btn danger small',
            title: 'elimina opzione',
            onclick: () => {
                question.choices.splice(index, 1);
                saveModels(models);
                render(true);
            },
        }, '✕');
        choicesBox.append(el('div', { class: 'choice-row' },
            input,
            el('div', { class: 'centered-v' }, removeButton),
        ));
    });

    const maxAnswersLabel = el('label', {}, 'risposte massime: ' + question.maxAnswers);
    const maxAnswersRange = makeSlider({
        value: question.maxAnswers,
        min: 2,
        max: MAX_MULTIPLE_ANSWERS,
        step: 1,
        onChange: (value) => {
            question.maxAnswers = value;
            maxAnswersLabel.textContent = 'risposte massime: ' + question.maxAnswers;
            saveModels(models);
        },
    });
    const maxAnswersBox = el('div', {}, maxAnswersLabel, maxAnswersRange);
    maxAnswersBox.style.display = question.multipleChoices ? 'block' : 'none';

    const multipleCheckbox = el('input', {
        type: 'checkbox',
        checked: question.multipleChoices || null,
        onchange: (event: Event) => {
            question.multipleChoices = (event.target as HTMLInputElement).checked;
            maxAnswersBox.style.display = question.multipleChoices ? 'block' : 'none';
            saveModels(models);
        },
    });

    return el('div', {},
        choicesBox,
        el('button', { class: 'small', onclick: () => {
            question.choices.push('');
            saveModels(models);
            render(true);
        } }, '+ aggiungi opzione'),
        el('label', { class: 'check-row' }, multipleCheckbox, el('span', {}, 'consenti scelta multipla')),
        maxAnswersBox,
    );
}

// ---------- preview modal ----------

function renderPreviewModal(): HTMLElement {
    if (!previewState) return el('div', {});
    const vibecheck = models.find((model) => model.id === previewState.id);
    const overlay = el('div', { class: 'modal-overlay' });
    if (!vibecheck) return overlay;

    const index = Math.min(Math.max(0, previewState.sectionIndex), vibecheck.sections.length - 1);
    const section = vibecheck.sections[index];

    const modal = el('div', { class: 'modal alt-bg' },
        el('button', { class: 'small danger modal-close', title: 'chiudi', onclick: closePreview }, '✕'),
    );
    if (vibecheck.name) modal.append(el('h1', {}, vibecheck.name));

    if (!section) {
        modal.append(el('p', { class: 'empty' }, 'questo vibecheck non ha ancora sezioni'));
    } else {
        modal.append(...sectionHeading(section));
        if (section.questions.length === 0) {
            modal.append(el('p', { class: 'empty' }, 'questa sezione non ha domande'));
        } else {
            modal.append(el('div', {}, ...section.questions.map((question) => renderQuestion(question))));
        }
        modal.append(el('div', { class: 'row space-between' },
            el('button', { class: 'small', disabled: index === 0 || null, onclick: () => previewNav(-1) }, '← indietro'),
            el('span', { class: 'muted' }, (index + 1) + ' / ' + vibecheck.sections.length),
            el('button', { class: 'small', disabled: index >= vibecheck.sections.length - 1 || null, onclick: () => previewNav(1) }, 'avanti →'),
        ));
    }

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closePreview();
    });
    overlay.append(modal);
    return overlay;
}

// ---------- question kind picker modal ----------

function renderQuestionPickerModal(): HTMLElement {
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeQuestionPicker();
    });
    overlay.append(el('div', { class: 'modal' },
        el('button', { class: 'small danger modal-close', title: 'chiudi', onclick: closeQuestionPicker }, '✕'),
        el('h2', {}, 'nuova domanda'),
        el('div', { class: 'kind-grid' },
            renderKindSquare('dimension'),
            renderKindSquare('opposition'),
            renderKindSquare('text'),
            renderKindSquare('choice'),
        ),
    ));
    return overlay;
}

function renderKindSquare(kind: Question['kind']): HTMLElement {
    const square = el('div', { class: 'kind-square ' + kind, onclick: () => pickQuestionKind(kind) });
    square.append(el('div', { class: 'kind-square-title' }, kindLabel(kind)));
    const preview = el('div', { class: 'preview' });
    if (kind === 'dimension' || kind === 'opposition') {
        preview.append(makeSlider({
            value: 0,
            min: kind === 'dimension' ? 0 : -1,
            max: 1,
            centered: kind === 'opposition',
            minLabel: kind === 'dimension' ? '0' : 'no',
            maxLabel: kind === 'dimension' ? '∞' : 'sì',
            disabled: true,
        }));
    } else if (kind === 'text') {
        preview.append(
            el('div', {}, 'domanda'),
            el('input', { type: 'text', placeholder: 'scrivi la risposta', disabled: true }),
        );
    } else {
        preview.append(
            el('div', {}, 'domanda'),
            ...['uno', 'due', 'tre'].map((option) => el('label', { class: 'check-row' },
                el('input', { type: 'radio', name: 'example-choice', disabled: true }),
                el('span', {}, option),
            )),
        );
    }
    square.append(preview);
    return square;
}

// ---------- results view (from a loaded answers file) ----------

function renderResultsView(): HTMLElement {
    if (!answersView) return renderList();
    const children: HTMLElement[] = [
        el('div', { class: 'row space-between' },
            el('button', { class: 'small', onclick: goToList }, '← indietro'),
            el('h1', {}, answersView.vibecheck.name || 'riepilogo'),
        ),
    ];
    for (const section of answersView.sections) {
        children.push(...sectionHeading(section.section));
        children.push(el('div', {}, ...renderResults(section.results, section.section.questions, render)));
    }
    return el('main', { class: 'presenter' }, ...children);
}

function computeResults(vibecheck: VibecheckModel, answers: (Answer | null)[][]): { section: Section; results: QuestionResult[] }[] {
    const sections = vibecheck.sections.map((section) => ({ section, results: [] as QuestionResult[] }));
    let column = 0;
    vibecheck.sections.forEach((section, sectionIndex) => {
        section.questions.forEach((question, questionIndex) => {
            const collected: Answer[] = [];
            for (const row of answers) {
                const value = row[column];
                if (value === null || value === undefined) continue;
                if (Array.isArray(value)) collected.push(...value);
                else collected.push(value);
            }
            column++;

            let result: QuestionResult;
            if (question.kind === 'dimension' || question.kind === 'opposition') {
                const numbers = collected.filter((a): a is number => typeof a === 'number');
                let average = 0;
                let variance = 0;
                if (numbers.length > 0) {
                    average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
                    variance = numbers.reduce((sum, n) => sum + (n - average) ** 2, 0) / numbers.length;
                }
                result = { kind: question.kind, average, variance, values: numbers };
            } else if (question.kind === 'choice') {
                const counts: Record<string, number> = {};
                for (const answer of collected) {
                    if (typeof answer === 'string') counts[answer] = (counts[answer] || 0) + 1;
                }
                result = { kind: 'choice', counts };
            } else {
                result = {
                    kind: 'text',
                    answers: collected.filter((a): a is string => typeof a === 'string'),
                    scores: {},
                    myVotes: {},
                    censored: [],
                };
            }
            sections[sectionIndex].results[questionIndex] = result;
        });
    });
    return sections;
}

const params = new URLSearchParams(window.location.search);
const requestedId = params.get('id');
if (params.has('new')) {
    createNew();
} else if (requestedId && models.some((model) => model.id === requestedId)) {
    startEditing(requestedId);
} else {
    render();
}
