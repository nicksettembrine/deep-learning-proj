import { useCallback, useEffect, useState } from 'react'
import Plot from 'react-plotly.js'
import { ConfusionMatrix } from './ModelPanel'
import { pct, PLOT_LAYOUT, TRAIN_COLOR, VAL_COLOR } from './chartStyle'

// Defaults reproduce the saved model, so "Train" with no changes repeats its training.
const DEFAULTS = { hidden_layers: 2, units: 64, activation: 'relu', learning_rate: 0.001, epochs: 100, dropout: 0.2 }
const CHOICES = {
  hidden_layers: [[0, '0 (logistic regression)'], [1, '1'], [2, '2'], [3, '3']],
  units: [16, 32, 64, 128, 256].map((v) => [v, String(v)]),
  activation: [['relu', 'ReLU'], ['tanh', 'tanh'], ['sigmoid', 'sigmoid']],
  learning_rate: [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03].map((v) => [v, String(v)]),
  dropout: [0, 0.1, 0.2, 0.3, 0.5].map((v) => [v, String(v)]),
}
const LABELS = { hidden_layers: 'Hidden layers', units: 'Units per layer', activation: 'Activation',
  learning_rate: 'Learning rate', dropout: 'Dropout' }
const BUSY = ['loading', 'running']

async function call(path, options) {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join('; ') : body.detail
    throw new Error(detail ?? 'Training service unavailable. Start the backend and retry.')
  }
  return body
}

const describe = (s) => s.hidden_layers === 0 ? 'logistic regression'
  : `${s.hidden_layers} × ${s.units}, ${s.activation === 'relu' ? 'ReLU' : s.activation}, lr ${s.learning_rate}, dropout ${s.dropout}`

// Interactive training (choose settings, train, stop) and a live training monitor.
export default function TrainPanel({ active }) {
  const [settings, setSettings] = useState(DEFAULTS)
  const [state, setState] = useState(null)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const busy = BUSY.includes(state?.status)

  const refresh = useCallback(() => call('/api/train').then(setState).catch((e) => setError(e.message)), [])

  // Load the current state and the saved model's scores when the tab opens.
  useEffect(() => {
    if (!active) return
    refresh()
    if (!saved) call('/api/model').then((report) => setSaved(report.mlp)).catch(() => {})
  }, [active, saved, refresh])

  // While training, poll twice a second so the curve draws itself epoch by epoch.
  useEffect(() => {
    if (!active || !busy) return
    const timer = setInterval(refresh, 500)
    return () => clearInterval(timer)
  }, [active, busy, refresh])

  async function act(path, body) {
    setError('')
    try {
      setState(await call(path, { method: 'POST', ...(body && {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }))
    } catch (failure) { setError(failure.message) }
  }

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }))
  const h = state?.history ?? {}
  const finished = ['done', 'stopped'].includes(state?.status) && state.scores
  const latest = h.epoch?.length ? h.epoch.length - 1 : null

  return (
    <>
      <div className="overview-introduction">
        <p>Retrain the network with different settings. Data, split, loss, optimizer, and early stopping (patience
          15 epochs) are the same as for the saved model. Test scores are shown after training ends.</p>
      </div>

      <div className="train-layout">
        <section className="chart-panel model-card train-settings" aria-label="Training settings">
          <h2>Settings</h2>
          {Object.entries(CHOICES).map(([key, options]) => (
            <label key={key}>
              {LABELS[key]}
              <select value={settings[key]} disabled={busy || (key === 'units' && settings.hidden_layers === 0)}
                onChange={(event) => update(key, typeof DEFAULTS[key] === 'number' ? Number(event.target.value) : event.target.value)}>
                {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          ))}
          <label>
            Maximum epochs
            <input type="number" min={1} max={200} value={settings.epochs} disabled={busy}
              onChange={(event) => update('epochs', Number(event.target.value))} />
          </label>
          <div className="annotation-actions">
            {busy ? <button onClick={() => act('/api/train/stop')}>Stop</button>
              : <button className="primary-button" onClick={() => act('/api/train', settings)}>Train</button>}
            <button onClick={() => setSettings(DEFAULTS)} disabled={busy}>Reset settings</button>
          </div>
          {error && <p className="train-error" role="alert">{error}</p>}
        </section>

        <section className="chart-panel model-card train-monitor" aria-label="Training monitor">
          <h2>Training monitor</h2>
          {!state || state.status === 'idle' ? <p className="train-status" role="status">No run yet.</p>
            : state.status === 'loading' ? <p className="train-status" role="status">Loading training data…</p>
            : state.status === 'error' ? <p className="train-status train-error" role="alert">Training failed: {state.error}</p>
            : (
              <div className="train-stats" role="status">
                <div><span>Status</span><strong>{state.status === 'running' ? 'Training…' : state.status === 'stopped' ? 'Stopped' : 'Finished'}</strong></div>
                <div><span>Epoch</span><strong>{state.epoch} / {state.settings.epochs}</strong></div>
                <div><span>Val accuracy</span><strong>{latest !== null ? pct(h.val_acc[latest]) : '–'}</strong></div>
                <div><span>Val macro-F1</span><strong>{latest !== null ? h.val_f1[latest].toFixed(3) : '–'}</strong></div>
                <div className="train-stats-run"><span>Settings</span><strong>{describe(state.settings)}</strong></div>
              </div>
            )}
          <div className="model-plots">
            <LiveChart title="Loss" epochs={h.epoch} best={state?.best_epoch} yTitle="Weighted cross-entropy"
              series={[['Training loss', h.train_loss, TRAIN_COLOR], ['Validation loss', h.val_loss, VAL_COLOR]]} />
            <LiveChart title="Accuracy and macro-F1" epochs={h.epoch} best={state?.best_epoch} yTitle="Score" range={[0, 1]}
              series={[['Training accuracy', h.train_acc, TRAIN_COLOR], ['Validation accuracy', h.val_acc, VAL_COLOR],
                ['Validation macro-F1', h.val_f1, '#FF9500']]} />
          </div>
        </section>
      </div>

      {finished && (
        <section className="chart-panel model-card" aria-label="Results of this run">
          <h2>Results</h2>
          <p className="model-note">
            Epoch kept: {state.best_epoch} of {state.epochs_run} (best validation macro-F1)
            {state.epochs_run < state.settings.epochs && state.status === 'done' ? '; stopped early' : ''}.
          </p>
          <div className="table-scroll">
            <table className="metrics-table">
              <thead><tr><th>Model</th><th>Parameters</th><th>Train acc.</th><th>Val acc.</th>
                <th>Test acc.</th><th>Test macro-F1</th></tr></thead>
              <tbody>
                {saved && <ScoreRow name="Saved model (2 × 64, ReLU)" parameters={saved.config.parameters} scores={saved.scores} />}
                <ScoreRow name={`New model (${describe(state.settings)})`} parameters={state.parameters} scores={state.scores} />
              </tbody>
            </table>
          </div>
          <h3 className="train-subheading">Test confusion matrix (new model)</h3>
          <ConfusionMatrix confusion={state.scores.test.confusion} classes={['Walking', 'Descending stairs', 'Ascending stairs', 'Driving']} />
        </section>
      )}

      <section className="chart-panel model-card" aria-label="Model used by Run model">
        <h2>Model used by Run model</h2>
        <p className="model-note">
          {state?.active_model === 'experiment'
            ? <>New model ({describe(state.active_settings)})</>
            : <>Saved model (2 × 64, ReLU)</>}
        </p>
        <div className="annotation-actions">
          <button className="primary-button" disabled={!finished || busy} onClick={() => act('/api/train/use')}>
            Use new model</button>
          <button disabled={state?.active_model !== 'experiment'} onClick={() => act('/api/train/reset')}>
            Use saved model</button>
        </div>
      </section>
    </>
  )
}

function ScoreRow({ name, parameters, scores }) {
  return (
    <tr><td>{name}</td><td>{parameters.toLocaleString()}</td><td>{pct(scores.train.accuracy)}</td>
      <td>{pct(scores.val.accuracy)}</td><td><strong>{pct(scores.test.accuracy)}</strong></td>
      <td>{scores.test.macro_f1.toFixed(3)}</td></tr>
  )
}

function LiveChart({ title, epochs = [], series, best, yTitle, range }) {
  return (
    <Plot
      data={series.map(([name, values = [], color]) => ({
        x: epochs, y: values, name, mode: 'lines', line: { color, width: 1.5 } }))}
      layout={{
        ...PLOT_LAYOUT,
        title: { text: title, font: { size: 13, color: '#1D1D1F' } },
        // Keep the axes steady between polls instead of re-animating.
        uirevision: 'live', datarevision: epochs.length,
        xaxis: { title: { text: 'Epoch' }, gridcolor: '#F0F0F2', zeroline: false, rangemode: 'tozero' },
        yaxis: { title: { text: yTitle }, gridcolor: '#F0F0F2', zeroline: false,
          ...(range ? { range } : { rangemode: 'tozero' }) },
        shapes: best ? [{ type: 'line', x0: best, x1: best, yref: 'paper', y0: 0, y1: 1,
          line: { dash: 'dash', color: '#8E8E93', width: 1 } }] : [],
        legend: { orientation: 'h', y: -0.3 }, margin: { l: 60, r: 16, t: 40, b: 70 },
      }}
      useResizeHandler className="model-plot" config={{ displaylogo: false, responsive: true }}
    />
  )
}
