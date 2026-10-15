import type { TokenImageCrop, TokenImageSource } from '../../../../types/tokenImageSource';
import { cropReset } from './cropMath';
import type { TokenPreview } from './types';

/** Stores both ring modes against the same source, so toggling never crops a previous render. */
export function imageSourceFor(preview: TokenPreview, path: string): TokenImageSource {
  const active: TokenImageCrop = { imageScale: preview.imageScale, imagePosition: { ...preview.imagePosition } };
  const alternate = preview.alternateCrop ?? cropReset({ ...preview, showRing: preview.showRing === false });
  return {
    path,
    ringedDefaultScale: cropReset({ ...preview, showRing: true }).imageScale,
    framed: preview.showRing === false ? alternate : active,
    unframed: preview.showRing === false ? active : alternate,
  };
}

export function sameCrop(a: TokenImageCrop, b: TokenImageCrop): boolean {
  return a.imageScale === b.imageScale && a.imagePosition.x === b.imagePosition.x && a.imagePosition.y === b.imagePosition.y;
}
