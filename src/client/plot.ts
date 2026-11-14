// shared canvas plotting functions

function getCssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function accentColor(): string {
    return getCssVar('--accent-strong') || '#6d95b8';
}

function textColor(): string {
    return getCssVar('--text') || '#33302a';
}

function fontFamily(): string {
    return getCssVar('--main-font') || 'sans-serif';
}

const AXIS_COLOR = '#000000';

// horizontal axis with ticks at both ends and in the middle, labels on the same side as the ticks
export function drawHorizontalAxis(ctx: CanvasRenderingContext2D, leftX: number, rightX: number, y: number, minLabel: string, maxLabel: string, ticksBelow: boolean = true, labelsMargin: number = 0): void {
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftX, y);
    ctx.lineTo(rightX, y);
    ctx.stroke();

    const tickLength = 5;
    ctx.beginPath();
    for (const x of [leftX, (leftX + rightX) / 2, rightX]) {
        if (ticksBelow) {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + tickLength);
        } else {
            ctx.moveTo(x, y - tickLength);
            ctx.lineTo(x, y + tickLength);
        }
    }
    ctx.stroke();

    ctx.fillStyle = AXIS_COLOR;
    ctx.font = '14px ' + fontFamily();
    const direction = ticksBelow ? 1 : -1;
    const labelOffset = direction * (tickLength + 4 + labelsMargin);
    ctx.textBaseline = ticksBelow ? 'top' : 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(minLabel, leftX, y + labelOffset);
    ctx.textAlign = 'right';
    ctx.fillText(maxLabel, rightX, y + labelOffset);
}

// discrete density (histogram-like vertical bars)
export function drawDiscreteDensity(ctx: CanvasRenderingContext2D, width: number, height: number, values: number[], min: number, max: number, minLabel: string, maxLabel: string, bars: number): void {
    ctx.clearRect(0, 0, width, height);

    const binWidth = (max - min) / bars;
    const counts = new Array(bars).fill(0);
    for (const value of values) {
        let index = Math.floor((value - min) / binWidth);
        if (index < 0) index = 0;
        if (index >= bars) index = bars - 1;
        counts[index]++;
    }
    const maxCount = Math.max(1, ...counts);
    const total = values.length;

    const color = accentColor();

    const avgDotRadius = 6;
    const topPadding = 16;
    const bottomPadding = 26;
    const sidePadding = avgDotRadius + 2;

    const plotBottom = height - bottomPadding;
    const plotHeight = plotBottom - topPadding;
    const plotWidth = width - sidePadding * 2;
    const barWidth = plotWidth / bars;

    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
        const barHeight = (counts[i] / maxCount) * plotHeight;
        const x = sidePadding + i * barWidth;
        const y = plotBottom - barHeight;
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.strokeStyle = AXIS_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barWidth, barHeight);

        if (counts[i] > 0) {
            const percent = Math.round((counts[i] / total) * 100);
            ctx.fillStyle = AXIS_COLOR;
            ctx.font = '13px ' + fontFamily();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(percent + '%', x + barWidth / 2, y - 2);
            ctx.fillStyle = color;
        }
    }

    drawHorizontalAxis(ctx, sidePadding, width - sidePadding, plotBottom, minLabel, maxLabel);

    const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : min;
    const dotX = sidePadding + ((average - min) / (max - min)) * plotWidth;
    ctx.beginPath();
    ctx.arc(dotX, plotBottom, avgDotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
}

// continuous density (gaussian kernel density estimate, filled area)
export function drawContinuousDensity(ctx: CanvasRenderingContext2D, width: number, height: number, values: number[], min: number, max: number, minLabel: string, maxLabel: string): void {
    ctx.clearRect(0, 0, width, height);

    const color = accentColor();
    const topPadding = 24;
    const bottomPadding = 26;
    const sidePadding = 8;

    const plotBottom = height - bottomPadding;
    const plotTop = topPadding;
    const plotWidth = width - sidePadding * 2;

    const samples = 100;
    const bandwidth = Math.max((max - min) / 20, 1e-6);
    const densities = new Array(samples).fill(0);

    for (const value of values) {
        for (let i = 0; i < samples; i++) {
            const x = min + ((i + 0.5) / samples) * (max - min);
            const d = (x - value) / bandwidth;
            densities[i] += Math.exp(-0.5 * d * d);
        }
    }

    const maxDensity = Math.max(1, ...densities);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sidePadding, plotBottom);
    for (let i = 0; i < samples; i++) {
        const x = sidePadding + ((i + 0.5) / samples) * plotWidth;
        const y = plotBottom - (densities[i] / maxDensity) * (plotBottom - plotTop);
        ctx.lineTo(x, y);
    }
    ctx.lineTo(width - sidePadding, plotBottom);
    ctx.closePath();
    ctx.fill();

    drawHorizontalAxis(ctx, sidePadding, width - sidePadding, plotBottom, minLabel, maxLabel);
}

// 1d scatter (dots centered on a horizontally centered axis, optionally aggregated with k-means)
export function drawScatter1d(ctx: CanvasRenderingContext2D, width: number, height: number, values: number[], min: number, max: number, minLabel: string, maxLabel: string, aggregate: boolean, k: number): void {
    ctx.clearRect(0, 0, width, height);

    const color = accentColor();
    const sidePadding = 32;
    const axisY = height / 2;
    const plotWidth = width - sidePadding * 2;
    const mapX = (value: number) => sidePadding + ((value - min) / (max - min)) * plotWidth;

    drawHorizontalAxis(ctx, sidePadding, width - sidePadding, axisY, minLabel, maxLabel, false, height / 3);

    if (aggregate) {
        const clusters = kmeans1d(values, Math.min(k, Math.max(1, values.length)));
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        for (const cluster of clusters) {
            const radius = 10 * Math.sqrt(cluster.count);
            ctx.beginPath();
            ctx.arc(mapX(cluster.center), axisY, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        for (const value of values) {
            ctx.beginPath();
            ctx.arc(mapX(value), axisY, 10, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// horizontal barplot (used by choice questions)
export function drawBarplot(ctx: CanvasRenderingContext2D, width: number, height: number, entries: [string, number][]): void {
    ctx.clearRect(0, 0, width, height);

    const rowHeight = height / entries.length;
    const maxCount = Math.max(1, ...entries.map(([, count]) => count));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const barColor = accentColor();
    const labelTextColor = textColor();
    const labelWidth = 110;
    const rightSpace = 56;

    entries.forEach(([label, count], i) => {
        const y = i * rowHeight;
        const barHeight = rowHeight * 0.55;
        const barWidth = (count / maxCount) * (width - labelWidth - rightSpace);
        const barY = y + (rowHeight - barHeight) / 2;

        ctx.fillStyle = barColor;
        ctx.fillRect(labelWidth, barY, barWidth > 0 ? barWidth : 1, barHeight);

        ctx.fillStyle = labelTextColor;
        ctx.font = '14px ' + fontFamily();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const shortLabel = label.length > 12 ? label.slice(0, 12) + '…' : label;
        ctx.fillText(shortLabel, labelWidth - 8, y + rowHeight / 2);

        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        ctx.textAlign = 'left';
        ctx.fillText(percent + '%', labelWidth + barWidth + 6, y + rowHeight / 2);
    });
}

function kmeans1d(values: number[], k: number): { center: number; count: number }[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const centroids: number[] = [];
    for (let i = 0; i < k; i++) {
        centroids.push(min + ((i + 0.5) / k) * (max - min));
    }

    for (let iter = 0; iter < 30; iter++) {
        const sums = new Array(k).fill(0);
        const counts = new Array(k).fill(0);
        for (const value of values) {
            let best = 0;
            let bestDist = Infinity;
            for (let c = 0; c < k; c++) {
                const dist = Math.abs(value - centroids[c]);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = c;
                }
            }
            sums[best] += value;
            counts[best]++;
        }
        let moved = false;
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                const next = sums[c] / counts[c];
                if (Math.abs(next - centroids[c]) > 1e-9) moved = true;
                centroids[c] = next;
            }
        }
        if (!moved) break;
    }

    const counts = new Array(k).fill(0);
    for (const value of values) {
        let best = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
            const dist = Math.abs(value - centroids[c]);
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        }
        counts[best]++;
    }

    return centroids
        .map((center, i) => ({ center, count: counts[i] }))
        .filter((cluster) => cluster.count > 0)
        .sort((a, b) => a.center - b.center);
}
