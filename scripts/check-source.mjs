import {chromium} from 'playwright';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, dirname} from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 2560, height: 1440}});
  await page.goto(pathToFileURL(resolve(root, 'matrix-rain.html')).href + '?manual=1');
  const report = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const capture = frame => {
      window.matrixRain.renderFrame(frame);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const equal = (a, b) => a.every((value, index) => value === b[index]);
    const periodicity = [[0, 900], [1, 901], [449, 1349], [899, -1]]
      .map(([a, b]) => ({frames: [a, b], identical: equal(capture(a), capture(b))}));
    const baseline = capture(317);
    capture(10); capture(850);
    return {periodicity, independentOfHistory: equal(baseline, capture(317))};
  });
  if (!report.periodicity.every(pair => pair.identical) || !report.independentOfHistory) {
    throw new Error(JSON.stringify(report));
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
