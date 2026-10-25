import type { GameTemplate, TemplateOption } from '../../../shared/template.js';

export function newLocalId(): string {
  // getRandomValues also works on a local LAN's HTTP development origin.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newOption(): TemplateOption {
  return { id: newLocalId(), title: '', description: '', image: null };
}

export function newTemplate(): GameTemplate {
  return {
    format: 'bid-and-build-template', version: 1,
    title: 'Build Your Perfect Dragon', description: '', coverImage: null,
    startingCurrency: 20, currencySymbol: '$', minimumOpeningBid: 1, minimumBidIncrease: 1,
    options: [newOption()],
  };
}

export function duplicateOption(option: TemplateOption): TemplateOption {
  return { ...structuredClone(option), id: newLocalId(), title: `${option.title.slice(0, 113)} (copy)` };
}

export function moveOption(options: TemplateOption[], from: number, to: number): TemplateOption[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= options.length || to >= options.length) return options;
  const result = [...options];
  const [option] = result.splice(from, 1);
  result.splice(to, 0, option!);
  return result;
}
