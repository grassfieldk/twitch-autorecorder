import { exec, spawn } from 'child_process';
import { WebhookClient } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import winston from 'winston';

dotenv.config();

const VIDEO_DIR = expandHome(process.env.VIDEO_DIR || path.join(__dirname, 'downloads'));
const INTERVAL = Number(process.env.INTERVAL) || 55;
const LOGDIR = path.join(__dirname, 'logs');
const EXIT_FILE = path.join(__dirname, './exit');

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

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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

const execAsync = promisify(exec);

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '', p.slice(2));
  }
  return p;
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

function checkCommandExists(cmd: string): boolean {
  try {
    require('child_process').execSync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

function buildStreamlinkCmd({ user, token }: { user: string; token?: string }) {
  const tokenOpt = token ? `--twitch-api-header 'Authorization=OAuth ${token}'` : '';
  const url = `https://www.twitch.tv/${user}`;
  return `streamlink --twitch-disable-hosting ${tokenOpt} --stream-url ${url} best`;
}

const discord = {
  msg: async (message: string) => {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
      const match = DISCORD_WEBHOOK_URL.match(/discord\.com\/api\/webhooks\/(\d+)\/([\w-]+)/);
      if (!match) {
        console.warn('Invalid Discord Webhook URL format');
        return;
      }

      const [_, id, token] = match;
      const webhookClient = new WebhookClient({ id, token });

      const MENTION_TARGET_ID = process.env.DISCORD_MENTION_TARGET_ID;
      const mention = MENTION_TARGET_ID ? `<@${MENTION_TARGET_ID}>\n` : '';

      await webhookClient.send(`${mention}[${USER_NAME}] ${message}`);
    } catch (err) {
      console.warn('Failed to send Discord notification:', err);
    }
  },
};

async function getAndRecordProcessAsync(): Promise<void> {
  cleanOldLogs();

  if (fs.existsSync(EXIT_FILE)) {
    log.watch('Exit file detected, aborting.');
    process.exit(0);
  }

  let url: string | null = null;
  try {
    const cmd = buildStreamlinkCmd({ user: USER_NAME, token: AUTH_TOKEN });
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout.includes('error: Unauthorized') || stderr.includes('error: Unauthorized')) {
      await discord.msg('Twitch OAuth token is invalid. Please check your .env.');
      console.error('Twitch OAuth token is invalid. Please check your .env.');
      process.exit(1);
    }
    url = stdout.trim();
  } catch (err: any) {
    if (
      (err.stdout && err.stdout.includes('error: Unauthorized')) ||
      (err.stderr && err.stderr.includes('error: Unauthorized'))
    ) {
      await discord.msg('Twitch OAuth token is invalid. Please check your .env.');
      console.error('Twitch OAuth token is invalid. Please check your .env.');
      process.exit(1);
    }
    log.watch(`${USER_NAME} is offline.`);
    return;
  }

  if (url) {
    const startMessage = `${USER_NAME} is online! Starting download...`;
    log.watch(startMessage);
    await discord.msg(startMessage);

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
          log.watch('Download completed.');
        } else {
          log.watch(`Download failed with exit code ${code}.`);
        }
        resolve();
      });
    });
  }
}

async function main(): Promise<void> {
  while (true) {
    await getAndRecordProcessAsync();
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
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
