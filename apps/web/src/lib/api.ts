const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const DEFAULT_FETCH_TIMEOUT_MS = 90000;

export async function fetchApi<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<T> {
  const method = options?.method || 'GET';
  const label = `${method} ${API_URL}${path}`;
  const timeout = timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  console.log(`[JackIn] ➡️ ${label}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Relay any external signal so the caller's abort still works.
  if (options?.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[JackIn] ❌ ${label} → ${res.status}: ${body.slice(0, 200)}`);
      throw new Error(`API error: ${res.status}`);
    }

    const data = await res.json();
    console.log(`[JackIn] ✅ ${label} → OK`);
    return data;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error(`[JackIn] ⏱️ ${label} → timeout (${timeout}ms)`);
      throw new Error(`API timeout: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface Project {
  id: string;
  youtubeUrl: string;
  title: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  projectType?: string;
  facelessConfig?: {
    topic?: string;
    tone?: string;
    voice?: string;
    numScenes?: number;
    sourceUrl?: string;
    title?: string;
    quality?: string;
    posterUrl?: string;
    altSourceUrls?: string[];
  };
  progressPct?: number | null;
  progressStatus?: string | null;
  sizeBytes?: number;
  seriesId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  watchProgress?: number | null;
  watched?: number | null;
}

export async function importSeason(language: string, customMagnet?: string): Promise<{ message: string; projects: any[] }> {
  return fetchApi('/projects/import-season', {
    method: 'POST',
    body: JSON.stringify({ language, customMagnet }),
  });
}

export async function listProjects(type?: string): Promise<Project[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  return fetchApi(`/projects${query}`);
}

export function getProjectThumbnailUrl(projectId: string): string {
  return `${API_URL}/projects/${projectId}/thumbnail`;
}

export function getProjectVideoUrl(projectId: string): string {
  return `${API_URL}/projects/${projectId}/video`;
}

export async function deleteProject(projectId: string, deleteFiles = true): Promise<void> {
  await fetchApi(`/projects/${projectId}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
}

export async function deleteSeries(seriesId: string, deleteFiles = true): Promise<{ success: boolean; count: number }> {
  return fetchApi(`/projects/series/${seriesId}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
}

export async function pauseProjectDownload(projectId: string): Promise<{ success: boolean; message: string }> {
  return fetchApi(`/projects/${projectId}/pause`, { method: 'POST' });
}

export async function resumeProjectDownload(projectId: string): Promise<{ success: boolean; message: string }> {
  return fetchApi(`/projects/${projectId}/resume`, { method: 'POST' });
}

export async function cancelProjectDownload(projectId: string): Promise<{ success: boolean; message: string }> {
  return fetchApi(`/projects/${projectId}/cancel`, { method: 'POST' });
}

export interface MediaOption {
  id: string;
  quality: string;
  badge: string;
  resolution: string;
  bitrate: string;
  size: string;
  seeders?: number;
  audio: string;
  audioType?: string;
  hasSubtitles?: boolean;
  ptConfirmed?: boolean;
  ptExcluded?: boolean;
  format: string;
  sourceUrl: string;
}

export interface MovieSearchResult {
  id: string;
  title: string;
  originalTitle: string;
  year: string;
  overview: string;
  posterUrl: string;
  backdropUrl?: string;
  genre: string;
  rating: string;
  options: MediaOption[];
  mediaType?: string;
  matchScore?: number;
  exactMatch?: boolean;
  approximate?: boolean;
  approximateTitle?: string;
  ptUnavailable?: boolean;
}

export interface MediaSearchMeta {
  year?: string | number | null;
  posterUrl?: string;
  overview?: string;
  genre?: string;
}

export async function searchMediaSources(
  query: string,
  audio?: string,
  meta?: MediaSearchMeta,
  ptTitle?: string
): Promise<{ query: string; results: MovieSearchResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (audio && audio !== 'any') params.set('audio', audio);
  if (meta) {
    if (meta.year != null) params.set('year', String(meta.year));
    if (meta.posterUrl) params.set('posterUrl', meta.posterUrl);
    if (meta.overview) params.set('overview', meta.overview);
    if (meta.genre) params.set('genre', meta.genre);
  }
  if (ptTitle) params.set('ptTitle', ptTitle);
  return fetchApi(`/media-search/search?${params.toString()}`, undefined, 180000);
}

export async function downloadMediaMovie(
  title: string,
  quality: string,
  sourceUrl: string,
  posterUrl?: string
): Promise<{ id: string; title: string; status: string; quality: string }> {
  return fetchApi('/media-search/download', {
    method: 'POST',
    body: JSON.stringify({ title, quality, sourceUrl, posterUrl })
  });
}

export async function retryMediaDownload(projectId: string): Promise<{ id: string; status: string }> {
  return fetchApi(`/media-search/retry/${encodeURIComponent(projectId)}`, {
    method: 'POST',
  });
}

export async function pauseMediaDownload(projectId: string): Promise<{ id: string; status: string }> {
  return fetchApi(`/media-search/pause/${encodeURIComponent(projectId)}`, {
    method: 'POST',
  });
}

export async function resumeMediaDownload(projectId: string): Promise<{ id: string; status: string }> {
  return fetchApi(`/media-search/resume/${encodeURIComponent(projectId)}`, {
    method: 'POST',
  });
}

export async function fetchPtBrSubtitles(projectId: string): Promise<{ ok: boolean; error?: string; code?: string; path?: string; name?: string }> {
  return fetchApi(`/media-search/subtitles/${encodeURIComponent(projectId)}`, {
    method: 'POST',
  });
}

export async function saveWatchProgress(projectId: string, position: number): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/projects/${projectId}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ position }),
  });
}

export async function getWatchProgress(projectId: string): Promise<{ position: number; watched: boolean }> {
  return fetchApi<{ position: number; watched: boolean }>(`/projects/${projectId}/progress`);
}

export async function markWatched(projectId: string, watched: boolean): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/projects/${projectId}/watched`, {
    method: 'PUT',
    body: JSON.stringify({ watched }),
  });
}

export interface WatchHistoryItem {
  id: string;
  projectId: string | null;
  title: string;
  projectType: string;
  seriesId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  posterUrl: string | null;
  watchedAt: string;
  watchProgress: number;
  watched: boolean;
  isDownloaded: boolean;
}

export async function getSeriesEpisodes(seriesId: string): Promise<Project[]> {
  return fetchApi<Project[]>(`/projects/series/${seriesId}`);
}

export async function getWatchHistory(): Promise<WatchHistoryItem[]> {
  return fetchApi<WatchHistoryItem[]>('/projects/history/all');
}

export async function deleteWatchHistoryItem(id: string): Promise<void> {
  await fetchApi(`/projects/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
