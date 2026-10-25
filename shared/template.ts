import { z } from 'zod';
import { auctionSettingsSchema } from './contracts.js';
import { decodeBase64, rasterDimensions } from './raster.js';

export const TEMPLATE_LIMITS = {
  options: 200, title: 120, description: 4000,
  imageBytes: 1024 * 1024, totalImageBytes: 8 * 1024 * 1024,
  jsonBytes: 12 * 1024 * 1024,
  sourceBytes: 5 * 1024 * 1024, sourcePixels: 20_000_000,
  sourceDimension: 8192, imageDimension: 1600,
} as const;

export function base64Bytes(data: string): number {
  return data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

// Only inert raster formats are portable. Decoding/re-encoding is an additional
// browser boundary; future server uploads must independently decode these bytes.
export const portableImageSchema = z.strictObject({
  version: z.literal(1),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  data: z.string().min(4).max(4 * Math.ceil(TEMPLATE_LIMITS.imageBytes / 3))
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected padded base64 image bytes.'),
}).superRefine((image, context) => {
  if (base64Bytes(image.data) > TEMPLATE_LIMITS.imageBytes) {
    context.addIssue({ code: 'custom', path: ['data'], message: 'Each portable image must be 1 MiB or smaller.' });
  }
  const prefix = image.mimeType === 'image/png' ? 'iVBORw0KGgo' : '/9j/';
  if (!image.data.startsWith(prefix)) {
    context.addIssue({ code: 'custom', path: ['data'], message: 'Image bytes do not match their MIME type.' });
  }
  if (image.data.length <= 4 * Math.ceil(TEMPLATE_LIMITS.imageBytes / 3)) {
    try {
      if (image.data.length % 4 !== 0 || btoa(atob(image.data)) !== image.data) throw new Error('Invalid base64.');
      const { width, height } = rasterDimensions(decodeBase64(image.data), image.mimeType);
      if (width < 1 || height < 1 || width > TEMPLATE_LIMITS.imageDimension || height > TEMPLATE_LIMITS.imageDimension) throw new Error('Invalid dimensions.');
    } catch {
      context.addIssue({ code: 'custom', path: ['data'], message: 'Use a valid PNG or JPEG with dimensions from 1 to 1600 pixels.' });
    }
  }
});
export type PortableImage = z.infer<typeof portableImageSchema>;

export const templateOptionSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().trim().min(1, 'Enter an option title.').max(TEMPLATE_LIMITS.title),
  description: z.string().max(TEMPLATE_LIMITS.description),
  image: portableImageSchema.nullable(),
});

export const templateSchema = auctionSettingsSchema.safeExtend({
  format: z.literal('bid-and-build-template'),
  version: z.literal(1),
  title: z.string().trim().min(1, 'Enter a game title.').max(TEMPLATE_LIMITS.title),
  description: z.string().max(TEMPLATE_LIMITS.description),
  coverImage: portableImageSchema.nullable(),
  options: z.array(templateOptionSchema).min(1, 'Add at least one option.').max(TEMPLATE_LIMITS.options),
}).superRefine((template, context) => {
  const ids = new Set<string>();
  let bytes = template.coverImage ? base64Bytes(template.coverImage.data) : 0;
  template.options.forEach((option, index) => {
    if (ids.has(option.id)) context.addIssue({ code: 'custom', path: ['options', index, 'id'], message: 'Option IDs must be unique.' });
    ids.add(option.id);
    bytes += option.image ? base64Bytes(option.image.data) : 0;
  });
  if (bytes > TEMPLATE_LIMITS.totalImageBytes) {
    context.addIssue({ code: 'custom', path: ['coverImage'], message: 'All images together must be 8 MiB or smaller. Remove or simplify an image.' });
  }
});
export type GameTemplate = z.infer<typeof templateSchema>;
export type TemplateOption = GameTemplate['options'][number];

export function parseTemplateJson(text: string): GameTemplate {
  if (new TextEncoder().encode(text).length > TEMPLATE_LIMITS.jsonBytes) throw new Error('Template JSON must be 12 MiB or smaller.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  return templateSchema.parse(value);
}

export function exportTemplate(template: GameTemplate): string {
  const text = JSON.stringify(templateSchema.parse(template), null, 2);
  if (new TextEncoder().encode(text).length > TEMPLATE_LIMITS.jsonBytes) throw new Error('Template JSON must be 12 MiB or smaller.');
  return text;
}

export function imageSource(image: PortableImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}
