import { useCallback, useEffect, useState } from 'react'

const emptyDraft = () => ({ start_seconds: '', end_seconds: '', label: '', note: '' })

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options, headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    let message = 'Annotation service unavailable. Start the local backend and retry.'
    try {
      const error = await response.json()
      if (typeof error.detail === 'string') message = error.detail
      else if (Array.isArray(error.detail)) message = error.detail.map((item) => item.msg).join(' ')
    } catch { /* A stopped backend may return a non-JSON proxy error. */ }
    throw new Error(message)
  }
  return response.status === 204 ? null : response.json()
}

// All annotation state belongs to a single mounted recording. Aborted list
// requests cannot populate a different participant's annotation list.
export default function useAnnotations(recordingId) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteId, setDeleteId] = useState(null)
  const endpoint = `/api/recordings/${encodeURIComponent(recordingId)}/annotations`

  useEffect(() => {
    const controller = new AbortController()
    request(endpoint, { signal: controller.signal })
      .then((data) => { setItems(data); setError(''); setLoading(false) })
      .catch((failure) => {
        if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false) }
      })
    return () => controller.abort()
  }, [endpoint, reload])

  function add() {
    setDraft(emptyDraft()); setEditingId(null); setMessage(''); setDeleteId(null)
  }
  function edit(item) {
    setDraft({ start_seconds: item.start_seconds, end_seconds: item.end_seconds, label: item.label, note: item.note })
    setEditingId(item.id); setMessage(''); setDeleteId(null)
  }
  function cancel() { setDraft(null); setEditingId(null); setMessage('') }

  async function save(event) {
    event.preventDefault()
    const payload = { ...draft, start_seconds: Number(draft.start_seconds), end_seconds: Number(draft.end_seconds), label: draft.label.trim() }
    if (draft.start_seconds === '' || draft.end_seconds === '' || !Number.isFinite(payload.start_seconds)
      || !Number.isFinite(payload.end_seconds) || payload.end_seconds <= payload.start_seconds || !payload.label) {
      setMessage('Enter a label and a valid interval with end time after start time.'); return
    }
    setSaving(true); setMessage('')
    try {
      const saved = await request(editingId ? `${endpoint}/${editingId}` : endpoint, {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload),
      })
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved]
        .sort((a, b) => a.start_seconds - b.start_seconds))
      setDraft(null); setEditingId(null); setError(''); setMessage('Annotation saved.')
    } catch (failure) { setMessage(failure.message) }
    finally { setSaving(false) }
  }

  async function remove(id) {
    setSaving(true)
    try {
      await request(`${endpoint}/${id}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item.id !== id))
      if (editingId === id) cancel()
      setDeleteId(null); setError(''); setMessage('Annotation deleted.')
    } catch (failure) { setMessage(failure.message) }
    finally { setSaving(false) }
  }

  // Box selection uses chart hours. Store seconds to keep annotations independent
  // of the display units, and support selection from any of the stacked panels.
  const hasDraft = Boolean(draft)
  const select = useCallback((event) => {
    if (!hasDraft || saving) return
    const range = Object.entries(event?.range ?? {}).find(([axis]) => axis.startsWith('x'))?.[1]
    if (!range || range.length !== 2) return
    const [start, end] = [...range].sort((a, b) => a - b).map((hour) => Math.round(hour * 36000) / 10)
    if (end > start) setDraft((current) => ({ ...current, start_seconds: start, end_seconds: end }))
  }, [hasDraft, saving])

  return { items, loading, error, draft, setDraft, editingId, saving, message,
    deleteId, setDeleteId, add, edit, cancel, save, remove, select,
    retry: () => { setLoading(true); setReload((value) => value + 1) } }
}
