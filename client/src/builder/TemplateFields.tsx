import { useRef, type ReactNode } from 'react';
import { imageSource, TEMPLATE_LIMITS, type GameTemplate, type PortableImage, type TemplateOption } from '../../../shared/template.js';
import { duplicateOption, moveOption, newOption } from './model.js';
import './builder.css';

export function Field({ label, id, error, children, hint }: { label: string; id: string; error?: string; children: ReactNode; hint?: string }) {
  return <div className="editor-field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="field-hint">{hint}</span>}{error && <span className="field-error" id={`${id}-error`}>{error}</span>}</div>;
}
export function ImageField({ label, image, id, onUpload, onRemove, error }: { label: string; image: PortableImage | null; id: string; onUpload: (file: File) => void; onRemove: () => void; error?: string }) {
  const viewer = useRef<HTMLDialogElement>(null);
  return <div className="image-field">
    <Field label={label} id={id} error={error} hint="PNG or JPEG, up to 5 MiB / 20 MP. Resized locally; transparency is preserved.">
      <input id={id} type="file" accept="image/png,image/jpeg" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onUpload(file); }} />
    </Field>
    {image && <><div className="image-tools"><button className="image-open" onClick={() => viewer.current?.showModal()} aria-label={`View ${label.toLowerCase()} full size`}><img src={imageSource(image)} alt={`${label} preview`} /></button><button className="button" type="button" onClick={onRemove}>Remove {label.toLowerCase()}</button></div><dialog className="image-viewer" ref={viewer} aria-label={`${label} full size`}><img src={imageSource(image)} alt={`${label} full size`} /><form method="dialog"><button className="button primary" autoFocus>Close image</button></form></dialog></>}
  </div>;
}

export function TemplateFields({ template, update, activeIndex, setActiveIndex, busy, loading = false, upload, fieldError = () => undefined, draftName }: {
  template: GameTemplate; update: (value: GameTemplate) => void;
  activeIndex: number; setActiveIndex: (index: number) => void;
  busy: boolean; loading?: boolean; upload: (file: File, cover: boolean) => void;
  fieldError?: (path: string) => string | undefined; draftName?: ReactNode;
}) {
  const option = template.options[activeIndex];
  function updateOption(changes: Partial<TemplateOption>) { update({ ...template, options: template.options.map((item, index) => index === activeIndex ? { ...item, ...changes } : item) }); }
  function fieldProps(path: string, id = path) { return { 'aria-invalid': !!fieldError(path), 'aria-describedby': fieldError(path) ? id + '-error' : undefined }; }
  function move(to: number) { update({ ...template, options: moveOption(template.options, activeIndex, to) }); setActiveIndex(to); }
  return (<fieldset className="editor-main" disabled={busy || loading}>
        <section className="panel editor-section" aria-labelledby="settings-heading"><h2 id="settings-heading">The big idea</h2>
          {draftName}
          <Field label="Game title" id="game-title" error={fieldError('title')}><input id="game-title" maxLength={120} value={template.title} {...fieldProps('title', 'game-title')} onChange={(event) => update({ ...template, title: event.target.value })} /></Field>
          <Field label="Game description (optional)" id="game-description" error={fieldError('description')}><textarea id="game-description" rows={3} maxLength={4000} value={template.description} {...fieldProps('description', 'game-description')} onChange={(event) => update({ ...template, description: event.target.value })} /></Field>
          <ImageField label="Cover image" id="cover-image" image={template.coverImage} error={fieldError('coverImage')} onUpload={(file) => upload(file, true)} onRemove={() => update({ ...template, coverImage: null })} />
          <div className="settings-grid">
            {([['startingCurrency', 'Starting currency'], ['minimumOpeningBid', 'Opening price'], ['minimumBidIncrease', 'Minimum bid increase']] as const).map(([key, label]) => <Field key={key} label={label} id={key} error={fieldError(key)}><input id={key} type="number" inputMode="numeric" min={1} max={1000000} step={1} value={Number.isNaN(template[key]) ? '' : template[key]} {...fieldProps(key)} onChange={(event) => update({ ...template, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>)}
            <Field label="Currency symbol" id="currencySymbol" error={fieldError('currencySymbol')}><input id="currencySymbol" maxLength={8} value={template.currencySymbol} {...fieldProps('currencySymbol')} onChange={(event) => update({ ...template, currencySymbol: event.target.value })} /></Field>
          </div><p className="small-note">Fictional whole-number currency only. Everyone starts with the same budget. The opening price and minimum raise are separate settings.</p>
        </section>
        <section className="panel editor-section" aria-labelledby="options-heading"><h2 id="options-heading">The possibilities <span className="option-count">{template.options.length} / {TEMPLATE_LIMITS.options}</span></h2><p className="small-note">Options will be revealed in this order. Select one to edit and preview.</p>
          <Field label="Option to edit" id="option-picker" error={fieldError('options')}><select id="option-picker" value={option?.id ?? ''} onChange={(event) => setActiveIndex(template.options.findIndex((item) => item.id === event.target.value))}>{!option && <option value="">Add your first option</option>}{template.options.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title || 'Untitled option'}</option>)}</select></Field>
          {template.options.length > 1 && <details className="reorder-panel"><summary>See and reorder all options</summary><p className="small-note">Drag an option onto another position. Or select an option and use Move up / Move down below, with a mouse or keyboard.</p><ol className="option-order">{template.options.map((item, index) => <li key={item.id} draggable={!busy && !loading} data-option-id={item.id} onDragStart={(event) => { event.dataTransfer.setData('application/x-bid-and-build-option', item.id); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-bid-and-build-option')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); if (busy || loading) return; const from = template.options.findIndex((entry) => entry.id === event.dataTransfer.getData('application/x-bid-and-build-option')); if (from < 0 || from === index) return; const options = moveOption(template.options, from, index); update({ ...template, options }); setActiveIndex(Math.max(0, options.findIndex((entry) => entry.id === option?.id))); }}><span aria-hidden="true" className="drag-mark">⠿</span><button className="option-link" aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setActiveIndex(index)}>{index + 1}. {item.title || 'Untitled option'}</button></li>)}</ol></details>}
          <div className="builder-actions option-actions"><button className="button" disabled={template.options.length >= TEMPLATE_LIMITS.options} onClick={() => { update({ ...template, options: [...template.options, newOption()] }); setActiveIndex(template.options.length); }}>Add option</button>
            <button className="button" disabled={!option || template.options.length >= TEMPLATE_LIMITS.options} onClick={() => { if (option) { const options = [...template.options]; options.splice(activeIndex + 1, 0, duplicateOption(option)); update({ ...template, options }); setActiveIndex(activeIndex + 1); } }}>Duplicate option</button>
            <button className="button danger" disabled={!option} onClick={() => { if (window.confirm(`Remove “${option?.title || 'Untitled option'}”?`)) { update({ ...template, options: template.options.filter((_, index) => index !== activeIndex) }); setActiveIndex(Math.max(0, activeIndex - 1)); } }}>Remove option</button>
          </div>
          {option && <div className="option-editor" key={option.id}>
            <div className="builder-actions"><button className="button" disabled={activeIndex === 0} onClick={() => move(activeIndex - 1)}>Move up</button><button className="button" disabled={activeIndex === template.options.length - 1} onClick={() => move(activeIndex + 1)}>Move down</button><span className="small-note">Position {activeIndex + 1} of {template.options.length}</span></div>
            <Field label="Option title" id="option-title" error={fieldError(`options.${activeIndex}.title`)}><input id="option-title" maxLength={120} value={option.title} {...fieldProps(`options.${activeIndex}.title`, 'option-title')} onChange={(event) => updateOption({ title: event.target.value })} /></Field>
            <Field label="Option description (optional)" id="option-description" error={fieldError(`options.${activeIndex}.description`)}><textarea id="option-description" rows={4} maxLength={4000} value={option.description} {...fieldProps(`options.${activeIndex}.description`, 'option-description')} onChange={(event) => updateOption({ description: event.target.value })} /></Field>
            <ImageField label="Option image" id="option-image" image={option.image} error={fieldError(`options.${activeIndex}.image`)} onUpload={(file) => upload(file, false)} onRemove={() => updateOption({ image: null })} />
          </div>}
        </section>
      </fieldset>);
}
