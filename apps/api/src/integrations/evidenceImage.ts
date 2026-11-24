import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../middleware/errors.js';
export const maxImageBytes = 8 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const imageHash = hash;

const xml = (value: string) =>
  value
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(
      /[&<>"']/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
    );
function wrap(value: string, length: number) {
  const lines: string[] = [];
  let rest = value.trim().replace(/\s+/g, ' ');
  while (rest.length > length) {
    const split = rest.lastIndexOf(' ', length);
    const edge = split > 0 ? split : length;
    lines.push(rest.slice(0, edge));
    rest = rest.slice(edge).trimStart();
  }
  return [...lines, rest];
}
export async function watermarkImage(bytes: Buffer, labels: string[]) {
  try {
    const source = sharp(bytes, { limitInputPixels: 26_000_000, failOn: 'error' });
    const info = await source.metadata();
    if (
      !['jpeg', 'png'].includes(info.format ?? '') ||
      !info.width ||
      !info.height ||
      Math.min(info.width, info.height) < 240 ||
      (info.pages ?? 1) > 1
    )
      throw new Error('Invalid image');
    const photo = await source
      .autoOrient()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#131729' })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const width = photo.info.width;
    const font = Math.max(11, Math.round(width / 46));
    const max = Math.floor((width - font * 2) / (font * 0.66));
    const lines = labels.flatMap((label) => wrap(label, max));
    const height = Math.ceil((lines.length * 1.5 + 1.4) * font);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        width +
        '" height="' +
        height +
        '">' +
        '<rect width="100%" height="100%" fill="#171c31"/>' +
        lines
          .map(
            (line, i) =>
              '<text x="' +
              font +
              '" y="' +
              Math.round((i * 1.5 + 1.4) * font) +
              '" font-family="monospace" fill="white" font-size="' +
              font +
              '">' +
              xml(line) +
              '</text>',
          )
          .join('') +
        '</svg>',
    );
    const image = await sharp({
      create: { width, height: photo.info.height + height, channels: 3, background: '#171c31' },
    })
      .composite([
        { input: photo.data, left: 0, top: 0 },
        { input: svg, left: 0, top: photo.info.height },
      ])
      .jpeg({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: image.data, width, height: image.info.height, sha256: hash(image.data) };
  } catch {
    throw new AppError(422, 'Use a clear JPEG or PNG photo with at least 240 pixels on each side.');
  }
}
