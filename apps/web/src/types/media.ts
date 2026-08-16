export interface CatalogItem {
  tmdbId: number;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  rating: number;
  genres: string[];
  type: 'movie' | 'tv';
  /** Download options when this row came from the torrent engine (PT/TMDB). */
  options?: { id: string; sourceUrl: string; quality?: string }[];
}

export interface CatalogData {
  trending: CatalogItem[];
  trendingTV: CatalogItem[];
  popularMovies: CatalogItem[];
  scifi: CatalogItem[];
  action: CatalogItem[];
  animation: CatalogItem[];
}

export interface DownloadTask {
  projectId: string;
  title: string;
  quality: string;
  progressPct: number;
  progressStatus: string;
  speed: string;
  eta: string;
  sizeGb: number;
  status: 'downloading' | 'done' | 'error';
}

export interface PlayerState {
  isOpen: boolean;
  title: string;
  videoUrl: string;
}
