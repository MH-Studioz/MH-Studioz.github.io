/**
 * Splits each scanned car's wheels into four named nodes (`wheel-lf` … `wheel-rr`)
 * with the axle at the node origin, so the body shell holds no second copy and
 * the runtime can simply rotate them.
 *
 * Needs the dev server (`npx vite --port 5180`) and writes uncompressed GLBs to
 * .tmp-cars/split; scripts/split-car-wheels-compress.mjs installs them.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const DIR = 'public/assets/models/cars';
const OUT = '.tmp-cars/split';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const only = process.argv.slice(2).filter((a) => a.endsWith('.glb'));

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).filter((f) => !only.length || only.includes(f));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--js-flags=--max-old-space-size=4096',
  ],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.goto('http://127.0.0.1:5180/.tmp-cars/split.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });

for (const file of files) {
  try {
    const result = await page.evaluate((f) => window.__split(f), file);
    fs.writeFileSync(`${OUT}/${file}`, Buffer.from(result.base64, 'base64'));
    console.log(`\n== ${file} wheelMeshes ${result.wheelMeshes} bodyTris ${Math.round(result.bodyTris)} size ${(fs.statSync(`${OUT}/${file}`).size / 1024 / 1024).toFixed(2)} MB`);
    for (const s of result.stats) {
      console.log(`   ${s.key}: tris ${Math.round(s.tris)} r ${s.radius.toFixed(3)} at ${s.centre.map((v) => v.toFixed(2)).join(',')}`);
    }
  } catch (error) {
    console.log(`\n== ${file} FAILED ${error.message}`);
  }
}

await browser.close();
