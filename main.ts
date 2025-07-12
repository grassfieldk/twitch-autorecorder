import { exec, spawn } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import winston from 'winston';

dotenv.config();

const VIDEO_DIR = expandHome(process.env.VIDEO_DIR || path.join(__dirname, 'downloads'));
const INTERVAL = Number(process.env.INTERVAL) || 55;
const LOGDIR = path.join(__dirname, 'logs');
const EXIT_FILE = path.join(__dirname, '../exit');

const USER_NAME = process.argv[2];
if (!USER_NAME) {
  console.error('No username provided. Usage: node main.js <twitch_username>');
  process.exit(1);
}

const AUTH_TOKEN = process.env.TWITCH_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.warn(
    'TWITCH_AUTH_TOKEN is not set in `.env`. You may get ads screen in your recordings.'
  );
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY/MM/DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${level.toUpperCase()}] ${timestamp}: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

function cleanOldLogs(): void {
  const files = fs.readdirSync(LOGDIR);
  const now = Date.now();

  files.forEach((file) => {
    const filePath = path.join(LOGDIR, file);
    try {
      const stat = fs.statSync(filePath);
      if ((now - stat.mtimeMs) / (1000 * 60 * 60 * 24) > 3) {
        fs.unlinkSync(filePath);
      }
    } catch {
      logger.warn(`[WARN] Failed to stat or delete log file: ${filePath}`);
    }
  });
}

const execAsync = promisify(exec);

function getLogTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLogLine(msg: string, tokenStatus: string): string {
  return `[INFO] ${getLogTimestamp()} ${tokenStatus}: ${msg}`;
}

function getLogFilePath(type: 'watch' | 'download'): string {
  if (type === 'watch') {
    return path.join(LOGDIR, `${USER_NAME}_watch_${getDate()}.log`);
  } else {
    return path.join(LOGDIR, `${USER_NAME}_download_${getDateTimeShort()}.log`);
  }
}

function writeLog(type: 'watch' | 'download', msg: string) {
  const tokenStatus = AUTH_TOKEN ? '(auth: yes)' : '(auth: no)';
  const logLine = formatLogLine(msg, tokenStatus);
  logger.info(`${tokenStatus}: ${msg}`);
  fs.appendFileSync(getLogFilePath(type), logLine + '\n');
}

const log = {
  watch: (msg: string) => writeLog('watch', msg),
  download: (msg: string) => writeLog('download', msg),
};

async function getAndRecordProcessAsync(): Promise<void> {
  cleanOldLogs();

  if (fs.existsSync(EXIT_FILE)) {
    log.watch('exit file detected, aborting..');
    process.exit(0);
  }

  let url: string | null = null;
  try {
    const tokenOpt = AUTH_TOKEN ? `--twitch-api-header 'Authorization=OAuth ${AUTH_TOKEN}'` : '';
    const cmd = `streamlink --twitch-disable-hosting ${tokenOpt} --stream-url https://www.twitch.tv/${USER_NAME} best`;
    const { stdout } = await execAsync(cmd);

    url = stdout.trim();
  } catch {
    log.watch(`${USER_NAME} is offline.`);
    return;
  }

  if (url) {
    log.watch(`${USER_NAME} is online! downloading..`);

    const datetime = getDateTime();
    const outFile = path.join(VIDEO_DIR, `${USER_NAME}_${datetime}.mp4`);

    await new Promise<void>((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-i', url, '-c', 'copy', outFile]);
      const logStream = fs.createWriteStream(
        path.join(LOGDIR, `${USER_NAME}_download_${getDateTimeShort()}.log`)
      );

      ffmpeg.stderr.pipe(logStream);
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          log.watch('Download complete.');
        } else {
          log.watch(`Download failed with code ${code}.`);
        }
        resolve();
      });
    });
  }
}

async function checkTwitchTokenValid(): Promise<boolean> {
  const tokenOpt = AUTH_TOKEN ? `--twitch-api-header 'Authorization=OAuth ${AUTH_TOKEN}'` : '';
  const cmd = `streamlink --twitch-disable-hosting ${tokenOpt} https://www.twitch.tv/${USER_NAME}`;

  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout.includes('error: Unauthorized') || stderr.includes('error: Unauthorized')) {
      return false;
    }
    return true;
  } catch (err: any) {
    if (
      (err.stdout && err.stdout.includes('error: Unauthorized')) ||
      (err.stderr && err.stderr.includes('error: Unauthorized'))
    ) {
      return false;
    }
    return true;
  }
}

async function main(): Promise<void> {
  const valid = await checkTwitchTokenValid();
  if (!valid) {
    console.error('Twitch OAuth token is invalid. Please check your .env.');
    process.exit(1);
  }
  while (true) {
    await getAndRecordProcessAsync();
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
  }
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

function checkCommandExists(cmd: string): boolean {
  try {
    require('child_process').execSync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

if (!checkCommandExists('streamlink')) {
  console.error('streamlink is not installed or not in PATH.');
  process.exit(1);
}
if (!checkCommandExists('ffmpeg')) {
  console.error('ffmpeg is not installed or not in PATH.');
  process.exit(1);
}

main();
