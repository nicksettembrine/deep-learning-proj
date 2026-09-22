import { memo, useCallback, useEffect, useState } from 'react'
import Plot from 'react-plotly.js'
import './App.css'
import useAnnotations from './useAnnotations'
import AnnotationPanel, { AnnotationForm } from './AnnotationPanel'

// Shared signal colors keep traces, scales, and selection controls consistent.
const SIGNALS = [
  { id: 'sleep', label: 'Sleep stage', color: '#686D9F', title: 'Sleep Stage' },
  { id: 'heart', label: 'Heart rate', color: '#AC6078', title: 'Heart Rate (bpm)' },
  { id: 'motion', label: 'Acceleration', color: '#34827E', title: 'Acceleration (g)' },
]
const STAGE_COLORS = ['#d4dae2', '#bbbcd7', '#969cc4', '#68739d', '#b28ca6', '#e5e7eb']
const duration = (seconds) => {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const STAGES = ['Wake', 'N1', 'N2', 'N3', 'REM', 'Unknown']

// Treat HTTP failures as errors instead of attempting to plot an error page.
async function readJson(path, signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal })
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`)
  // Development servers may return the app's HTML for a missing file with a
  // successful HTTP status. Explain that case instead of exposing a JSON error.
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The recording file is missing or unavailable. Please retry.')
  }
  return response.json()
}

function App() {
  const [activeTab, setActiveTab] = useState('viewer')
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'viewer', label: 'Data Viewer' }]

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

  // The catalog controls which participants and nights are available. Adding
  // prepared recordings does not require hard-coding more dropdown options.
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
  const participants = [...new Set(catalog.map((recording) => recording.participant))]
  const nights = catalog.filter((recording) => recording.participant === selected?.participant)

  return (
    <>
      {/* Keep the application identity separate from the selected recording. */}
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <circle cx="14" cy="18" r="10" />
                <path d="M8 17q2 3 4 0M16 17q2 3 4 0M12 23q2 1 4 0M23 5h5l-5 5h5" />
              </svg>
            </span>
            <span>Sleep Signal Viewer</span>
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
          <h1>Project overview</h1>
        </header>
        <div className="overview-introduction">
          <p>This application provides a way to view and annotate sleep recordings from the BIDSleep dataset. You can select a participant and night to observe heart rate and wrist acceleration with EEG sleep-stage labels. </p>
          <p className="overview-source">Data source: <a href="https://physionet.org/content/bidsleep-dataset/1.0.0/">BIDSleep on PhysioNet</a></p>
        </div>
        <h2 className="overview-help-heading">How to use the viewer</h2>
        <ol className="help-steps">
          <li><h3>Choose a participant and night</h3></li>
          <li><h3>Compare signals</h3><p>Stacked shows all three plots on a shared time axis. Overlay lets you select individual signals. Sleep stages appear as a colored strip when combined with wearable signals.</p></li>
          <li><h3>Inspect a time interval</h3><p>Drag across a plot to zoom. Hover over a signal for its value and time. Double-click restores the entire recording.</p></li>
          <li><h3>Add an annotation</h3><p>Click Add annotation, then drag over the plot to select an interval or enter start and end times in seconds relative to the EEG start. Add a label and optional note, then save.</p></li>
          <li><h3>Revisit your observations</h3><p>Click a saved annotation’s label to zoom to it. Hover or focus its row to highlight the interval.</p></li>
        </ol>
      </section>
      {/* Hiding instead of unmounting preserves the complete viewer session. */}
      <section id="panel-viewer" role="tabpanel" aria-labelledby="tab-viewer" hidden={activeTab !== 'viewer'} tabIndex={0}>
      <header className="viewer-header"><h1>Sleep Signal Viewer</h1></header>

      {selected && (
        <section className="recording-controls" aria-label="Choose a recording">
          <div className="selection-heading">
            <h2>Select a recording</h2>
            <p>{participants.length} {participants.length === 1 ? 'participant' : 'participants'} · {catalog.length} {catalog.length === 1 ? 'night' : 'nights'} available</p>
          </div>
          <label>
            Participant
            <select value={selected.participant} onChange={(event) => {
              // Start at the first available night for the new participant;
              // participants need not have the same number of recordings.
              setSelectedId(catalog.find((recording) =>
                recording.participant === event.target.value).id)
            }}>
              {participants.map((participant) => (
                <option key={participant} value={participant}>{participant}</option>
              ))}
            </select>
          </label>
          <label>
            Night
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {nights.map((recording) => (
                <option key={recording.id} value={recording.id}>Night {recording.night}</option>
              ))}
            </select>
          </label>
        </section>
      )}

      {catalogError ? (
        <div className="viewer-message" role="alert">
          <p>{catalogError}</p>
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      ) : selected ? (
        // A new key clears the previous signals and Plotly zoom immediately.
        <RecordingViewer key={selected.id} recording={selected} />
      ) : <p className="viewer-message" role="status">Loading recordings…</p>}
      </section>
      </main>
    </>
  )
}

function RecordingViewer({ recording }) {
  const annotations = useAnnotations(recording.id)
  const [focus, setFocus] = useState(null)
  const [highlightedId, setHighlightedId] = useState(null)
  const resetView = useCallback(() => setFocus({ range: null, revision: Date.now() }), [])

  function focusAnnotation(item) {
    setHighlightedId(item.id)
    const padding = Math.max((item.end_seconds - item.start_seconds) * 0.1, 10)
    setFocus({ range: [(item.start_seconds - padding) / 3600, (item.end_seconds + padding) / 3600], revision: Date.now() })
    document.querySelector('.chart-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Display mode changes axis placement only; the signal values are unchanged.
  const [viewMode, setViewMode] = useState('stacked')
  const overlay = viewMode === 'overlay'
  // Overlay starts with two physical measurements. Keep at least one selected;
  // stacked view always shows all three and preserves this overlay selection.
  const [selectedSignals, setSelectedSignals] = useState(['heart', 'motion'])
  const [signals, setSignals] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    // Commit all three files together so no chart mixes different nights.
    // Abort obsolete requests when the user switches recordings quickly.
    Promise.all(['hr.json', 'sleep_stages.json', 'motion.json'].map((filename) =>
      readJson(`${recording.path}/${filename}`, controller.signal)))
      .then(([hrData, sleepData, motionData]) => {
        setSignals({ hrData, sleepData, motionData })
      })
      .catch((failure) => {
        if (failure.name !== 'AbortError') setError(failure.message)
      })
    return () => controller.abort()
  }, [recording.path, retry])

  if (error) return (
    <div className="viewer-message" role="alert">
      <p>Unable to load {recording.participant}, Night {recording.night}. {error}</p>
      <button onClick={() => { setError(''); setRetry((value) => value + 1) }}>Retry</button>
    </div>
  )
  if (!signals) return (
    <p className="viewer-message" role="status">
      Loading {recording.participant}, Night {recording.night}…
    </p>
  )
  const { hrData, sleepData, motionData } = signals
  const hasUnknown = sleepData.some((sample) => sample.Stage === 5)
  const activeSignals = overlay
    ? SIGNALS.filter((signal) => selectedSignals.includes(signal.id)) : SIGNALS
  // A categorical strip provides sleep context without a third overlapping scale.
  const stageStrip = overlay && activeSignals.some((signal) => signal.id === 'sleep') && activeSignals.length > 1
  const eegEnd = sleepData.length ? sleepData[sleepData.length - 1].ElapsedSeconds + 30 : 0
  const outsideEEG = [hrData, motionData].some((rows) => rows.length && rows[rows.length - 1].ElapsedSeconds > eegEnd + 60)



  return (
    <>
      <section className="chart-panel" aria-label="Overnight sleep recording signals">
        <div className="chart-header">
          <div className="recording-identity">
            <h2 className="recording-heading">{recording.participant}<span className="night-badge">Night {recording.night}</span></h2>
            <span className="recording-duration">EEG duration · {duration(eegEnd)}</span>
          </div>
          <div className="view-toggle" role="group" aria-label="Plot arrangement">
            {['stacked', 'overlay'].map((mode) => (
              <button key={mode} aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}>
                {mode === 'stacked' ? 'Stacked' : 'Overlay'}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-guide">
          {overlay ? (
            <div className="signal-options" role="group" aria-label="Signals to overlay">
              {SIGNALS.map((signal) => {
                const checked = selectedSignals.includes(signal.id)
                return (
                  <label key={signal.id} className={`signal-option${checked ? ' selected' : ''}`}
                    style={{ '--signal-color': signal.color }}>
                    <input type="checkbox" checked={checked}
                      disabled={checked && selectedSignals.length === 1}
                      onChange={() => setSelectedSignals((current) => checked
                        ? current.filter((id) => id !== signal.id) : [...current, signal.id])} />
                    {signal.label}
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="signal-key" aria-label="Displayed signals">
              {SIGNALS.map((signal) => <span key={signal.id}>
                <i style={{ background: signal.color }} />{signal.label}
              </span>)}
            </div>
          )}
          <div className="annotation-actions">
            <span>{annotations.draft ? 'Drag to mark an interval' : 'Drag to zoom · Double-click to reset'}</span>
            <button onClick={annotations.add} disabled={Boolean(annotations.draft) || annotations.saving}>Add annotation</button>
          </div>
        </div>
        <div className="time-controls">
          <div className="annotation-actions">
            <button onClick={() => setFocus({ range: [0, eegEnd / 3600], revision: Date.now() })}>Fit EEG window</button>
            <button onClick={resetView}>Show full recording</button>
          </div>

        </div>
        {outsideEEG && <p className="coverage-note">Wearable data extends beyond the EEG labels. “Fit EEG window” focuses on their shared period without removing data.</p>}
        <AnnotationForm annotations={annotations} />
        {/* One Plotly figure contains all three signals so their
            time axes can remain synchronized during zooming and panning. */}
        {overlay && <p className="overlay-note">{stageStrip ? 'Sleep stages appear in the strip above the signals. ' : ''}Each signal uses its own vertical scale; compare timing, not line heights.</p>}
        {stageStrip && <div className="stage-legend" aria-label="Sleep-stage colors">{STAGES.slice(0, hasUnknown ? 6 : 5).map((stage, i) => <span key={stage}><i style={{ background: STAGE_COLORS[i] }} />{stage}</span>)}</div>}
        <SignalPlot signals={signals} overlay={overlay} selectedSignals={selectedSignals}
          recordingId={recording.id} focus={focus} highlightedId={highlightedId}
          items={annotations.items} editingId={annotations.editingId}
          hasDraft={Boolean(annotations.draft)} draftStart={annotations.draft?.start_seconds}
          draftEnd={annotations.draft?.end_seconds} onSelected={annotations.select} onReset={resetView} />
      </section>
      <AnnotationPanel annotations={annotations} onFocus={focusAnnotation} highlightedId={highlightedId} onHighlight={setHighlightedId} />
      <p className="source-note">
        Data: <a href={recording.source}>BIDSleep / PhysioNet</a> (Song, 2026), under the{' '}
        <a href="https://physionet.org/content/bidsleep-dataset/view-license/1.0.0/">ODC Attribution License</a>.
      </p>
    </>
  )
}

// Text edits stay in the lightweight form. Only signal, interval, or chart
// changes cross this memo boundary, avoiding Plotly redraws on each keystroke.
const SignalPlot = memo(function SignalPlot({ signals, overlay, selectedSignals,
  recordingId, focus, highlightedId, items, editingId, hasDraft, draftStart,
  draftEnd, onSelected, onReset }) {
  const { hrData, sleepData, motionData } = signals
  const hasUnknown = sleepData.some((sample) => sample.Stage === 5)
  const activeSignals = overlay ? SIGNALS.filter((signal) => selectedSignals.includes(signal.id)) : SIGNALS
  const stageStrip = overlay && activeSignals.some((signal) => signal.id === 'sleep') && activeSignals.length > 1
  const plotSignals = stageStrip ? activeSignals.filter((signal) => signal.id !== 'sleep') : activeSignals
  const eegEnd = sleepData.length ? sleepData[sleepData.length - 1].ElapsedSeconds + 30 : 0
  const timeRange = focus?.range ? { range: focus.range, autorange: false } : { autorange: true }
  const overlayAxes = {}
  // Assign scales only to visible continuous signals, left then right.
  // Sleep stages use their own strip when combined with wearable signals.
  // Values stay in original units; no normalization is applied here.
  plotSignals.forEach((signal, index) => {
    overlayAxes[index === 0 ? 'yaxis' : `yaxis${index + 1}`] = {
      title: { text: signal.title, standoff: 12 },
      color: signal.color, automargin: true, domain: stageStrip ? [0, 0.76] : [0, 1],
      side: index === 0 ? 'left' : 'right',
      anchor: index === 2 ? 'free' : 'x',
      ...(index > 0 ? { overlaying: 'y' } : {}),
      ...(index === 2 ? { position: 1, shift: 75 } : {}),
      showgrid: index === 0, gridcolor: '#edf0f4', zeroline: false,
      ...(signal.id === 'sleep' ? {
        tickvals: hasUnknown ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4],
        ticktext: hasUnknown ? STAGES : STAGES.slice(0, 5),
      } : { tickformat: signal.id === 'motion' ? '.2f' : '.0f' }),
    }
  })
  return (
        <Plot
          // Remount when changing arrangement to clear obsolete axes and zoom.
          key={overlay ? `overlay-${activeSignals.map((signal) => signal.id).join('-')}` : 'stacked'}
          data={[
            {
              // Expert-reviewed EEG sleep stage every 30 seconds.
              // Divide elapsed seconds by 3600 to display time in hours.
              x: sleepData.map((d) => d.ElapsedSeconds / 3600),
              y: sleepData.map((d) => d.Stage),
              type: 'scatter',
              mode: hasDraft ? 'lines+markers' : 'lines',
              // Invisible markers enable Plotly box-selection for line traces.
              marker: { opacity: 0, size: 2 },

              // Sleep stages are discrete categories, so use a step line
              // rather than interpolating diagonally between stages.
              line: { shape: 'hv', color: SIGNALS[0].color, width: 1.8 },
              customdata: sleepData.map((d) => STAGES[d.Stage] ?? 'Unknown'),
              hovertemplate: 'Sleep stage: %{customdata}<br>Time: %{x:.2f} hr<extra></extra>',

              name: 'Sleep Stage',
              xaxis: 'x',
              yaxis: 'y',
            },
            {
              // Apple Watch heart-rate measurements.
              x: hrData.map((d) => d.ElapsedSeconds / 3600),
              y: hrData.map((d) => d.HR),
              type: 'scatter',
              mode: hasDraft ? 'lines+markers' : 'lines',
              // Invisible markers enable Plotly box-selection for line traces.
              marker: { opacity: 0, size: 2 },
              name: 'Heart Rate',
              line: { color: SIGNALS[1].color, width: 1.4 },
              hovertemplate: 'Heart rate: %{y:.1f} bpm<br>Time: %{x:.2f} hr<extra></extra>',
              xaxis: overlay ? 'x' : 'x2',
              yaxis: 'y2',
            },
            {
              // Apple Watch acceleration magnitude. preprocess.py
              // averages the raw ~50 Hz signal within one-second bins
              // for visualization only.
              x: motionData.map((d) => d.ElapsedSeconds / 3600),
              y: motionData.map((d) => d.magnitude),
              type: 'scatter',
              mode: hasDraft ? 'lines+markers' : 'lines',
              // Invisible markers enable Plotly box-selection for line traces.
              marker: { opacity: 0, size: 2 },
              name: 'Acceleration',
              line: { color: SIGNALS[2].color, width: 1.3 },
              hovertemplate: 'Acceleration: %{y:.3f} g<br>Time: %{x:.2f} hr<extra></extra>',
              xaxis: overlay ? 'x' : 'x3',
              yaxis: 'y3',
            },
          ].filter((trace, index) => !overlay || selectedSignals.includes(SIGNALS[index].id))
            .map((trace, index) => {
              if (!overlay) return trace
              const signal = activeSignals[index]
              if (stageStrip && signal.id === 'sleep') return {
                // Explicit epoch edges retain each label's full 30-second span.
                type: 'heatmap', x: [...sleepData.map((d) => d.ElapsedSeconds / 3600), eegEnd / 3600],
                y: [0], z: [sleepData.map((d) => d.Stage)],
                customdata: [sleepData.map((d) => STAGES[d.Stage] ?? 'Unknown')],
                zmin: -0.5, zmax: 5.5, showscale: false,
                colorscale: STAGE_COLORS.flatMap((color, i) => [[i / 6, color], [(i + 1) / 6, color]]),
                xaxis: 'x', yaxis: 'y3',
                hovertemplate: 'Sleep stage: %{customdata}<br>Time: %{x:.2f} hr<extra></extra>',
              }
              const axisIndex = plotSignals.findIndex((item) => item.id === signal.id)
              return { ...trace, xaxis: 'x', yaxis: axisIndex === 0 ? 'y' : `y${axisIndex + 1}` }
            })}
          layout={{
            autosize: true,
            dragmode: hasDraft ? 'select' : 'zoom',
            selectdirection: 'h',
            // Keep a user's zoom while labels change; clicking a list entry
            // intentionally changes uirevision to focus that interval.
            uirevision: focus?.revision ?? recordingId,
            selections: [],
            shapes: [
              ...items.filter((item) => item.id !== editingId),
              ...(hasDraft && draftStart !== '' && draftEnd !== ''
                && Number(draftEnd) > Number(draftStart)
                ? [{ start_seconds: draftStart, end_seconds: draftEnd }] : []),
            ].map((item) => ({
              type: 'rect', xref: 'x', yref: 'paper',
              x0: Number(item.start_seconds) / 3600, x1: Number(item.end_seconds) / 3600,
              y0: 0, y1: 1, fillcolor: item.id === highlightedId ? 'rgba(52,130,126,0.23)' : 'rgba(52,130,126,0.10)',
              line: { color: 'rgba(52,130,126,0.6)', width: item.id === highlightedId ? 2 : 1 }, layer: 'below',
            })),
            showlegend: false,
            paper_bgcolor: '#ffffff',
            plot_bgcolor: '#ffffff',
            font: { family: 'system-ui, sans-serif', size: 12, color: '#475569' },

            // Top panel: expert-reviewed sleep stages.
            xaxis: {
              showticklabels: false,

              // "matches" synchronizes this time axis with the
              // bottom axis when the user zooms or pans.
              matches: 'x3',
              domain: [0, 1],
              anchor: 'y',
              ...timeRange,
            },

            yaxis: {
              title: { text: 'Sleep Stage', standoff: 14 },
              automargin: true,

              // Convert the numeric stage codes into readable labels.
              tickvals: hasUnknown ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4],
              ticktext: hasUnknown ? ['Wake', 'N1', 'N2', 'N3', 'REM', 'Unknown'] : ['Wake', 'N1', 'N2', 'N3', 'REM'],

              // domain controls where this panel appears vertically
              // within the overall Plotly figure.
              domain: overlay ? [0, 1] : [0.72, 1],
              color: SIGNALS[0].color,
              gridcolor: '#edf0f4',
            },

            // Middle panel: heart rate.
            xaxis2: {
              showticklabels: false,
              matches: 'x3',
              domain: [0, 1],
              anchor: 'y2',
              ...timeRange,
            },

            yaxis2: {
              title: { text: 'Heart Rate (bpm)', standoff: 14 },
              automargin: true,
              domain: [0.36, 0.64],
              color: SIGNALS[1].color, gridcolor: '#edf0f4',
            },

            // Bottom panel: accelerometry.
            // Only this panel displays the shared x-axis labels.
            xaxis3: {
              title: { text: 'Hours Since EEG Recording Start', standoff: 16 },
              automargin: true,
              matches: 'x',
              domain: [0, 1],
              anchor: 'y3',
              ...timeRange,
            },

            yaxis3: {
              title: { text: 'Acceleration Magnitude (g)', standoff: 14 },
              automargin: true,
              domain: [0, 0.28],
              color: SIGNALS[2].color, gridcolor: '#edf0f4',
            },

            // Leave enough space around the figure for axis labels.
            margin: {
              l: 85,
              r: 24,
              t: 38,
              b: 70,
            },
            // Overlay separates categorical stages from the wearable scales.
            ...(overlay ? {
              xaxis: {
                title: { text: 'Hours Since EEG Recording Start', standoff: 16 },
                automargin: true,
                domain: [0, 1],
                anchor: 'y',
              ...timeRange,
              },
              xaxis2: { visible: false },
              xaxis3: { visible: false },
              // Explicitly hide inactive axes inherited from stacked layout.
              yaxis2: { visible: false },
              yaxis3: { visible: false },
              ...overlayAxes,
              ...(stageStrip ? { yaxis3: { domain: [0.85, 0.96], anchor: 'x', showticklabels: false, ticks: '', showline: false, showgrid: false, zeroline: false, fixedrange: true } } : {}),
              margin: { l: 85, r: plotSignals.length > 1 ? 85 : 24, t: 38, b: 70 },
            } : {}),
          }}
          onSelected={onSelected}
          onDoubleClick={onReset}
          useResizeHandler
          className={`signal-chart${overlay ? ' signal-chart-overlay' : ''}`}
          config={{
            responsive: true, displaylogo: false,
            // Plotly's default reset returns to the last mounted focus window.
            // This reset explicitly restores the complete recording instead.
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
