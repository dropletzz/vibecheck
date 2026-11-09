import { el } from '../common';

document.body.replaceChildren(
    el('main', { class: 'home' },
        el('h1', {}, 'vibecheck'),
        el('p', { class: 'tagline' }, 'crea domande, raccogli risposte dal vivo e visualizza i risultati in tempo reale'),
        el('div', { class: 'home-actions' },
            el('button', { class: 'big', onclick: () => { window.location.href = 'create.html?new=1'; } }, 'crea un vibecheck'),
            el('button', { class: 'big', onclick: () => { window.location.href = 'create.html'; } }, 'gestisci i tuoi vibecheck'),
        ),
    ),
);
