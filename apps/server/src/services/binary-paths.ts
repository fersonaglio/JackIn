import { execSync } from 'child_process';

// Binary resolution: env override first, then auto-detect via PATH (which).
// No hardcoded machine paths — portable across macOS/Linux/Docker.
function resolveBin(name: string, envKey: string): string {
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  try {
    const found = execSync(`which ${name}`, { stdio: 'pipe' }).toString().trim();
    if (found) return found;
  } catch {
    // ignore
  }
  return name;
}

export const FFMPEG_BIN = resolveBin('ffmpeg', 'FFMPEG_BIN');

export const FFPROBE_BIN = resolveBin('ffprobe', 'FFPROBE_BIN');
