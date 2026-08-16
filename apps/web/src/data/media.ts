export function buildPosterUrl(path: string | null, _size?: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path.replace('100x100bb.jpg', '600x600bb.jpg');
  }
  return '';
}

export function buildBackdropUrl(path: string | null, _size?: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path.replace('100x100bb.jpg', '1000x1000bb.jpg');
  }
  return '';
}
