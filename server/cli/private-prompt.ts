import { emitKeypressEvents, type Key } from 'node:readline';

/** No echo, masking characters, arguments, environment password or stdin pipe. */
export function privatePrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Open an interactive terminal. Piped credentials are not accepted.');
  emitKeypressEvents(process.stdin);
  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw; let value = '';
    process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    const cleanup = () => {
      process.stdin.off('keypress', keypress); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write('\n');
    };
    const keypress = (text: string | undefined, key: Key) => {
      if ((key.ctrl && ['c', 'd'].includes(key.name ?? '')) || key.name === 'escape') { cleanup(); reject(new Error('Cancelled. Nothing was changed.')); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && text && Array.from(text).every((character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127) && value.length + text.length <= 512) value += text;
    };
    process.stdin.on('keypress', keypress);
  });
}
