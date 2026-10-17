import { useEffect, useState } from 'react'
import Plot from 'react-plotly.js'

import { pct, PLOT_LAYOUT, TRAIN_COLOR, VAL_COLOR } from './chartStyle'

// Training report written by training/train.py and served by GET /api/model.
export default function ModelPanel({ active, onOpenParticipant }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

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
  if (!report) return <p className="viewer-message" role="status">Loading model report…</p>

  const { mlp, baseline, classes, split, n_windows: n, per_person: people } = report
  const cfg = mlp.config
  const models = [
    ['MLP', `${cfg.n_inputs.toLocaleString()} → ${cfg.hidden.join(' → ')} → ${cfg.n_classes}`, mlp],
    ['Logistic regression (baseline)', `${baseline.config.n_inputs.toLocaleString()} → ${baseline.config.n_classes}`, baseline],
  ]
  return (
    <>
      <section className="chart-panel model-card" aria-label="Results">
        <h2>Results</h2>
        <div className="table-scroll">
          <table className="metrics-table">
            <thead><tr><th>Model</th><th>Layers</th><th>Train acc.</th><th>Val acc.</th>
              <th>Test acc.</th><th>Test error</th><th>Test macro-F1</th></tr></thead>
            <tbody>{models.map(([name, layers, m]) => (
              <tr key={name}><td>{name}</td><td>{layers}</td><td>{pct(m.scores.train.accuracy)}</td>
                <td>{pct(m.scores.val.accuracy)}</td><td>{pct(m.scores.test.accuracy)}</td>
                <td><strong>{pct(1 - m.scores.test.accuracy)}</strong></td><td>{m.scores.test.macro_f1.toFixed(3)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="model-note">Test set: {split.test.length} participants not used in training ({n.test.toLocaleString()} windows).
          Macro-F1 is the mean F1 score across the four activities.</p>
      </section>

      <section className="chart-panel model-card" aria-label="Model details">
        <h2>Model details</h2>
        <dl className="spec-list">
          <div><dt>Task</dt><dd>Classify 4-second windows as walking, descending stairs, ascending stairs, or driving.</dd></div>
          <div><dt>Input</dt><dd>Raw left-wrist signal, 400 samples × 3 axes (1,200 values), standardized per axis using training data.</dd></div>
          <div><dt>Network</dt><dd>{models[0][1]}, ReLU, dropout {cfg.dropout}; {cfg.parameters.toLocaleString()} parameters.</dd></div>
          <div><dt>Training</dt><dd>Adam, learning rate {cfg.lr}, batch size {cfg.batch}; cross-entropy weighted by inverse class frequency.</dd></div>
          <div><dt>Early stopping</dt><dd>Best validation macro-F1 (epoch {cfg.best_epoch}).</dd></div>
          <div><dt>Baseline</dt><dd>Logistic regression ({models[1][1]}), same training.</dd></div>
          <div><dt>Split</dt><dd>By participant: {split.train.length} / {split.val.length} / {split.test.length} (train / validation / test), {n.train.toLocaleString()} / {n.val.toLocaleString()} / {n.test.toLocaleString()} windows.</dd></div>
        </dl>
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

      <section className="chart-panel model-card" aria-label="Loss versus epoch">
        <h2>Loss vs. epoch</h2>
        <div className="model-plots">
          {models.map(([name, layers, m]) => <LossCurve key={name} title={`${name} (${layers})`} model={m} />)}
        </div>
        <p className="model-note">Dashed line: epoch kept.</p>
      </section>

      <section className="chart-panel model-card" aria-label="Test confusion matrix">
        <h2>Test confusion matrix (MLP)</h2>
        <ConfusionMatrix confusion={mlp.scores.test.confusion} classes={classes} />
        <p className="model-note">Rows: true activity. Columns: predicted activity. Percentages are per row.</p>
      </section>
    </>
  )
}

function LossCurve({ title, model }) {
  const { history, config } = model
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
        shapes: [{ type: 'line', x0: config.best_epoch, x1: config.best_epoch, yref: 'paper', y0: 0, y1: 1,
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
        colorscale: [[0, '#F5F5F7'], [1, '#007AFF']],
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
