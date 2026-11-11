import { useEffect, useState } from 'react'
import Plot from 'react-plotly.js'

import ArchitectureDiagram from './ArchitectureDiagram'
import { pct, PLOT_LAYOUT, TRAIN_COLOR, VAL_COLOR } from './chartStyle'

// Training report written by training/train.py and served by GET /api/model.
export default function ModelPanel({ active, onOpenParticipant }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [section, setSection] = useState('results')

  useEffect(() => {
    if (!active || report) return
    const controller = new AbortController()
    fetch('/api/model', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.detail ?? 'Model service unavailable. Start the backend and retry.')
        setReport(body); setError('')
      })
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message) })
    return () => controller.abort()
  }, [active, report, retry])

  if (error) return (
    <div className="viewer-message" role="alert"><p>{error}</p>
      <button onClick={() => { setError(''); setRetry((v) => v + 1) }}>Retry</button></div>
  )
  if (!report) return <div className="skeleton skeleton-card" role="status" aria-label="Loading model report" />

  const { mlp, baseline, classes, split, n_windows: n, per_person: people } = report
  const cfg = mlp.config
  const models = [
    ['MLP', `${cfg.n_inputs.toLocaleString()} → ${cfg.hidden.join(' → ')} → ${cfg.n_classes}`, mlp],
    ['Logistic regression (baseline)', `${baseline.config.n_inputs.toLocaleString()} → ${baseline.config.n_classes}`, baseline],
  ]
  return (
    <>
      <div className="view-toggle model-sections" role="group" aria-label="Model sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {section === 'results' && <>
        <section className="chart-panel model-card" aria-label="Results">
          <h2>Results</h2>
          <div className="table-scroll">
            <table className="metrics-table">
              <thead><tr><th>Model</th><th>Train acc.</th><th>Val acc.</th>
                <th>Test acc.</th><th>Test error</th><th>Test macro-F1</th></tr></thead>
              <tbody>{models.map(([name, , m]) => (
                <tr key={name}><td>{name}</td><td>{pct(m.scores.train.accuracy)}</td>
                  <td>{pct(m.scores.val.accuracy)}</td><td>{pct(m.scores.test.accuracy)}</td>
                  <td><strong>{pct(1 - m.scores.test.accuracy)}</strong></td><td>{m.scores.test.macro_f1.toFixed(3)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="model-note">Test set: {split.test.length} participants not used in training ({n.test.toLocaleString()} windows).
            Macro-F1 is the mean F1 score across the four activities.</p>
        </section>

        <section className="chart-panel model-card" aria-label="Test confusion matrix">
          <h2>Test confusion matrix (MLP)</h2>
          <ConfusionMatrix confusion={mlp.scores.test.confusion} classes={classes} />
          <p className="model-note">Rows: true activity. Columns: predicted activity. Percentages are per row.</p>
        </section>

        <section className="chart-panel model-card" aria-label="Test participants">
          <h2>Test participants</h2>
          <div className="table-scroll">
            <table className="metrics-table">
              <thead><tr><th>Participant</th><th>Windows</th><th>Agreement</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td><button className="link-button" onClick={() => onOpenParticipant(p.id)}
                      aria-label={`Open ${p.id} in the Data Viewer`}>{p.id}</button></td>
                    <td>{p.scored_windows.toLocaleString()}</td><td>{pct(p.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="model-note">Non-overlapping windows, as in the Data Viewer.</p>
        </section>
      </>}

      {section === 'architecture' && (
        <section className="chart-panel model-card" aria-label="Architecture">
          <h2>Architecture</h2>
          <ArchitectureDiagram inputs={cfg.n_inputs} hidden={cfg.hidden} dropout={cfg.dropout} />
          <dl className="spec-list">
            <div><dt>Task</dt><dd>Classify 4-second windows as walking, descending stairs, ascending stairs, or driving.</dd></div>
            <div><dt>Input</dt><dd>Raw left-wrist signal, 400 samples × 3 axes (1,200 values), standardized per axis using training data.</dd></div>
            <div><dt>Training</dt><dd>Adam, learning rate {cfg.lr}, batch size {cfg.batch}; cross-entropy weighted by inverse class frequency.</dd></div>
            <div><dt>Early stopping</dt><dd>Best validation macro-F1 (epoch {cfg.best_epoch}).</dd></div>
            <div><dt>Baseline</dt><dd>Logistic regression ({models[1][1]}), same training.</dd></div>
            <div><dt>Split</dt><dd>By participant: {split.train.length} / {split.val.length} / {split.test.length} (train / validation / test), {n.train.toLocaleString()} / {n.val.toLocaleString()} / {n.test.toLocaleString()} windows.</dd></div>
          </dl>
        </section>
      )}

      {section === 'training' && (
        <section className="chart-panel model-card" aria-label="Loss versus epoch">
          <h2>Loss vs. epoch</h2>
          <div className="model-plots">
            {models.map(([name, layers, m]) => <LossCurve key={name} title={`${name} (${layers})`}
              history={m.history} bestEpoch={m.config.best_epoch} />)}
          </div>
          <p className="model-note">Dashed line: epoch kept.</p>
        </section>
      )}

      {section === 'hw3' && <Hw3Experiment />}
    </>
  )
}

const SECTIONS = [['results', 'Results'], ['architecture', 'Architecture'], ['training', 'Training'], ['hw3', 'HW3 experiment']]
const HW3_MODELS = ['HW2 model', 'Shift only', 'Shift + penalty']

// HW3: the HW2 network trained three ways, three seeds each (training/hw3_experiment.py).
function Hw3Experiment() {
  const [runs, setRuns] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/hw3')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.detail ?? 'HW3 results unavailable. Start the backend and retry.')
        setRuns(body)
      })
      .catch((failure) => setError(failure.message))
  }, [])
  if (error) return <div className="viewer-message" role="alert"><p>{error}</p></div>
  if (!runs) return <div className="skeleton skeleton-card" role="status" aria-label="Loading HW3 results" />

  // Mean and standard deviation over the three seeds.
  const stat = (name, value) => {
    const values = runs.filter((r) => r.model === name).map(value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    return { mean, sd }
  }
  const fmt = ({ mean, sd }, percent = true) => percent
    ? `${(mean * 100).toFixed(1)} ± ${(sd * 100).toFixed(1)}%` : `${mean.toFixed(2)} ± ${sd.toFixed(2)}`
  const keptValLoss = (r) => r.history.val_loss[r.best_epoch - 1]
  const flips = HW3_MODELS.map((name) => stat(name, (r) => r.flip_rate))

  return (
    <>
      <section className="chart-panel model-card" aria-label="HW3 setup">
        <h2>HW3 experiment</h2>
        <dl className="spec-list">
          <div><dt>Question</dt><dd>Does penalizing the network for changing its prediction when a window is shifted in time reduce overfitting?</dd></div>
          <div><dt>Shift</dt><dd>Each training window is rotated in time by a random amount (0 to 4 s); the end wraps around to the start.</dd></div>
          <div><dt>Models</dt><dd>HW2 model; Shift only (also trained on the shifted copy); Shift + penalty (adds the squared difference between the two predicted probability lists, weight 1.0).</dd></div>
          <div><dt>Controls</dt><dd>Same network, data split, optimizer and early stopping as HW2. Each model trained 3 times (seeds 7400–7402).</dd></div>
          <div><dt>Changed after shift</dt><dd>How often the predicted activity of a test window changes when the window is shifted (5 random shifts per window).</dd></div>
        </dl>
      </section>

      <section className="chart-panel model-card" aria-label="HW3 results">
        <h2>Results (mean ± SD over 3 runs)</h2>
        <div className="table-scroll">
          <table className="metrics-table">
            <thead><tr><th>Model</th><th>Test acc.</th><th>Test macro-F1</th><th>Train − val gap</th>
              <th>Changed after shift</th><th>Val loss at kept epoch</th></tr></thead>
            <tbody>{HW3_MODELS.map((name) => (
              <tr key={name}><td>{name}</td>
                <td>{fmt(stat(name, (r) => r.test_acc))}</td>
                <td>{fmt(stat(name, (r) => r.test_macro_f1), false)}</td>
                <td>{fmt(stat(name, (r) => r.train_acc - r.val_acc))}</td>
                <td><strong>{fmt(stat(name, (r) => r.flip_rate))}</strong></td>
                <td>{fmt(stat(name, keptValLoss), false)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <Plot
          data={[{
            type: 'bar', x: HW3_MODELS, y: flips.map((f) => f.mean * 100),
            error_y: { type: 'data', array: flips.map((f) => f.sd * 100), color: '#8E8E93', thickness: 1.2, width: 6 },
            marker: { color: ['#8E8E93', '#A7BED6', '#4477AA'] }, hovertemplate: '%{x}: %{y:.1f}%<extra></extra>',
          }]}
          layout={{
            ...PLOT_LAYOUT,
            title: { text: 'Test windows whose prediction changed after a shift', font: { size: 13, color: '#1D1D1F' } },
            yaxis: { title: { text: 'Predictions that change (%)' }, gridcolor: '#F0F0F2', zeroline: false, rangemode: 'tozero' },
            margin: { l: 60, r: 16, t: 40, b: 50 }, bargap: 0.5,
          }}
          useResizeHandler className="model-plot hw3-bars" config={{ displaylogo: false, responsive: true }}
        />
      </section>

      <section className="chart-panel model-card" aria-label="HW3 loss curves">
        <h2>Loss vs. epoch (seed 7400)</h2>
        <div className="model-plots hw3-curves">
          {HW3_MODELS.map((name) => {
            const run = runs.find((r) => r.model === name && r.seed === 7400)
            return <LossCurve key={name} title={name} history={run.history} bestEpoch={run.best_epoch} />
          })}
        </div>
        <p className="model-note">Dashed line: epoch kept. Losses are measured on unshifted windows for all three models.</p>
      </section>
    </>
  )
}

function LossCurve({ title, history, bestEpoch }) {
  return (
    <Plot
      data={[
        { x: history.epoch, y: history.train_loss, name: 'Training loss', mode: 'lines', line: { color: TRAIN_COLOR, width: 1.5 } },
        { x: history.epoch, y: history.val_loss, name: 'Validation loss', mode: 'lines', line: { color: VAL_COLOR, width: 1.5 } },
      ]}
      layout={{
        ...PLOT_LAYOUT,
        title: { text: title, font: { size: 13, color: '#1D1D1F' } },
        xaxis: { title: { text: 'Epoch' }, gridcolor: '#F0F0F2', zeroline: false },
        yaxis: { title: { text: 'Weighted cross-entropy' }, gridcolor: '#F0F0F2', zeroline: false, rangemode: 'tozero' },
        shapes: [{ type: 'line', x0: bestEpoch, x1: bestEpoch, yref: 'paper', y0: 0, y1: 1,
          line: { dash: 'dash', color: '#8E8E93', width: 1 } }],
        legend: { orientation: 'h', y: -0.28 }, margin: { l: 60, r: 16, t: 40, b: 70 },
      }}
      useResizeHandler className="model-plot" config={{ displaylogo: false, responsive: true }}
    />
  )
}

// Rows = true activity, columns = predicted; colored by row percentage.
export function ConfusionMatrix({ confusion, classes }) {
  const normalized = confusion.map((row) => {
    const total = row.reduce((a, b) => a + b, 0) || 1
    return row.map((v) => v / total)
  })
  return (
    <Plot
      data={[{
        type: 'heatmap', z: normalized, x: classes, y: classes, zmin: 0, zmax: 1, showscale: false,
        colorscale: [[0, '#F5F5F7'], [1, '#4477AA']],
        text: confusion.map((row, i) => row.map((v, j) => `${v.toLocaleString()}<br>${pct(normalized[i][j])}`)),
        texttemplate: '%{text}', hovertemplate: 'True: %{y}<br>Predicted: %{x}<br>%{text}<extra></extra>',
      }]}
      layout={{
        ...PLOT_LAYOUT,
        xaxis: { title: { text: 'Predicted' }, side: 'bottom' },
        yaxis: { title: { text: 'True' }, autorange: 'reversed', automargin: true },
        margin: { l: 130, r: 20, t: 10, b: 70 },
      }}
      useResizeHandler className="model-plot confusion-plot" config={{ displaylogo: false, responsive: true }}
    />
  )
}
