import { describe, expect, it } from 'vitest';
import { contrast, defaults, presets, themeTokens } from '../client/src/appearance/model.js';

describe('readable appearance for arbitrary accent choices', () => {
  for (const preset of Object.keys(presets) as (keyof typeof presets)[]) for (const mode of ['light', 'dark'] as const) {
    it(`${preset} ${mode}: protects text, actions, focus and status contrast across the colour gamut`, () => {
      const colours = ['#ffffff', '#000000', '#ffff00', '#00ffff', '#ff00ff', '#0000ff'];
      for (const r of [0, 64, 128, 192, 255]) for (const g of [0, 64, 128, 192, 255]) for (const b of [0, 64, 128, 192, 255]) colours.push('#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));
      for (const accent of colours) {
        const tokens = themeTokens({ ...defaults, preset, mode, accent });
        for (const surface of ['--page', '--surface-opaque', '--surface-muted']) {
          expect(contrast(tokens['--accent']!, tokens[surface]!)).toBeGreaterThanOrEqual(7);
          expect(contrast(tokens['--text']!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(tokens['--muted']!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(tokens['--focus']!, tokens[surface]!)).toBeGreaterThanOrEqual(3);
        }
        expect(contrast(tokens['--on-accent']!, tokens['--accent']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--on-accent']!, tokens['--accent-hover']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--danger']!, tokens['--danger-bg']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--success']!, tokens['--success-bg']!)).toBeGreaterThanOrEqual(4.5);
        // Worst-case black/white photography behind the exact overlay/alpha.
        const composite = (rgba: string, photo: number) => {
          const [r, g, b, alpha] = rgba.match(/[\d.]+/g)!.map(Number);
          return '#' + [r!, g!, b!].map((n) => Math.round(n * alpha! + photo * (1 - alpha!)).toString(16).padStart(2, '0')).join('');
        };
        for (const photo of [0, 255]) for (const surface of ['--backdrop-overlay', '--surface-translucent']) {
          const colour = composite(tokens[surface]!, photo);
          for (const foreground of ['--text', '--muted', '--accent']) expect(contrast(tokens[foreground]!, colour)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
