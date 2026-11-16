// thin typed wrapper around the vendored qr-creator (src/client/deps/qr-creator.js)

import './deps/qr-creator.js';

export interface QrOptions {
    text: string;
    size?: number;
    fill?: string;
    background?: string | null;
    radius?: number; // 0..0.5
    ecLevel?: 'L' | 'M' | 'Q' | 'H';
    quiet?: number;
    minVersion?: number;
    maxVersion?: number;
    left?: number;
    top?: number;
}

export const DEFAULT_QR_OPTIONS: Required<QrOptions> = {
    text: '',
    size: 480,
    fill: '#000',
    background: '#fff',
    radius: 0,
    ecLevel: 'M',
    quiet: 0,
    minVersion: 1,
    maxVersion: 40,
    left: 0,
    top: 0,
};

const QrCreator = (self as unknown as { QrCreator?: { render: (options: QrOptions, element: HTMLCanvasElement) => void } }).QrCreator;

export function renderQrCode(canvas: HTMLCanvasElement, options: Partial<QrOptions> = {}): void {
    if (!QrCreator) throw new Error('qr-creator non caricato');
    QrCreator.render({ ...DEFAULT_QR_OPTIONS, ...options }, canvas);
}
