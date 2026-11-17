// emoji overlay animations for the presenter view

import { el } from './common';

export function spawnEmoji(emoji: string) {
    if (emoji === '💣') { spawnBomb(); return; }
    if (emoji === '✨') { spawnSparkles(); return; }
    if (emoji === '🌸') { spawnFlower(); return; }
    if (emoji === '💩') { spawnPoop(); return; }
    if (emoji === '💧') { spawnWater(); return; }
    if (emoji === '🔥') { spawnFire(); return; }
    spawnGeneric(emoji);
}

function getEmojiLayer(): HTMLElement {
    let layer = document.querySelector('.emoji-layer') as HTMLElement | null;
    if (!layer) {
        layer = el('div', { class: 'emoji-layer' });
        document.body.append(layer);
    }
    return layer;
}

function spawnGeneric(emoji: string) {
    const span = el('span', { class: 'emoji-fly' }, emoji);
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.bottom = '-24px';
    getEmojiLayer().append(span);
    const animation = span.animate(
        [
            { transform: 'translateY(0) scale(0.5)', opacity: 0 },
            { transform: 'translateY(-120px) scale(1.3)', opacity: 1, offset: 0.15 },
            { transform: 'translateY(-360px) scale(1)', opacity: 0 },
        ],
        { duration: 2400, easing: 'ease-out' },
    );
    animation.onfinish = () => span.remove();
}

function spawnBomb() {
    const bomb = el('span', { class: 'emoji-fly' }, '💣');
    const left = (5 + Math.random() * 90) + '%';
    bomb.style.left = left;
    bomb.style.top = '-40px';
    const targetY = window.innerHeight * (0.35 + Math.random() * 0.35);
    getEmojiLayer().append(bomb);

    const fall = bomb.animate(
        [
            { transform: 'translateY(0) rotate(-15deg)', opacity: 1 },
            { transform: `translateY(${targetY}px) rotate(10deg)`, opacity: 1 },
        ],
        { duration: 900, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    );
    fall.onfinish = () => {
        bomb.textContent = '💥';
        bomb.animate(
            [
                { transform: `translateY(${targetY}px) rotate(10deg) scale(1)`, opacity: 1 },
                { transform: `translateY(${targetY}px) rotate(10deg) scale(2.8)`, opacity: 0 },
            ],
            { duration: 450, easing: 'ease-out' },
        ).onfinish = () => bomb.remove();
    };
}

function spawnSparkles() {
    const span = el('span', { class: 'emoji-fly' }, '✨');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = (10 + Math.random() * 70) + '%';
    getEmojiLayer().append(span);

    const spin = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 80);
    span.animate(
        [
            { transform: 'scale(0) rotate(0deg)', opacity: 0 },
            { transform: `scale(1.4) rotate(${spin}deg)`, opacity: 1, offset: 0.25 },
            { transform: `scale(0.9) rotate(${spin * 1.5}deg)`, opacity: 0.8, offset: 0.5 },
            { transform: `scale(1.2) rotate(${spin * 2}deg)`, opacity: 1, offset: 0.7 },
            { transform: 'scale(0) rotate(0deg)', opacity: 0 },
        ],
        { duration: 2400, easing: 'ease-in-out' },
    ).onfinish = () => span.remove();
}

function spawnFlower() {
    const span = el('span', { class: 'emoji-fly' }, '🌸');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = (10 + Math.random() * 70) + '%';
    span.style.fontSize = (1.8 + Math.random() * 1.2) + 'rem';
    getEmojiLayer().append(span);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    span.animate(
        [
            { transform: 'rotate(0deg) scale(0.5)', opacity: 0 },
            { transform: `rotate(${spin * 0.5}deg) scale(1)`, opacity: 1, offset: 0.2 },
            { transform: `rotate(${spin}deg) scale(2)`, opacity: 0 },
        ],
        { duration: 2800, easing: 'cubic-bezier(0.12, 0.6, 0.2, 1)' },
    ).onfinish = () => span.remove();
}

function spawnPoop() {
    const span = el('span', { class: 'emoji-fly' }, '💩');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = (10 + Math.random() * 70) + '%';
    span.style.fontSize = (1.8 + Math.random() * 1.2) + 'rem';
    getEmojiLayer().append(span);
    const popIn = span.animate(
        [
            { transform: 'scale(0)', opacity: 0 },
            { transform: 'scale(1.25)', opacity: 1, offset: 0.7 },
            { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 450, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
    popIn.onfinish = () => {
        window.setTimeout(() => {
            span.animate(
                [
                    { transform: 'scale(1)', opacity: 1 },
                    { transform: 'scale(0)', opacity: 0 },
                ],
                { duration: 250, easing: 'ease-in' },
            ).onfinish = () => span.remove();
        }, 600);
    };
}

function spawnWater() {
    const span = el('span', { class: 'emoji-fly' }, '💧');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.top = '-40px';
    getEmojiLayer().append(span);

    const fallY = window.innerHeight + 60;
    span.animate(
        [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: `translateY(${fallY}px)`, opacity: 1 },
        ],
        { duration: 1800, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    ).onfinish = () => span.remove();
}

function spawnFire() {
    const span = el('span', { class: 'emoji-fly' }, '🔥');
    span.style.left = (5 + Math.random() * 90) + '%';
    span.style.bottom = '-40px';
    getEmojiLayer().append(span);

    const rise = window.innerHeight * 0.5;
    span.animate(
        [
            { transform: 'translateY(0) translateX(0)', opacity: 1 },
            { transform: `translateY(${-rise * 0.25}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.25 },
            { transform: `translateY(${-rise * 0.5}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.5 },
            { transform: `translateY(${-rise * 0.75}px) translateX(${(Math.random() - 0.5) * 80}px)`, opacity: 1, offset: 0.75 },
            { transform: `translateY(${-rise}px) translateX(0)`, opacity: 0 },
        ],
        { duration: 1200, easing: 'linear' },
    ).onfinish = () => span.remove();
}
