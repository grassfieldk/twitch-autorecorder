# Twitch Autorecorder

Automatically monitors and records Twitch streams.

## Usage

1. Copy `.env.example` to `.env` and edit as needed
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start recording:
   ```bash
   npm start -- <twitch_username>
   ```

## Log Files

- `logs/{username}_watch_yyyymmdd.log` — Main event log (rotated daily)
- `logs/{username}_download_yyyymmdd_hhmm.log` — FFmpeg download log

## License

MIT
