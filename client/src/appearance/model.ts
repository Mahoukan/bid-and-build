import { z } from 'zod';

export const appearanceSchema = z.strictObject({
  version: z.literal(1), preset: z.enum(['Minimal', 'Glass', 'Neon', 'Paper']),
  mode: z.enum(['light', 'dark']), accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  glass: z.boolean(), backgroundId: z.uuid().nullable(),
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaults: Appearance = { version: 1, preset: 'Minimal', mode: 'light', accent: '#18594b', glass: false, backgroundId: null };
export const presets: Record<Appearance['preset'], Pick<Appearance, 'mode' | 'accent' | 'glass'>> = {
  Minimal: { mode: 'light', accent: '#18594b', glass: false },
  Glass: { mode: 'light', accent: '#275dc4', glass: true },
  Neon: { mode: 'dark', accent: '#c474ff', glass: false },
  Paper: { mode: 'light', accent: '#845126', glass: false },
};
function channels(hex: string) { return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)); }
function mix(from: string, to: string, amount: number) { return '#' + channels(from).map((value, index) => Math.round(value * (1 - amount) + channels(to)[index]! * amount).toString(16).padStart(2, '0')).join(''); }
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
  return r! * .2126 + g! * .7152 + b! * .0722;
}
export function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function themeTokens(value: Appearance): Record<string, string> {
  const dark = value.mode === 'dark', paper = value.preset === 'Paper';
  const page = dark ? paper ? '#211e19' : '#14211e' : paper ? '#f5efdf' : '#f6f7f2';
  const surface = dark ? paper ? '#302a21' : '#1e302b' : paper ? '#fff9eb' : '#fffefa';
  const mutedSurface = dark ? paper ? '#3b3328' : '#293e35' : paper ? '#ece2c9' : '#e7eee3';
  // Keep even very pale/dark user choices readable on every surface. A 7:1
  // target leaves headroom for the bounded translucent surface and photo overlay.
  let accent = value.accent;
  for (let step = 0; step <= 100; step++) {
    accent = mix(value.accent, dark ? '#ffffff' : '#000000', step / 100);
    if ([page, surface, mutedSurface].every((bg) => contrast(accent, bg) >= 7)) break;
  }
  const onAccent = contrast(accent, '#ffffff') > contrast(accent, '#000000') ? '#ffffff' : '#000000';
  const rgb = (hex: string, alpha: number) => `rgba(${channels(hex).join(',')},${alpha})`;
  return {
    '--page': page, '--surface-opaque': surface, '--surface-translucent': rgb(surface, .92), '--surface-muted': mutedSurface,
    '--text': dark ? '#eff5f0' : '#23362f', '--muted': dark ? '#b9c9bf' : '#4c5b52',
    '--line': dark ? '#536b5e' : paper ? '#c8b99c' : '#c6d1c5', '--input-border': dark ? '#8fa899' : '#718773',
    '--accent': accent, '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', .12), '--on-accent': onAccent,
    '--accent-soft': rgb(accent, .12), '--focus': dark ? '#ffce85' : '#934216',
    '--danger': dark ? '#ffc0ac' : '#8b3021', '--danger-bg': dark ? '#452d28' : '#fff0eb', '--danger-border': dark ? '#bd8375' : '#bd806b',
    '--success': dark ? '#c1e6b6' : '#294f31', '--success-bg': dark ? '#283d2c' : '#edf1e7', '--success-border': dark ? '#72936a' : '#91aa88',
    '--warning': dark ? '#ffce85' : '#8a4420', '--disabled-bg': mutedSurface, '--disabled-text': dark ? '#b1c0b7' : '#536458',
    '--backdrop-overlay': rgb(page, .88), '--backdrop-shade': dark ? '#020b08c9' : '#10241bc4',
  };
}
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.mode = value.mode; root.dataset.preset = value.preset; root.dataset.glass = String(value.glass);
  root.style.colorScheme = value.mode;
  for (const [name, token] of Object.entries(themeTokens(value))) root.style.setProperty(name, token);
}
