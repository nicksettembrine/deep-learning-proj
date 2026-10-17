import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import './App.css'
import useAnnotations from './useAnnotations'
import AnnotationPanel, { AnnotationForm } from './AnnotationPanel'
import ModelPanel from './ModelPanel'
import TrainPanel from './TrainPanel'

// HW2 model features (Run model button, predicted band and Model tab).
const SHOW_MODEL = true

// Colors come from Apple's system palette. Activities use the bright hues; sensors
// and axes use colors the activity band never uses, so a signal color is never
// mistaken for an activity label.
// Four ActiGraph GT3X+ devices worn at the same time. Keys match the CSV prefixes.
const SENSORS = [
  { id: 'lw', label: 'Left wrist', color: '#1D1D1F' },   // graphite
  { id: 'lh', label: 'Left hip', color: '#A2845E' },     // brown
  { id: 'la', label: 'Left ankle', color: '#FF3B30' },   // red
  { id: 'ra', label: 'Right ankle', color: '#8E8E93' },  // gray
]
const AXIS_COLORS = { x: '#FF3B30', y: '#32ADE6', z: '#1D1D1F' }  // red, cyan, graphite
// Activity codes from the dataset. Order defines the colors in the label band.
const ACTIVITIES = [
  { code: 1, label: 'Walking', color: '#007AFF' },            // blue
  { code: 2, label: 'Descending stairs', color: '#FF9500' },  // orange
  { code: 3, label: 'Ascending stairs', color: '#AF52DE' },   // purple
  { code: 4, label: 'Driving', color: '#34C759' },            // green
  { code: 77, label: 'Clapping', color: '#FFCC00' },          // yellow
  { code: 99, label: 'Non-study', color: '#E5E5EA' },         // light gray
]
const GRID = '#F0F0F2'
// Plot layout sizes in pixels.
const BAND_PX = 22, BAND_GAP = 4, PANEL_PX = 150, PANEL_GAP = 20, OVERLAY_PX = 380
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'
const ACTIVITY_INDEX =Object.fromEntries(ACTIVITIES.map((a, i) => [a.code, i]))
const minutes = (seconds) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`

// Display files store integer milli-g; convert every channel to g once after loading.
function toG(file) {
  const convert = (values) => Float32Array.from(values, (v) => v / 1000)
  const sensors = Object.fromEntries(Object.entries(file.sensors).map(([id, channel]) => [id,
    Array.isArray(channel) ? convert(channel)
      : Object.fromEntries(Object.entries(channel).map(([axis, values]) => [axis, convert(values)]))]))
  return { ...file, sensors }
}

// Treat HTTP failures as errors instead of attempting to plot an error page.
async function readJson(path, signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal })
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`)
  // Development servers may return the app's HTML for a missing file with a
  // successful HTTP status. Explain that case instead of exposing a JSON error.
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Recording file not found.')
  }
  return response.json()
}

function App() {
  const [activeTab, setActiveTab] = useState('viewer')
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'viewer', label: 'Data Viewer' },
    ...(SHOW_MODEL ? [{ id: 'model', label: 'Model' }, { id: 'train', label: 'Train' }] : [])]

  // Keep the viewer mounted to preserve drafts and zoom. Resize Plotly only
  // after its panel becomes visible again (including a changed window width).
  useEffect(() => {
    if (activeTab !== 'viewer') return
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [activeTab])

  const [catalog, setCatalog] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [retry, setRetry] = useState(0)

  // The catalog written by scripts/preprocess.py controls which participants appear.
  useEffect(() => {
    const controller = new AbortController()
    readJson('data/recordings.json', controller.signal)
      .then((recordings) => {
        if (!recordings.length) throw new Error('No recordings are available.')
        setCatalog(recordings)
        setSelectedId(recordings[0].id)
        setCatalogError('')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setCatalogError(error.message)
      })
    return () => controller.abort()
  }, [retry])

  const selected = catalog.find((recording) => recording.id === selectedId)
  // Stacked/Overlay, Magnitude/x-y-z, and which sensors are shown (left wrist by default: the model's input).
  const [viewPrefs, setViewPrefs] = useState({ viewMode: 'stacked', signalMode: 'vm', sensors: ['lw'] })
  const openParticipant = useCallback((id) => { setSelectedId(id); setActiveTab('viewer') }, [])

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M2 18h5l3-8 5 14 4-10 3 4h8" />
              </svg>
            </span>
            <span>Accelerometry Activity Viewer</span>
          </div>
          <nav className="app-tabs" role="tablist" aria-label="Project sections">
            {tabs.map((tab, index) => (
              <button key={tab.id} id={`tab-${tab.id}`} role="tab"
                aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  // Standard tab keyboard navigation: arrows wrap; Home/End jump.
                  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
                  if (next === null) return
                  event.preventDefault()
                  setActiveTab(tabs[next].id)
                  document.getElementById(`tab-${tabs[next].id}`)?.focus()
                }}>{tab.label}</button>
            ))}
          </nav>
        </div>
      </header>
      <main>
      <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== 'overview'} tabIndex={0}>
        <header className="viewer-header">
          <h1>Overview</h1>
        </header>
        <div className="overview-introduction">
          <p>Raw accelerometry from 32 healthy adults wearing four sensors (left wrist, left hip, left ankle, right ankle) during outdoor walking, stair climbing, and driving. Each sample is labeled with the activity. A multilayer perceptron classifies 4-second windows of the left-wrist signal as walking, descending stairs, ascending stairs, or driving.</p>
          <p className="overview-source">Data: <a href="https://physionet.org/content/accelerometry-walk-climb-drive/1.0.0/">Karas et al. (2021), PhysioNet</a></p>
        </div>

        <h2 className="overview-help-heading">Tabs</h2>
        <dl className="spec-list tab-list">
          <div><dt>Data Viewer</dt><dd>Signals, activity labels, model predictions, and annotations for each test participant.</dd></div>
          {SHOW_MODEL && <>
            <div><dt>Model</dt><dd>Architecture, training, and test results.</dd></div>
            <div><dt>Train</dt><dd>Retrain the network with different settings and compare it with the saved model.</dd></div>
          </>}
        </dl>

        <h2 className="overview-help-heading">Using the Data Viewer</h2>
        <ol className="help-steps">
          <li><h3>Participant</h3><p>Select a participant from the list or with the arrows. All five were held out from training.</p></li>
          <li><h3>Sensors and view</h3><p>Select the sensors to plot (left wrist by default). Stacked plots each sensor in its own panel; Overlay plots them on one axis. Magnitude or x/y/z.</p></li>
          {SHOW_MODEL && <li><h3>Model predictions</h3><p>Run model adds a Predicted band below the true labels. Hover over it for class probabilities.</p></li>}
          <li><h3>Zoom</h3><p>Drag across the plot to zoom. Double-click to reset.</p></li>
          <li><h3>Annotations</h3><p>Click Add annotation, then drag over the plot or enter start and end times. Click a saved annotation to zoom to it.</p></li>
        </ol>
      </section>
      {SHOW_MODEL && (
        <section id="panel-model" role="tabpanel" aria-labelledby="tab-model" hidden={activeTab !== 'model'} tabIndex={0}>
          <header className="viewer-header"><h1>Model</h1></header>
          <ModelPanel active={activeTab === 'model'} onOpenParticipant={openParticipant} />
        </section>
      )}
      {SHOW_MODEL && (
        <section id="panel-train" role="tabpanel" aria-labelledby="tab-train" hidden={activeTab !== 'train'} tabIndex={0}>
          <header className="viewer-header"><h1>Train</h1></header>
          <TrainPanel active={activeTab === 'train'} />
        </section>
      )}
      {/* Hiding instead of unmounting preserves the complete viewer session. */}
      <section id="panel-viewer" role="tabpanel" aria-labelledby="tab-viewer" hidden={activeTab !== 'viewer'} tabIndex={0}>
      {catalogError ? (
        <div className="viewer-message" role="alert">
          <p>{catalogError}</p>
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      ) : selected ? (
        // A new key clears the previous signals, zoom and prediction immediately.
        // View choices live here, so they carry over when moving between participants.
        <RecordingViewer key={selected.id} recording={selected} catalog={catalog}
          onSelect={setSelectedId} prefs={viewPrefs} setPrefs={setViewPrefs} />
      ) : <p className="viewer-message" role="status">Loading recordings…</p>}
      </section>
      </main>
    </>
  )
}

function RecordingViewer({ recording, catalog, onSelect, prefs, setPrefs }) {
  const annotations = useAnnotations(recording.id)
  const [focus, setFocus] = useState(null)
  const [highlightedId, setHighlightedId] = useState(null)
  const resetView = useCallback(() => setFocus({ range: null, revision: Date.now() }), [])
  const zoomSeconds = useCallback((start, end) => {
    const padding = Math.max((end - start) * 0.1, 5)
    setFocus({ range: [(start - padding) / 60, (end + padding) / 60], revision: Date.now() })
  }, [])

  function focusAnnotation(item) {
    setHighlightedId(item.id)
    zoomSeconds(item.start_seconds, item.end_seconds)
    document.querySelector('.chart-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const { viewMode, signalMode, sensors: selectedSensors } = prefs
  const setPref = (key, value) => setPrefs((current) => ({ ...current, [key]: value }))
  const overlay = viewMode === 'overlay'
  const showAxes = !overlay && signalMode === 'xyz'
  const [data, setData] = useState(null)
  const [xyz, setXyz] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [prediction, setPrediction] = useState(null)
  const [predicting, setPredicting] = useState(false)
  const [predictError, setPredictError] = useState('')

  // Send the recording to the backend, which runs the trained MLP on every 4-s wrist window.
  async function runModel() {
    setPredicting(true); setPredictError('')
    try {
      const response = await fetch(`/api/recordings/${encodeURIComponent(recording.id)}/predict`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail ?? 'Model service unavailable. Start the backend and retry.')
      setPrediction(body)
    } catch (failure) { setPredictError(failure.message) }
    finally { setPredicting(false) }
  }

  // Magnitude and labels load together; the larger x/y/z file loads only when requested.
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(['vm.json', 'activity.json'].map((filename) =>
      readJson(`${recording.path}/${filename}`, controller.signal)))
      .then(([vm, activity]) => setData({ vm: toG(vm), activity }))
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [recording.path, retry])

  useEffect(() => {
    if (!showAxes || xyz) return
    const controller = new AbortController()
    readJson(`${recording.path}/xyz.json`, controller.signal)
      .then((file) => setXyz(toG(file)))
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [showAxes, xyz, recording.path])

  const demo = recording.demographics ?? {}
  const index = catalog.findIndex((r) => r.id === recording.id)

  let body
  if (error) body = (
    <div className="viewer-message" role="alert">
      <p>Unable to load {recording.participant}. {error}</p>
      <button onClick={() => { setError(''); setRetry((value) => value + 1) }}>Retry</button>
    </div>
  )
  else if (!data) body = <p className="viewer-message" role="status">Loading {recording.participant}…</p>
  else body = (
    <>
      <AnnotationForm annotations={annotations} />
      <div className="stage-legend" aria-label="Activity colors">
        {ACTIVITIES.map((a) => <span key={a.code}><i style={{ background: a.color }} />{a.label}</span>)}
      </div>
      {showAxes && !xyz ? <p className="viewer-message" role="status">Loading x/y/z axes…</p> : (
        <SignalPlot data={data} xyz={showAxes ? xyz : null} overlay={overlay} prediction={prediction}
          selectedSensors={selectedSensors} recordingId={recording.id} focus={focus}
          highlightedId={highlightedId} items={annotations.items} editingId={annotations.editingId}
          hasDraft={Boolean(annotations.draft)} draftStart={annotations.draft?.start_seconds}
          draftEnd={annotations.draft?.end_seconds} onSelected={annotations.select} onReset={resetView} />
      )}
    </>
  )

  return (
    <>
      <section className="chart-panel" aria-label="Accelerometry recording signals">
        {/* Row 1: which participant, and how the signals are arranged. */}
        <div className="chart-header">
          <div className="participant-nav">
            <button className="icon-button" aria-label="Previous participant" disabled={index <= 0}
              onClick={() => onSelect(catalog[index - 1].id)}>‹</button>
            <select aria-label="Participant" value={recording.id} onChange={(event) => onSelect(event.target.value)}>
              {catalog.map((r) => <option key={r.id} value={r.id}>{r.participant}</option>)}
            </select>
            <button className="icon-button" aria-label="Next participant" disabled={index >= catalog.length - 1}
              onClick={() => onSelect(catalog[index + 1].id)}>›</button>
            <span className="recording-duration">
              {index + 1} of {catalog.length} · {minutes(recording.duration_s)}
              {demo.age ? ` · ${demo.sex}, ${demo.age} y` : ''}
            </span>
          </div>
          <div className="header-toggles">
            <div className="view-toggle" role="group" aria-label="Plot arrangement">
              {[['stacked', 'Stacked'], ['overlay', 'Overlay']].map(([mode, label]) => (
                <button key={mode} aria-pressed={viewMode === mode} onClick={() => setPref('viewMode', mode)}>{label}</button>
              ))}
            </div>
            {!overlay && (
              <div className="view-toggle" role="group" aria-label="Signal shown in each panel">
                {[['vm', 'Magnitude'], ['xyz', 'x / y / z']].map(([mode, label]) => (
                  <button key={mode} aria-pressed={signalMode === mode} onClick={() => setPref('signalMode', mode)}>{label}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: which sensors to show, navigation, and annotation. */}
        <div className="chart-guide">
          <div className="signal-options" role="group" aria-label="Sensors shown">
            {SENSORS.map((sensor) => {
              const checked = selectedSensors.includes(sensor.id)
              return (
                // Stacked panels are all graphite, so only Overlay chips carry the sensor color.
                <label key={sensor.id} className={`signal-option${checked ? ' selected' : ''}`}
                  style={{ '--signal-color': overlay ? sensor.color : '#1D1D1F' }}>
                  <input type="checkbox" checked={checked}
                    disabled={checked && selectedSensors.length === 1}
                    onChange={() => setPref('sensors', checked
                      ? selectedSensors.filter((id) => id !== sensor.id)
                      : SENSORS.map((s) => s.id).filter((id) => id === sensor.id || selectedSensors.includes(id)))} />
                  {sensor.label}
                </label>
              )
            })}
          </div>
          <div className="annotation-actions">
            {annotations.draft && <span>Drag across the plot to mark an interval</span>}
            <button onClick={annotations.add} disabled={Boolean(annotations.draft) || annotations.saving}>Add annotation</button>
          </div>
        </div>

        {/* Row 3: the HW2 model, kept separate from navigation. */}
        {SHOW_MODEL && (
          <div className="model-strip">
            <div>
              <strong>Activity model</strong>
              <span>Left-wrist MLP, 4-second windows</span>
            </div>
            <div className="annotation-actions">
              {prediction?.model === 'experiment' && <span>New model (Train tab)</span>}
              {prediction && prediction.accuracy !== null && (
                <span className="model-result">Agreement with true labels: <strong>{(prediction.accuracy * 100).toFixed(1)}%</strong> ({prediction.scored_windows} windows)</span>
              )}
              {predictError && <span role="alert">{predictError}</span>}
              <button className="primary-button" onClick={runModel} disabled={predicting || !data}>
                {predicting ? 'Running…' : prediction ? 'Re-run model' : 'Run model'}</button>
            </div>
          </div>
        )}
        {body}
      </section>
      <AnnotationPanel annotations={annotations} onFocus={focusAnnotation} highlightedId={highlightedId} onHighlight={setHighlightedId} />
      <p className="source-note">
        Data: <a href={recording.source}>Karas, Urbanek, Crainiceanu, Harezlak &amp; Fadel (2021), PhysioNet</a>,
        doi:10.13026/51h0-a262, under the{' '}
        <a href="https://physionet.org/content/accelerometry-walk-climb-drive/view-license/1.0.0/">Open Database License v1.0</a>.
        Displayed at 25 Hz (block means of the raw 100 Hz signal).
      </p>
    </>
  )
}

// Text edits stay in the lightweight form. Only signal, interval, or chart
// changes cross this memo boundary, avoiding Plotly redraws on each keystroke.
const SignalPlot = memo(function SignalPlot({ data, xyz, overlay, prediction, selectedSensors,
  recordingId, focus, highlightedId, items, editingId, hasDraft, draftStart,
  draftEnd, onSelected, onReset }) {
  const { vm, activity } = data
  // Time is implicit in the files (sample i at i / fs seconds); build it once, in minutes.
  const length = vm.sensors.lw.length
  const time = useMemo(() => Float64Array.from({ length }, (_, i) => i / vm.fs / 60), [length, vm.fs])
  const timeRange = focus?.range ? { range: focus.range, autorange: false } : { autorange: true }
  const mode = hasDraft ? 'lines+markers' : 'lines'
  // Invisible markers make line traces selectable for box-selection annotations.
  const marker = { opacity: 0, size: 2 }

  // Activity labels as a one-row heatmap; x holds segment edges so each bar spans its interval.
  const band = {
    type: 'heatmap', x: [...activity.map((s) => s.start / 60), activity.at(-1).end / 60], y: [0],
    z: [activity.map((s) => ACTIVITY_INDEX[s.code] ?? 5)],
    customdata: [activity.map((s) => `${s.label} (${(s.end - s.start).toFixed(1)} s)`)],
    zmin: -0.5, zmax: ACTIVITIES.length - 0.5, showscale: false,
    colorscale: ACTIVITIES.flatMap((a, i) => [[i / ACTIVITIES.length, a.color], [(i + 1) / ACTIVITIES.length, a.color]]),
    hovertemplate: '%{customdata}<extra></extra>', xaxis: 'x', yaxis: 'y',
  }

  const traces = [band]
  // Band labels are horizontal annotations: rotated axis titles would overlap on the thin bands.
  const bandLabels = []
  const bandAxis = (domain, text) => {
    bandLabels.push({ text, xref: 'paper', yref: 'paper', x: 0, xanchor: 'right', xshift: -8,
      y: (domain[0] + domain[1]) / 2, yanchor: 'middle', showarrow: false, font: { size: 11, color: '#6E6E73' } })
    return { domain, showticklabels: false, ticks: '', showgrid: false, zeroline: false, fixedrange: true }
  }
  // Layout in pixels, so bands and panels keep their size however many sensors are shown.
  // Plotly wants fractions of the plot area (1 = top), so `domain` converts.
  const shown = SENSORS.filter((s) => selectedSensors.includes(s.id))
  const showLegend = Boolean(xyz)
  const bandsPx = prediction ? 2 * BAND_PX + BAND_GAP : BAND_PX
  const signalTop = bandsPx + 16
  const area = signalTop + (overlay ? OVERLAY_PX : shown.length * PANEL_PX + (shown.length - 1) * PANEL_GAP)
  const margin = { l: 85, r: 24, t: showLegend ? 36 : 12, b: 56 }
  const domain = (fromTop, size) => [Math.max(0, 1 - (fromTop + size) / area), Math.min(1, 1 - fromTop / area)]
  // With predictions, a second band sits directly under the true labels for comparison.
  const layoutAxes = { yaxis: bandAxis(domain(0, BAND_PX), prediction ? 'True' : 'Activity') }
  if (prediction) {
    const w = prediction.windows
    traces.push({
      type: 'heatmap', x: [...w.map((d) => d.start / 60), w.at(-1).end / 60], y: [0],
      z: [w.map((d) => ACTIVITY_INDEX[d.pred])], zmin: -0.5, zmax: ACTIVITIES.length - 0.5, showscale: false,
      colorscale: band.colorscale, xaxis: 'x', yaxis: 'y7',
      customdata: [w.map((d) => `Predicted: ${ACTIVITIES[ACTIVITY_INDEX[d.pred]].label}`
        + (d.true ? ` (true: ${ACTIVITIES[ACTIVITY_INDEX[d.true]].label})` : '') + '<br>'
        + prediction.classes.map((c, i) => `${c}: ${(d.probs[i] * 100).toFixed(0)}%`).join('<br>'))],
      hovertemplate: '%{customdata}<extra></extra>',
    })
    layoutAxes.yaxis7 = bandAxis(domain(BAND_PX + BAND_GAP, BAND_PX), 'Predicted')
  }
  if (overlay) {
    shown.forEach((sensor) => traces.push({
      type: 'scattergl', mode, marker, x: time, y: vm.sensors[sensor.id], name: sensor.label,
      line: { color: sensor.color, width: 1 }, opacity: 0.7, xaxis: 'x', yaxis: 'y2',
      hovertemplate: `${sensor.label}: %{y:.3f} g<br>%{x:.2f} min<extra></extra>`,
    }))
    layoutAxes.yaxis2 = { domain: domain(signalTop, OVERLAY_PX), title: { text: 'Magnitude (g)', standoff: 12 }, automargin: true,
      gridcolor: GRID, zeroline: false }
  } else {
    // Stacked: one panel per shown sensor, all sharing the single time axis.
    shown.forEach((sensor, index) => {
      const axis = `y${index + 2}`
      layoutAxes[`yaxis${index + 2}`] = {
        domain: domain(signalTop + index * (PANEL_PX + PANEL_GAP), PANEL_PX), title: { text: `${sensor.label} (g)`, standoff: 10, font: { size: 11 } },
        automargin: true, gridcolor: GRID, zeroline: false, tickformat: '.1f',
      }
      if (xyz) {
        // Every panel uses the same three axis colors, so the legend lists x, y and z once.
        ['x', 'y', 'z'].forEach((ax) => traces.push({
          type: 'scattergl', mode, marker, x: time, y: xyz.sensors[sensor.id][ax], name: `${ax} axis`,
          legendgroup: ax, showlegend: index === 0,
          line: { color: AXIS_COLORS[ax], width: 0.9 }, xaxis: 'x', yaxis: axis,
          hovertemplate: `${sensor.label} ${ax}: %{y:.3f} g<br>%{x:.2f} min<extra></extra>`,
        }))
      } else {
        // Each panel is labeled, so stacked panels share one calm graphite tone;
        // sensor colors are only needed in Overlay, where lines share an axis.
        traces.push({
          type: 'scattergl', mode, marker, x: time, y: vm.sensors[sensor.id], name: sensor.label,
          line: { color: '#48484A', width: 0.8 }, xaxis: 'x', yaxis: axis,
          hovertemplate: `${sensor.label}: %{y:.3f} g<br>%{x:.2f} min<extra></extra>`,
        })
      }
    })
  }

  return (
    <Plot
      // Remount when changing arrangement to clear obsolete axes.
      key={`${overlay ? 'overlay' : `stacked-${xyz ? 'xyz' : 'vm'}`}-${selectedSensors.join('-')}`}
      data={traces}
      layout={{
        autosize: true,
        dragmode: hasDraft ? 'select' : 'zoom',
        selectdirection: 'h',
        // Keep a user's zoom while labels change; focusing an interval changes uirevision.
        uirevision: focus?.revision ?? recordingId,
        selections: [],
        shapes: [
          ...items.filter((item) => item.id !== editingId),
          ...(hasDraft && draftStart !== '' && draftEnd !== '' && Number(draftEnd) > Number(draftStart)
            ? [{ start_seconds: draftStart, end_seconds: draftEnd }] : []),
        ].map((item) => ({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: Number(item.start_seconds) / 60, x1: Number(item.end_seconds) / 60, y0: 0, y1: 1,
          // Neutral gray so annotations never read as an activity color.
          fillcolor: item.id === highlightedId ? 'rgba(29,29,31,0.14)' : 'rgba(29,29,31,0.06)',
          line: { color: 'rgba(29,29,31,0.35)', width: item.id === highlightedId ? 2 : 1 }, layer: 'below',
        })),
        // Overlay needs no legend: the sensor chips above show each line's color.
        showlegend: showLegend,
        legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1, yanchor: 'bottom', font: { size: 11 } },
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { family: FONT, size: 12, color: '#6E6E73' },
        xaxis: { title: { text: 'Minutes since recording start', standoff: 16 }, automargin: true,
          anchor: overlay ? 'y2' : `y${shown.length + 1}`, ...timeRange },
        ...layoutAxes,
        annotations: bandLabels,
        height: area + margin.t + margin.b,
        margin,
      }}
      onSelected={onSelected}
      onDoubleClick={onReset}
      useResizeHandler
      className="signal-chart"
      style={{ height: area + margin.t + margin.b }}
      config={{
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['resetScale2d', 'lasso2d'],
        modeBarButtonsToAdd: [{ name: 'Reset axes',
          icon: { width: 24, height: 24, path: 'M12 3 2 12h3v9h5v-6h4v6h5v-9h3L12 3z' },
          click: onReset,
        }],
      }}
    />
  )
})

export default App
