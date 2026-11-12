// usage: node spike/shot.mjs <name> <hash> [width] [height] — headless screenshot of the dashboard
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [name, hash, w = '1400', h = '900'] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'at-'));
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, `--window-size=${w},${h}`, `--timeout=${process.env.SHOT_TIMEOUT ?? 8000}`, `--screenshot=${path.join(dir, 'shots', name)}`, `http://127.0.0.1:47800/${hash}`], { stdio: 'ignore', timeout: 40000 });
fs.rmSync(prof, { recursive: true, force: true });
