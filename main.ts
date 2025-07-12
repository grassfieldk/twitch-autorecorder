import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const VIDEO_DIR = expandHome(process.env.VIDEO_DIR || path.join(__dirname, 'downloads'));
const INTERVAL = Number(process.env.INTERVAL) || 55;
const LOGDIR = path.join(__dirname, 'logs');
const EXIT_FILE = path.join(__dirname, '../exit');

function usage() {
  console.error('[ERROR] No username provided. Usage: node main.js <twitch_username>');
  process.exit(1);
}

const USER_NAME = process.argv[2];
if (!USER_NAME) usage();

function cleanOldLogs(): void {
  const files = fs.readdirSync(LOGDIR);
  const now = Date.now();
  files.forEach(file => {
    const filePath = path.join(LOGDIR, file);
    try {
      const stat = fs.statSync(filePath);
      if ((now - stat.mtimeMs) / (1000 * 60 * 60 * 24) > 3) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  });
}

function log(msg: string, logfile: string): void {
  const line = `[INFO] ${new Date().toLocaleString()}: ${msg}`;
  fs.appendFileSync(logfile, line + '\n');
  console.log(line);
}



function getAndRecordProcess(): void {
  cleanOldLogs();
  const logfile = path.join(LOGDIR, `watch_${getDate()}.log`);
  if (fs.existsSync(EXIT_FILE)) {
    log('exit file detected, aborting..', logfile);
    process.exit(0);
  }
  let url: string | null = null;
  try {
    url = execSync(`streamlink --twitch-disable-hosting --stream-url https://www.twitch.tv/${USER_NAME} best`).toString().trim();
  } catch {
    log(`${USER_NAME} is offline.`, logfile);
    return;
  }
  if (url) {
    log(`${USER_NAME} is online! downloading..`, logfile);
    const datetime = getDateTime();
    const outFile = path.join(VIDEO_DIR, `${USER_NAME}_${datetime}.mp4`);
    const ffmpeg = spawn('ffmpeg', ['-i', url, '-c', 'copy', outFile]);
    const downloadLog = path.join(LOGDIR, `download_${getDateTimeShort()}.log`);
    const logStream = fs.createWriteStream(downloadLog);
    ffmpeg.stderr.pipe(logStream);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        log('Download complete.', logfile);
      } else {
        log(`Download failed with code ${code}.`, logfile);
      }
    });
  }
}


function main(): void {
  getAndRecordProcess();
  setInterval(getAndRecordProcess, INTERVAL * 1000);
}

function getDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function getDateTime(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}
function getDateTimeShort(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '', p.slice(2));
  }
  return p;
}

main();
