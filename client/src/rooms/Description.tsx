import { useEffect, useId, useRef, useState } from 'react';

export function Description({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const hintId = useId();
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current!;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [text]);
  return <div className="option-description">
    <p ref={ref} className="description-text" tabIndex={overflowing ? 0 : undefined} role={overflowing ? 'region' : undefined} aria-label={overflowing ? label : undefined} aria-describedby={overflowing ? hintId : undefined}>{text || 'No description.'}</p>
    {overflowing && <span id={hintId} className="description-hint">Scroll to read the full description</span>}
  </div>;
}
