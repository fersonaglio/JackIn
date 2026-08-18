export function buildPosterUrl(path: string | null, size: string = 'w500'): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
      .replace('100x100bb.jpg', '1000x1000bb.jpg')
      .replace('600x600bb.jpg', '1000x1000bb.jpg')
      .replace('/w200/', `/${size}/`)
      .replace('/w300/', `/${size}/`);
  }
  if (path.startsWith('/')) {
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
  return path;
}

export function buildBackdropUrl(path: string | null, size: string = 'w1280'): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
      .replace('100x100bb.jpg', '1280x1280bb.jpg')
      .replace('600x600bb.jpg', '1280x1280bb.jpg')
      .replace('/w300/', `/${size}/`)
      .replace('/w780/', `/${size}/`);
  }
  if (path.startsWith('/')) {
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
  return path;
}
