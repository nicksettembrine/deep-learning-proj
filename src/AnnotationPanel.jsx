import { useEffect, useRef } from 'react'

// Times are elapsed from EEG start; negative values are valid wearable samples.
function formatTime(seconds) {
  const value = Math.round(Math.abs(seconds))
  return `${seconds < 0 ? '−' : ''}${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function AnnotationForm({ annotations: a }) {
  const formRef = useRef(null)
  const open = Boolean(a.draft)
  // Adding or editing from the list brings the form into view. Selecting a new
  // interval does not scroll again, so the user can keep interacting with plots.
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [open])
  if (!a.draft) return null
  const update = (field, value) => a.setDraft((current) => ({ ...current, [field]: value }))
  return (
    <form ref={formRef} className="annotation-form" onSubmit={a.save}>
      <h3>{a.editingId ? 'Edit annotation' : 'New annotation'}</h3>
      <p>Drag across a plot to mark an interval, or enter times below. Times are seconds since EEG recording start.</p>
      <fieldset disabled={a.saving}>
        <div className="annotation-fields">
          <label>Start (seconds)<input type="number" step="any" required value={a.draft.start_seconds} onChange={(e) => update('start_seconds', e.target.value)} /></label>
          <label>End (seconds)<input type="number" step="any" required value={a.draft.end_seconds} onChange={(e) => update('end_seconds', e.target.value)} /></label>
          <label className="annotation-label">Label<input maxLength={100} required placeholder="e.g. Movement artifact" value={a.draft.label} onChange={(e) => update('label', e.target.value)} /></label>
          <label className="annotation-note">Note (optional)<textarea maxLength={2000} rows={2} value={a.draft.note} onChange={(e) => update('note', e.target.value)} /></label>
        </div>
        <div className="annotation-actions"><button className="primary-button" type="submit">{a.saving ? 'Saving…' : 'Save annotation'}</button><button type="button" onClick={a.cancel}>Cancel</button></div>
      </fieldset>
      {a.message && <p role="status">{a.message}</p>}
    </form>
  )
}

export default function AnnotationPanel({ annotations: a, onFocus, highlightedId, onHighlight }) {
  return (
    <section className="annotation-panel" aria-label="Saved annotations">
      <div className="annotation-panel-heading"><h2>Annotations <span>({a.items.length})</span></h2>
        <button onClick={a.add} disabled={a.saving || Boolean(a.draft)}>Add annotation</button></div>
      {a.loading ? <p role="status">Loading annotations…</p> : a.error ? (
        <div role="alert"><p>{a.error}</p><button onClick={a.retry}>Retry annotations</button></div>
      ) : !a.items.length && <p>No annotations yet. Mark an interval to add a label or note.</p>}
      {!a.draft && a.message && <p role="status">{a.message}</p>}
      <ul className="annotation-list">
        {a.items.map((item) => <li key={item.id} className={highlightedId === item.id ? 'highlighted-annotation' : ''} onMouseEnter={() => onHighlight(item.id)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(item.id)} onBlur={() => onHighlight(null)}>
          <div className="annotation-details"><button className="annotation-jump" onClick={() => onFocus(item)} aria-label={`Zoom to ${item.label}`}>{item.label}</button>
            <span>{formatTime(item.start_seconds)} – {formatTime(item.end_seconds)}</span>
            {item.note && <p>{item.note}</p>}</div>
          <div className="annotation-actions">
            <button disabled={a.saving} onClick={() => a.edit(item)}>Edit</button>
            {a.deleteId === item.id ? <><button disabled={a.saving} onClick={() => a.remove(item.id)}>Confirm delete</button><button onClick={() => a.setDeleteId(null)}>Keep</button></>
              : <button disabled={a.saving} onClick={() => a.setDeleteId(item.id)}>Delete</button>}
          </div>
        </li>)}
      </ul>
    </section>
  )
}
