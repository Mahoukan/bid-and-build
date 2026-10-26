import { useServerReady } from '../serverConnection.js';
import { useState } from 'react';
import type { RoomCredentials } from '../../../shared/rooms.js';
import { recoverSeat, replaceCode, storedSeat } from './api.js';

export function RecoveryForm({ code, recovered, cancel }: { code: string; recovered: (seat: RoomCredentials) => void; cancel: () => void }) {
  const ready = useServerReady();
  const [value, setValue] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <section className="room-entry"><p className="eyebrow">Room {code}</p><h1>Recover your seat</h1><p>Enter your private code to take control here. Your previous device will lose control. This restores your existing seat, including in a full room.</p>
    {!ready && <p role="status">Connecting to the server. Recovery is disabled until it responds.</p>}<form onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(''); void recoverSeat(code, value).then(recovered).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Recovery failed.')).finally(() => setBusy(false)); }}>
      <label htmlFor="private-recovery-code">Private recovery code</label><input id="private-recovery-code" type="password" autoComplete="off" spellCheck={false} maxLength={40} value={value} required onChange={(event) => setValue(event.target.value)} />
      <button className="game-button bid-button" disabled={busy || !ready || !value.trim()}>{busy ? 'Recovering…' : 'Recover and take control'}</button>
    </form>{error && <p role="alert">{error}</p>}<p>Keep the code private. It restores this game seat only. Drafts and appearance stay on their original device.</p><button className="game-button" disabled={busy} onClick={cancel}>Back</button>
  </section>;
}

export function RecoveryPanel({ seat, locked }: { seat: RoomCredentials; locked: boolean }) {
  const [privateCode, setPrivateCode] = useState(() => storedSeat(seat.code)?.recoveryCode ?? seat.recoveryCode ?? '');
  const [visible, setVisible] = useState(false); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function replace() {
    setBusy(true); setMessage('');
    try { const next = await replaceCode(seat); setPrivateCode(next.recoveryCode ?? ''); setConfirm(false); setMessage('New code saved in this browser. The previous code no longer works.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Replacement failed. Retry to check the same request.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(privateCode); setMessage('Private code copied.'); }
    catch { setMessage('Select and copy the code manually.'); }
  }
  return <div className="recovery-panel"><p>This code controls your seat in room <strong>{seat.code}</strong>. Keep a private copy before changing devices. Anyone with it can take your seat.</p>
    {privateCode ? <><label htmlFor="saved-private-code">Your private recovery code</label><input id="saved-private-code" type={visible ? 'text' : 'password'} readOnly autoComplete="off" spellCheck={false} value={privateCode} onFocus={(event) => event.target.select()} /><div className="menu-actions"><button className="game-button" onClick={() => setVisible(!visible)}>{visible ? 'Hide code' : 'Show code'}</button><button className="game-button" onClick={() => void copy()}>Copy code</button></div></> : <p>This browser has no saved code. Generate one here before changing devices.</p>}
    {confirm ? <><p>Replace this seat’s recovery code? The old code and any pending transfers will stop working.</p><div className="dialog-footer"><button className="game-button" disabled={busy} onClick={() => setConfirm(false)}>Cancel replacement</button><button className="game-button danger" disabled={locked || busy} onClick={() => void replace()}>Confirm Replace Code</button></div></> : <button className="game-button" disabled={locked || busy} onClick={() => setConfirm(true)}>{privateCode ? 'Replace Code' : 'Generate recovery code'}</button>}
    {message && <p role="status">{message}</p>}<p>Use the shared display when screen sharing. This private panel never appears on that display. Recovery restores host controls only for the original host seat; it grants no administrator account access.</p>
  </div>;
}
