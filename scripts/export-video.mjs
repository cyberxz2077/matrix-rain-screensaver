import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { muxH264 } from './mp4.mjs';

// Use the project's Playwright dependency and an installed Google Chrome.
async function loadPlaywright() {
    const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
    for (const candidate of candidates) {
        try { return await import(candidate); } catch (error) {
            if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
        }
    }
    throw new Error('Playwright was not found. Run npm ci in the project directory.');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const width = Number(process.argv[2] || 2560);
const height = Number(process.argv[3] || 1440);
if (![width, height].every(value => Number.isInteger(value) && value > 0 && value % 2 === 0)) {
    throw new Error('Width and height must be positive, even integers');
}
const output = resolve(process.argv[4] || resolve(root, `output/matrix-rain-${width}x${height}-30s.mp4`));
try { await access(output); throw new Error(`Output already exists: ${output}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(dirname(output), { recursive: true });
const html = await readFile(resolve(root, 'matrix-rain.html'));
const server = createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/matrix-rain.html') {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('console', message => console.log(message.text()));
    page.on('pageerror', error => console.error(error));
    await page.goto(`http://127.0.0.1:${server.address().port}/matrix-rain.html?manual=1`);
    const samples = [];
    let configuration;
    await page.exposeFunction('saveEncodedBatch', (batch, description) => {
        if (description) configuration = Buffer.from(description, 'base64');
        for (const sample of batch) samples.push({ ...sample, data: Buffer.from(sample.data, 'base64') });
    });
    const result = await page.evaluate(async () => {
        const rain = window.matrixRain;
        const canvas = document.querySelector('canvas');
        const config = { codec: 'avc1.640033', width: canvas.width, height: canvas.height,
            bitrate: 24000000, framerate: rain.fps, latencyMode: 'realtime',
            avc: { format: 'avc' } };
        if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('H.264 configuration is unsupported');
        const base64 = data => {
            const array = new Uint8Array(data);
            let binary = '';
            for (let i = 0; i < array.length; i += 8192) {
                binary += String.fromCharCode(...array.subarray(i, i + 8192));
            }
            return btoa(binary);
        };
        let batch = [];
        let description;
        let failure;
        const encoder = new VideoEncoder({
            output(chunk, metadata) {
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                batch.push({ data: base64(data), key: chunk.type === 'key', timestamp: chunk.timestamp });
                if (metadata.decoderConfig?.description) description = base64(metadata.decoderConfig.description);
            },
            error(error) { failure = error; }
        });
        try {
            encoder.configure(config);
            for (let frame = 0; frame < rain.totalFrames; frame++) {
                if (failure) throw failure;
                rain.renderFrame(frame);
                const timestamp = Math.round(frame * 1e6 / rain.fps);
                const videoFrame = new VideoFrame(canvas, { timestamp,
                    duration: Math.round((frame + 1) * 1e6 / rain.fps) - timestamp });
                try { encoder.encode(videoFrame, { keyFrame: frame % 60 === 0 }); }
                finally { videoFrame.close(); }
                // Bound memory and transfer each second without tying video time to rendering time.
                if ((frame + 1) % rain.fps === 0) {
                    await encoder.flush();
                    if (failure) throw failure;
                    await window.saveEncodedBatch(batch, description);
                    batch = [];
                    description = undefined;
                    console.log(`Encoded ${frame + 1}/${rain.totalFrames} frames`);
                }
            }
            await encoder.flush();
            if (failure) throw failure;
            if (batch.length) await window.saveEncodedBatch(batch, description);
            return { width: canvas.width, height: canvas.height, fps: rain.fps,
                duration: rain.duration, frameCount: rain.totalFrames };
        } finally { if (encoder.state !== 'closed') encoder.close(); }
    });
    if (samples.length !== result.frameCount) throw new Error(`Expected ${result.frameCount} samples, got ${samples.length}`);
    const video = muxH264({ ...result, samples, configuration });
    await writeFile(output, video, { flag: 'wx' });
    console.log(JSON.stringify({ ...result, bytes: video.length, output }, null, 2));
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
