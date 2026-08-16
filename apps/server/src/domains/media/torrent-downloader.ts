// @ts-ignore
import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';
import { TRACKERS_LIST, TRACKERS_COMMA } from './trackers.js';

export interface DownloadProgress {
  progress: number;
  downloadSpeed: string;
  bytesDownloaded: number;
  status: string;
}

// Match exato de código de episódio: "s01e01" não pode casar com "s01e10".
function matchesEpisodeCode(filePath: string, epKey: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.includes(epKey)) return false;
  // Garante que não há um dígito extra após o código (S01E01x).
  const idx = lower.indexOf(epKey);
  const after = lower[idx + epKey.length] || '';
  return !/\d/.test(after);
}

// Global registry of running downloads (projectId -> active download handle)
export const activeDownloads = new Map<string, { 
  type: 'webtorrent' | 'aria2c';
  client?: any; 
  torrent?: any; 
  childProcess?: any;
}>();

// Helper to check if aria2c is installed on the system
function isAria2Available(): boolean {
  try {
    execSync('which aria2c');
    return true;
  } catch (err) {
    return false;
  }
}

// Trackers list is centralized in ./trackers.ts (env-overridable via P2P_TRACKERS)

export async function downloadEpisodeFromMagnet(
  magnetUrl: string,
  episodeCode: string, // e.g. "S01E01"
  outputDir: string,
  projectId: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  // Ensure outputDir exists
  fs.mkdirSync(outputDir, { recursive: true });

  if (isAria2Available()) {
    console.log(`[Torrent] Aria2 detectado! Iniciando download nativo de alta velocidade para o episódio: ${episodeCode}`);
    return downloadWithAria2(magnetUrl, episodeCode, outputDir, projectId, onProgress);
  } else {
    console.log(`[Torrent] Aria2 não detectado. Iniciando download via fallback de WebTorrent para: ${episodeCode}`);
    return downloadWithWebTorrent(magnetUrl, episodeCode, outputDir, projectId, onProgress);
  }
}

// High-speed native Aria2 downloader
function downloadWithAria2(
  magnetUrl: string,
  episodeCode: string,
  outputDir: string,
  projectId: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 1. Download Torrent Metadata (.torrent file) first
    onProgress({ progress: 2, downloadSpeed: '0 KB/s', bytesDownloaded: 0, status: 'Obtendo metadados do Torrent (Aria2)...' });
    
    // Extract infohash to locate the metadata file name
    const hashMatch = magnetUrl.match(/btih:([a-fA-F0-9]{40})/);
    const infoHash = hashMatch ? hashMatch[1].toLowerCase() : 'torrent';

    const metadataArgs = [
      `--dir=${outputDir}`,
      '--bt-metadata-only=true',
      '--bt-save-metadata=true',
      `--bt-tracker=${TRACKERS_COMMA}`,
      '--seed-time=0',
      '--quiet=true',
      magnetUrl
    ];

    const metaProcess = spawn('aria2c', metadataArgs);
    activeDownloads.set(projectId, { type: 'aria2c', childProcess: metaProcess });

    metaProcess.on('error', (err) => {
      activeDownloads.delete(projectId);
      reject(new Error(`Falha ao iniciar aria2c (metadados): ${err.message}`));
    });

    metaProcess.on('exit', (code) => {
      if (code !== 0) {
        activeDownloads.delete(projectId);
        reject(new Error(`Falha ao obter metadados do torrent (Aria2 exit code: ${code}).`));
        return;
      }

      // 2. Metadata resolved! Locate the saved .torrent file
      let torrentFile = path.join(outputDir, `${infoHash}.torrent`);
      if (!fs.existsSync(torrentFile)) {
        // Fallback: search directory for any .torrent file
        const files = fs.readdirSync(outputDir);
        const found = files.find(f => f.endsWith('.torrent'));
        if (found) {
          torrentFile = path.join(outputDir, found);
        } else {
          activeDownloads.delete(projectId);
          reject(new Error(`Metadados salvos mas o arquivo .torrent não foi encontrado.`));
          return;
        }
      }

      // 3. Query files inside the torrent file to find target episode index
      onProgress({ progress: 5, downloadSpeed: '0 KB/s', bytesDownloaded: 0, status: 'Mapeando lista de arquivos...' });
      
      const showProcess = spawn('aria2c', ['--show-files=true', torrentFile]);
      let showStdout = '';
      showProcess.on('error', (err) => {
        activeDownloads.delete(projectId);
        reject(new Error(`Falha ao iniciar aria2c (show-files): ${err.message}`));
      });
      showProcess.stdout.on('data', (data) => {
        showStdout += data.toString();
      });

      showProcess.on('exit', (showCode) => {
        if (showCode !== 0) {
          activeDownloads.delete(projectId);
          reject(new Error(`Falha ao ler arquivos do torrent (Aria2 show-files exit code: ${showCode})`));
          return;
        }

        // Parse file indices
        const lines = showStdout.split('\n');
        let fileIndex = -1;
        let relativeFilePath = '';

        // Match exato: S01E01 não pode casar com S01E10.
        const epMatch = episodeCode.match(/S(\d{2})E(\d{2})/i);
        const epKey = epMatch ? `s${epMatch[1]}e${epMatch[2]}` : episodeCode.toLowerCase();

        for (const line of lines) {
          const trimmed = line.trim();
          // Matches e.g. "  2|./Rick.and.Morty.S01E01.1080p.BluRay.x265-RARBG/Rick.and.Morty.S01E01.1080p.BluRay.x265-RARBG.mp4"
          if (trimmed.includes('|')) {
            const parts = trimmed.split('|');
            const idx = parseInt(parts[0], 10);
            const filePath = parts[1];

            // Check if file is our episode and not a subtitle/txt
            const isVideo = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].some(ext => filePath.toLowerCase().endsWith(ext));
            if (isVideo && matchesEpisodeCode(filePath, epKey)) {
              fileIndex = idx;
              relativeFilePath = filePath.replace(/^\.\//, '');
              break;
            }
          }
        }

        if (fileIndex === -1) {
          activeDownloads.delete(projectId);
          reject(new Error(`Episódio ${episodeCode} não encontrado no torrent (Aria2).`));
          return;
        }

        // Path traversal guard: ensure the selected file stays inside outputDir
        const resolvedFilePath = path.resolve(outputDir, relativeFilePath);
        const outputRoot = path.resolve(outputDir) + path.sep;
        if (!resolvedFilePath.startsWith(outputRoot)) {
          activeDownloads.delete(projectId);
          reject(new Error(`Bloqueio de Segurança: Caminho de arquivo inválido no torrent.`));
          return;
        }

        // Security Whitelist and Blacklist check
        const targetExt = path.extname(relativeFilePath).toLowerCase();
        const SAFE_VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];
        const BANNED_EXTENSIONS = ['.exe', '.dmg', '.pkg', '.app', '.sh', '.bat', '.cmd', '.scr', '.msi', '.js', '.vbs', '.py', '.bin', '.jar', '.com', '.pif', '.lnk'];

        if (BANNED_EXTENSIONS.includes(targetExt)) {
          activeDownloads.delete(projectId);
          reject(new Error(`Bloqueio de Segurança: O arquivo "${relativeFilePath}" possui extensão proibida/maliciosa.`));
          return;
        }
        if (!SAFE_VIDEO_EXTENSIONS.includes(targetExt)) {
          activeDownloads.delete(projectId);
          reject(new Error(`Bloqueio de Segurança: O arquivo "${relativeFilePath}" não possui uma extensão de vídeo válida.`));
          return;
        }

        // 4. Start high-speed selective download of only that file index
        console.log(`[Torrent] Iniciando download seletivo do índice: ${fileIndex} (${relativeFilePath})`);
        
        const downloadArgs = [
          `--dir=${outputDir}`,
          `--select-file=${fileIndex}`,
          `--bt-tracker=${TRACKERS_COMMA}`,
          '--seed-time=0',
          torrentFile
        ];

        const dlProcess = spawn('aria2c', downloadArgs);
        activeDownloads.set(projectId, { type: 'aria2c', childProcess: dlProcess });

        dlProcess.on('error', (err) => {
          activeDownloads.delete(projectId);
          reject(new Error(`Falha ao iniciar aria2c (download): ${err.message}`));
        });

        dlProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // Regex to parse percentage e.g. (14%) or 14%
          const pctMatch = output.match(/\((\d+)%\)/) || output.match(/(\d+)%/);
          const speedMatch = output.match(/SPD:([^\s\]]+)/);
          
          if (pctMatch) {
            const rawProgress = parseInt(pctMatch[1], 10);
            const scaledProgress = Math.round(rawProgress * 0.9) + 5; // Map from 5% to 95%
            const speedStr = speedMatch ? speedMatch[1] : 'Calculando...';

            onProgress({
              progress: scaledProgress,
              downloadSpeed: speedStr,
              bytesDownloaded: 0,
              status: `Baixando ${episodeCode}... [${rawProgress}%] @ ${speedStr}`
            });
          }
        });

        dlProcess.on('exit', (dlCode) => {
          activeDownloads.delete(projectId);
          
          // Cleanup .torrent metadata file
          try {
            fs.unlinkSync(torrentFile);
          } catch (e) {}

          if (dlCode !== 0) {
            reject(new Error(`Download falhou ou foi abortado (Aria2 exit code: ${dlCode})`));
            return;
          }

          // Rename target file to original.mp4 or original.mkv
          const downloadedFile = path.join(outputDir, relativeFilePath);
          const ext = path.extname(relativeFilePath) || '.mkv';
          const finalPath = path.join(outputDir, `original${ext}`);

          try {
            fs.renameSync(downloadedFile, finalPath);
            console.log(`[Torrent] Arquivo renomeado com sucesso para: ${finalPath}`);
            
            // Clean empty subdirectories left by RARBG structure
            const dirToCleanup = path.join(outputDir, relativeFilePath.split('/')[0]);
            if (fs.existsSync(dirToCleanup)) {
              try {
                fs.rmSync(dirToCleanup, { recursive: true, force: true });
              } catch (cleanupErr) {}
            }

            onProgress({
              progress: 100,
              downloadSpeed: '0 KB/s',
              bytesDownloaded: 0,
              status: 'Download completo'
            });

            resolve(finalPath);
          } catch (renameErr) {
            reject(renameErr);
          }
        });
      });
    });
  });
}

// Standard WebTorrent Fallback Client
function downloadWithWebTorrent(
  magnetUrl: string,
  episodeCode: string,
  outputDir: string,
  projectId: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // @ts-ignore
    const client = new WebTorrent();
    activeDownloads.set(projectId, { type: 'webtorrent', client });

    onProgress({ progress: 2, downloadSpeed: '0 KB/s', bytesDownloaded: 0, status: 'Conectando ao Torrent (WebTorrent)...' });

    client.add(magnetUrl, { path: outputDir, announce: TRACKERS_LIST }, (torrent: any) => {
      const entry = activeDownloads.get(projectId);
      if (entry) {
        entry.torrent = torrent;
      }

      const episodeLower = episodeCode.toLowerCase();
      const epMatch = episodeCode.match(/S(\d{2})E(\d{2})/i);
      const epKey = epMatch ? `s${epMatch[1]}e${epMatch[2]}` : episodeLower;
      let targetFile: any = null;

      const SAFE_VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];
      const BANNED_EXTENSIONS = ['.exe', '.dmg', '.pkg', '.app', '.sh', '.bat', '.cmd', '.scr', '.msi', '.js', '.vbs', '.py', '.bin', '.jar', '.com', '.pif', '.lnk'];

      if (torrent.files.length > 1) {
        // Seleciona o MELHOR candidato (maior tamanho, extensão segura, código
        // exato) — antes, todos os matches eram select()ados e o último vencia.
        let bestCandidate: any = null;
        for (const file of torrent.files) {
          const fileExt = path.extname(file.name).toLowerCase();
          const isBanned = BANNED_EXTENSIONS.includes(fileExt);
          if (isBanned) continue;
          if (!matchesEpisodeCode(file.name, epKey)) continue;
          if (!SAFE_VIDEO_EXTENSIONS.includes(fileExt)) continue;
          if (!bestCandidate || (file.length || 0) > (bestCandidate.length || 0)) {
            bestCandidate = file;
          }
        }
        if (bestCandidate) {
          targetFile = bestCandidate;
          targetFile.select();
        }
        // Deseleciona os demais para não baixar samples/extras.
        for (const file of torrent.files) {
          if (file !== targetFile) file.deselect();
        }
      } else if (torrent.files.length === 1) {
        targetFile = torrent.files[0];
        targetFile.select();
      }

      if (!targetFile) {
        activeDownloads.delete(projectId);
        client.destroy();
        reject(new Error(`Episódio ${episodeCode} não encontrado no pacote.`));
        return;
      }

      const targetExt = path.extname(targetFile.name).toLowerCase();
      if (BANNED_EXTENSIONS.includes(targetExt) || !SAFE_VIDEO_EXTENSIONS.includes(targetExt)) {
        activeDownloads.delete(projectId);
        client.destroy();
        reject(new Error(`Bloqueio de Segurança: Extensão de arquivo suspensa.`));
        return;
      }

      const checkInterval = setInterval(() => {
        const fileProgress = targetFile.progress;
        const progressPct = Math.round(fileProgress * 90) + 5;
        
        let speedStr = '0 KB/s';
        if (torrent.downloadSpeed > 1024 * 1024) {
          speedStr = `${(torrent.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s`;
        } else if (torrent.downloadSpeed > 1024) {
          speedStr = `${(torrent.downloadSpeed / 1024).toFixed(0)} KB/s`;
        }

        onProgress({
          progress: progressPct,
          downloadSpeed: speedStr,
          bytesDownloaded: targetFile.downloaded,
          status: `Baixando ${episodeCode}... (${(targetFile.downloaded / 1024 / 1024).toFixed(1)} MB) @ ${speedStr}`
        });
      }, 2000);

      torrent.on('done', () => {
        clearInterval(checkInterval);
        activeDownloads.delete(projectId);
        
        const originalFilePath = path.join(outputDir, targetFile.path);
        const ext = path.extname(targetFile.name) || '.mkv';
        const finalPath = path.join(outputDir, `original${ext}`);

        try {
          fs.renameSync(originalFilePath, finalPath);
          onProgress({ progress: 100, downloadSpeed: '0 KB/s', bytesDownloaded: targetFile.length, status: 'Download completo' });
          client.destroy();
          resolve(finalPath);
        } catch (renameErr) {
          client.destroy();
          reject(renameErr);
        }
      });

      torrent.on('error', (err: any) => {
        clearInterval(checkInterval);
        activeDownloads.delete(projectId);
        client.destroy();
        reject(err);
      });
    });

    client.on('error', (err: any) => {
      activeDownloads.delete(projectId);
      client.destroy();
      reject(err);
    });
  });
}

// Torrent Queue Controllers
export function pauseTorrent(projectId: string): boolean {
  const entry = activeDownloads.get(projectId);
  if (entry) {
    if (entry.type === 'aria2c' && entry.childProcess) {
      console.log(`[Torrent] Pausando processo Aria2 para: ${projectId}`);
      // Send SIGSTOP to pause process CPU and networking
      entry.childProcess.kill('SIGSTOP');
      return true;
    } else if (entry.type === 'webtorrent' && entry.torrent) {
      entry.torrent.pause();
      return true;
    }
  }
  return false;
}

export function resumeTorrent(projectId: string): boolean {
  const entry = activeDownloads.get(projectId);
  if (entry) {
    if (entry.type === 'aria2c' && entry.childProcess) {
      console.log(`[Torrent] Retomando processo Aria2 para: ${projectId}`);
      // Send SIGCONT to resume process CPU and networking
      entry.childProcess.kill('SIGCONT');
      return true;
    } else if (entry.type === 'webtorrent' && entry.torrent) {
      entry.torrent.resume();
      return true;
    }
  }
  return false;
}

export function cancelTorrent(projectId: string): boolean {
  const entry = activeDownloads.get(projectId);
  if (entry) {
    console.log(`[Torrent] Cancelando download para projeto: ${projectId}`);
    if (entry.type === 'aria2c' && entry.childProcess) {
      try {
        entry.childProcess.kill('SIGKILL');
      } catch (err) {}
    } else if (entry.type === 'webtorrent' && entry.client) {
      try {
        entry.client.destroy();
      } catch (err) {}
    }
    activeDownloads.delete(projectId);
    return true;
  }
  return false;
}
