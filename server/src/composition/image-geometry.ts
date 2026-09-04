import type { CompositionBox } from './engine.js';

/**
 * Return the painted image bounds for an image fitted with `contain`.
 *
 * The container and source dimensions use the same page-space units for the
 * container and source aspect-ratio units for the image. The result is the
 * actual painted rectangle; the unused part of the container is not painted.
 */
export function fitContainBox(container: CompositionBox, sourceWidth: number, sourceHeight: number): CompositionBox {
  const scale = Math.min(container.width / sourceWidth, container.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * Map a continuous page-space point to one source-raster pixel inside an
 * already computed painted image box. Points in the unused contain margin do
 * not belong to the image and return `undefined`.
 */
export function imagePixelAtPoint(
  paintedBox: CompositionBox,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  if (x < paintedBox.x || x >= paintedBox.x + paintedBox.width || y < paintedBox.y || y >= paintedBox.y + paintedBox.height) return undefined;
  return {
    x: Math.max(0, Math.min(imageWidth - 1, Math.floor((x - paintedBox.x) * imageWidth / paintedBox.width))),
    y: Math.max(0, Math.min(imageHeight - 1, Math.floor((y - paintedBox.y) * imageHeight / paintedBox.height))),
  };
}
