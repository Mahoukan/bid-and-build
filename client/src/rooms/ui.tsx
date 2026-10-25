import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MediaAccess = { code: string; token: string; display?: boolean };
export function RoomImage({ assetId, access, alt }: { assetId: string | null; access: MediaAccess; alt: string }) {
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const { code, token, display } = access;
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController(); let url: string | undefined;
    void fetch(`/api/rooms/${code}/${display ? 'display/' : ''}media/${assetId}`, { headers: { Authorization: `${display ? 'Display' : 'Bearer'} ${token}` }, signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('Image unavailable.'); return response.blob(); })
      .then((blob) => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setImage({ id: assetId, url }); } }).catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [assetId, code, token, display]);
  return assetId && image?.id === assetId ? <img className="room-image" src={image.url} alt={alt} /> : <span className="image-placeholder" aria-hidden="true">✧</span>;
}

export function Modal({ title, close, children, closeDisabled = false, className = '', closeLabel = 'Close' }: { title: string; close: () => void; children: ReactNode; closeDisabled?: boolean; className?: string; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => {
    const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const viewport = window.visualViewport;
    const position = () => {
      dialog.style.setProperty('--vv-height', `${viewport?.height ?? innerHeight}px`);
      dialog.style.setProperty('--vv-top', `${viewport?.offsetTop ?? 0}px`);
    };
    position(); viewport?.addEventListener('resize', position); viewport?.addEventListener('scroll', position);
    return () => { viewport?.removeEventListener('resize', position); viewport?.removeEventListener('scroll', position); dialog.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog className={`game-dialog ${className}`} ref={ref} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header><h2 id={id}>{title}</h2><button className="game-button" aria-label={closeLabel === 'Close' ? 'Close panel' : closeLabel} disabled={closeDisabled} onClick={close}>{closeLabel}</button></header>
    {children}
  </dialog>, document.body);
}

export function Pager({ page, count, onChange, label = 'Page' }: { page: number; count: number; onChange: (page: number) => void; label?: string }) {
  return <div className="game-pager"><button className="game-button" aria-label={`Previous ${label.toLowerCase()}`} disabled={page === 0} onClick={() => onChange(page - 1)}>←</button><span>{label} {page + 1} / {Math.max(1, count)}</span><button className="game-button" aria-label={`Next ${label.toLowerCase()}`} disabled={page + 1 >= count} onClick={() => onChange(page + 1)}>→</button></div>;
}

// Measure the real text in its actual font and available region. Pagination
// handles long words/newlines without clipping or making the whole game scroll.
export function PagedText({ text, label = 'Text' }: { text: string; label?: string }) {
  const region = useRef<HTMLDivElement>(null); const probe = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([text]); const [page, setPage] = useState(0);
  useEffect(() => {
    const element = region.current!; const measure = probe.current!;
    function paginate() {
      if (element.clientHeight < 22 || element.clientWidth === 0) return;
      const result: string[] = []; let rest = text;
      while (rest.length) {
        let low = 1, high = rest.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2); measure.textContent = rest.slice(0, middle);
          if (measure.scrollHeight <= element.clientHeight) low = middle; else high = middle - 1;
        }
        let end = low;
        if (end < rest.length) { const space = rest.lastIndexOf(' ', end); if (space > end * .7) end = space + 1; }
        result.push(rest.slice(0, end)); rest = rest.slice(end);
      }
      measure.textContent = ''; setPages(result.length ? result : ['Nothing here yet.']); setPage(0);
    }
    const observer = new ResizeObserver(paginate); observer.observe(element); paginate();
    return () => observer.disconnect();
  }, [text]);
  return <div className="paged-text"><div className="text-region" ref={region}><div className="text-probe" ref={probe} aria-hidden="true" /><p data-testid="text-page">{pages[Math.min(page, pages.length - 1)]}</p></div><Pager page={Math.min(page, pages.length - 1)} count={pages.length} onChange={setPage} label={label} /></div>;
}
