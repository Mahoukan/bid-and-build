import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { base64Bytes, exportTemplate, parseTemplateJson, portableImageSchema, templateSchema, TEMPLATE_LIMITS, type GameTemplate } from '../shared/template.js';
import { decodeBase64, rasterDimensions } from '../shared/raster.js';
import { duplicateOption, moveOption, newTemplate } from '../client/src/builder/model.js';

const sample = JSON.parse(readFileSync(new URL('../samples/dragon-game.json', import.meta.url), 'utf8')) as GameTemplate;
// One transparent pixel; real decoder/resize checks run in the isolated browser.
const pixel = { version: 1 as const, mimeType: 'image/png' as const, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };

describe('portable template v1', () => {
  it('preserves the canonical sample, IDs and creator order', () => {
    expect(parseTemplateJson(exportTemplate(sample))).toEqual(sample);
    expect(sample.options).toHaveLength(12);
  });
  it('round-trips all fields and complete cover/option image bytes', () => {
    const template = structuredClone(sample);
    template.title = 'A different game'; template.description = 'A\nnew description';
    template.startingCurrency = 55; template.minimumOpeningBid = 2; template.minimumBidIncrease = 3; template.currencySymbol = 'coins';
    template.coverImage = pixel; template.options[0]!.image = pixel;
    template.options.reverse();
    const restored = parseTemplateJson(exportTemplate(template));
    expect(restored).toEqual(template);
    expect(decodeBase64(restored.options.at(-1)!.image!.data)).toEqual(decodeBase64(pixel.data));
  });
  it('treats HTML-like text as text, without changing its content', () => {
    const template = { ...sample, description: '<img src=x onerror="alert(1)"><script>bad()</script>' };
    expect(parseTemplateJson(exportTemplate(template))).toEqual(template);
  });
  it.each([
    ['format', 'other'], ['version', 2], ['title', '  '], ['title', 'a'.repeat(121)],
    ['description', 'a'.repeat(4001)], ['currencySymbol', ''], ['currencySymbol', '123456789'],
    ['startingCurrency', 0], ['startingCurrency', -2], ['startingCurrency', 1.2],
    ['startingCurrency', Number.MAX_SAFE_INTEGER + 1], ['startingCurrency', 1000001], ['startingCurrency', '20'],
    ['minimumOpeningBid', 0], ['minimumBidIncrease', -1], ['minimumBidIncrease', 0.5],
    ['minimumOpeningBid', 21], ['coverImage', 'https://example.com/a.png'], ['options', []],
    ['personalBackground', pixel], ['admin', true],
  ])('rejects invalid field %s=%s', (field, value) => {
    expect(templateSchema.safeParse({ ...sample, [field]: value }).success).toBe(false);
  });
  it.each(['', 'x'.repeat(65), '../image', 'has space'])('rejects invalid option ID %s', (id) => {
    expect(templateSchema.safeParse({ ...sample, options: [{ ...sample.options[0], id }] }).success).toBe(false);
  });
  it('rejects duplicate IDs with a useful option path', () => {
    const parsed = templateSchema.safeParse({ ...sample, options: [sample.options[0], sample.options[0]] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'options.1.id')).toBe(true);
  });
  it('rejects empty and oversized option fields and too many options', () => {
    for (const changes of [{ title: '  ' }, { title: 'a'.repeat(121) }, { description: 'a'.repeat(4001) }, { image: 'blob:temporary' }]) {
      expect(templateSchema.safeParse({ ...sample, options: [{ ...sample.options[0], ...changes }] }).success).toBe(false);
    }
    expect(templateSchema.safeParse({ ...sample, options: Array.from({ length: 201 }, (_, i) => ({ ...sample.options[0], id: `option-${i}` })) }).success).toBe(false);
  });
  it('rejects invalid, oversized and future JSON before replacing a draft', () => {
    expect(() => parseTemplateJson('{')).toThrow('not valid JSON');
    expect(() => parseTemplateJson(' '.repeat(TEMPLATE_LIMITS.jsonBytes + 1))).toThrow('12 MiB');
    expect(() => parseTemplateJson(JSON.stringify({ ...sample, version: 99 }))).toThrow();
    expect(() => exportTemplate({ ...sample, title: '' })).toThrow();
  });
  it('enforces both per-image and total decoded byte limits', () => {
    const bytes = Buffer.alloc(TEMPLATE_LIMITS.imageBytes);
    Buffer.from(pixel.data, 'base64').copy(bytes);
    const large = { ...pixel, data: bytes.toString('base64') };
    expect(portableImageSchema.safeParse(large).success).toBe(true); // Header validation only; browser also decodes.
    expect(templateSchema.safeParse({ ...sample, coverImage: large, options: sample.options.map((option) => ({ ...option, image: large })) }).success).toBe(false);
    expect(portableImageSchema.safeParse({ ...large, data: Buffer.concat([bytes, Buffer.from([0])]).toString('base64') }).success).toBe(false);
  });
});

describe('portable image boundary', () => {
  it('recognizes raster dimensions and padded byte length', () => {
    expect(rasterDimensions(decodeBase64(pixel.data), 'image/png')).toEqual({ width: 1, height: 1 });
    for (const data of ['YQ==', 'YWI=', 'YWJj']) expect(base64Bytes(data)).toBe(Buffer.from(data, 'base64').length);
  });
  it.each([
    { ...pixel, version: 2 }, { ...pixel, mimeType: 'image/svg+xml' },
    { ...pixel, data: 'data:image/png;base64,' + pixel.data }, { ...pixel, data: '<svg/>' },
    { ...pixel, data: pixel.data + '\n' }, { ...pixel, data: pixel.data.slice(0, -1) },
    { ...pixel, mimeType: 'image/jpeg' }, { ...pixel, url: 'https://example.com' },
  ])('rejects active, remote, malformed or mismatched image data %#', (value) => {
    expect(portableImageSchema.safeParse(value).success).toBe(false);
  });
  it('rejects zero or oversized image dimensions before decoding', () => {
    for (const width of [0, 1601, 0xffffffff]) {
      const data = Buffer.from(pixel.data, 'base64'); data.writeUInt32BE(width, 16);
      expect(portableImageSchema.safeParse({ ...pixel, data: data.toString('base64') }).success).toBe(false);
    }
  });
  it('rejects truncated PNG and invalid/truncated JPEG headers', () => {
    expect(() => rasterDimensions(new Uint8Array(12), 'image/png')).toThrow();
    for (const data of [[0xff, 0xd8, 0xff, 0xc0, 0, 8], [0xff, 0xd8, 0xff, 0xff], [1, 2, 3, 4]]) {
      expect(() => rasterDimensions(new Uint8Array(data), 'image/jpeg')).toThrow();
    }
  });
});

describe('builder option operations', () => {
  it('creates independent new templates, requiring a named option before save', () => {
    const first = newTemplate(); const second = newTemplate();
    expect(first.options[0]!.id).not.toBe(second.options[0]!.id);
    expect(templateSchema.safeParse(first).success).toBe(false);
    first.options[0]!.title = 'First possibility';
    expect(templateSchema.safeParse(first).success).toBe(true);
  });
  it('duplicates images and text with a fresh ID without changing the source', () => {
    const original = { ...sample.options[0]!, image: pixel };
    const copy = duplicateOption(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.image).toEqual(original.image);
    expect(copy.title).toBe('Firebreathing (copy)');
    copy.image!.data = 'changed'; expect(original.image.data).toBe(pixel.data);
  });
  it('reorders without changing IDs, content or the source array', () => {
    const moved = moveOption(sample.options, 0, 2);
    expect(moved[2]).toEqual(sample.options[0]);
    expect(moved[0]).toEqual(sample.options[1]);
    expect(moveOption(moved, 2, 0)).toEqual(sample.options);
    expect(moveOption(sample.options, -1, 0)).toBe(sample.options);
    expect(moveOption(sample.options, 0, 200)).toBe(sample.options);
  });
});
