import { decodeBase64, rasterDimensions } from '../../../shared/raster.js';
import { TEMPLATE_LIMITS, portableImageSchema, templateSchema, type GameTemplate, type PortableImage } from '../../../shared/template.js';

export async function processImage(file: Blob): Promise<PortableImage> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Choose a PNG or JPEG image. SVG and remote URLs are not supported.');
  if (file.size > TEMPLATE_LIMITS.sourceBytes) throw new Error('Choose an image no larger than 5 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { width, height } = rasterDimensions(bytes, file.type);
  if (width < 1 || height < 1 || width > TEMPLATE_LIMITS.sourceDimension || height > TEMPLATE_LIMITS.sourceDimension || width * height > TEMPLATE_LIMITS.sourcePixels) {
    throw new Error('Image must be at most 20 megapixels and 8192 pixels per side.');
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be decoded. Choose a different PNG or JPEG.'); }
  try {
    if (bitmap.width * bitmap.height > TEMPLATE_LIMITS.sourcePixels || Math.max(bitmap.width, bitmap.height) > TEMPLATE_LIMITS.sourceDimension) throw new Error('Decoded image exceeds the pixel limit.');
    let scale = Math.min(1, TEMPLATE_LIMITS.imageDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // Lossless PNG preserves transparency and avoids repeated JPEG loss when
      // an exported template is imported again. It also removes source metadata.
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image encoding failed.')), 'image/png'));
      if (blob.size <= TEMPLATE_LIMITS.imageBytes) {
        const url = canvas.toDataURL('image/png');
        return portableImageSchema.parse({ version: 1, mimeType: 'image/png', data: url.slice(url.indexOf(',') + 1) });
      }
      scale *= 0.75;
    }
    throw new Error('Image remains too large. Choose a smaller or simpler image.');
  } finally { bitmap.close(); }
}

export async function normalizeTemplateImages(template: GameTemplate): Promise<GameTemplate> {
  const normalize = async (image: PortableImage | null) => image
    ? processImage(new Blob([decodeBase64(image.data)], { type: image.mimeType })) : null;
  const result = structuredClone(template);
  result.coverImage = await normalize(result.coverImage);
  // Sequential decoding bounds peak memory even for a template with 200 images.
  for (const option of result.options) option.image = await normalize(option.image);
  return templateSchema.parse(result);
}
