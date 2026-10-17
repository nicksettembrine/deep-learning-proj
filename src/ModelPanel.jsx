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
  const pooled = people.reduce((sum, p) => ({ correct: sum.correct + p.correct, scored: sum.scored + p.scored_windows }),
    { correct: 0, scored: 0 })
  const cfg = mlp.config
  const models = [
    ['MLP', `${cfg.n_inputs.toLocaleString()} → ${cfg.hidden.join(' → ')} → ${cfg.n_classes}`, mlp],
    ['Logistic regression (baseline)', `${baseline.config.n_inputs.toLocaleString()} → ${baseline.config.n_classes}`, baseline],
  ]
  return (
    <>
      {/* The headline result first: test scores on five people the network never saw. */}
      <section className="headline" aria-label="Main result">
        <p className="headline-lead">On {split.test.length} people it never saw, the neural network makes fewer mistakes
          than the shallow baseline.</p>
        <div className="stat-tiles">
          <div className="stat-tile"><span>Test error</span>
            <strong>{pct(1 - mlp.scores.test.accuracy)}</strong>
            <small>Baseline: {pct(1 - baseline.scores.test.accuracy)}</small></div>
          <div className="stat-tile"><span>Test macro-F1</span>
            <strong>{mlp.scores.test.macro_f1.toFixed(2)}</strong>
            <small>Baseline: {baseline.scores.test.macro_f1.toFixed(2)}</small></div>
          <div className="stat-tile"><span>Test windows</span>
            <strong>{n.test.toLocaleString()}</strong>
            <small>4 seconds each, {split.test.length} people</small></div>
        </div>
      </section>

      <section className="chart-panel model-card" aria-label="How the model works">
        <h2>How the model works</h2>
        <dl className="spec-list">
          <div><dt>Task</dt><dd>Label each 4-second window as walking, descending stairs, ascending stairs, or driving.</dd></div>
          <div><dt>Input</dt><dd>The raw left-wrist window: 400 samples × 3 axes = 1,200 numbers, each axis scaled with the training set’s mean and standard deviation.</dd></div>
          <div><dt>Network</dt><dd>{models[0][1]} with ReLU and dropout {cfg.dropout} ({cfg.parameters.toLocaleString()} parameters).</dd></div>
          <div><dt>Training</dt><dd>Adam (learning rate {cfg.lr}, batches of {cfg.batch}) on class-weighted cross-entropy, so rare stair windows count as much as common driving windows.</dd></div>
          <div><dt>Weights kept</dt><dd>Epoch {cfg.best_epoch}, the one with the best validation macro-F1 (early stopping).</dd></div>
          <div><dt>Baseline</dt><dd>Logistic regression ({models[1][1]}): the same network with no hidden layers, trained the same way.</dd></div>
          <div><dt>Split</dt><dd>By person: {split.train.length} training, {split.val.length} validation, {split.test.length} test ({n.train.toLocaleString()} / {n.val.toLocaleString()} / {n.test.toLocaleString()} windows).</dd></div>
        </dl>
      </section>

      <section className="chart-panel model-card" aria-label="Model performance">
        <h2>Performance</h2>
        <div className="table-scroll">
          <table className="metrics-table">
            <thead><tr><th>Model</th><th>Layers</th><th>Train acc.</th><th>Val acc.</th>
              <th>Test acc.</th><th>Test error</th><th>Test macro-F1</th></tr></thead>
            <tbody>{models.map(([name, layers, m]) => (
              <tr key={name}><td>{name}</td><td>{layers}</td><td>{pct(m.scores.train.accuracy)}</td>
                <td>{pct(m.scores.val.accuracy)}</td><td><strong>{pct(m.scores.test.accuracy)}</strong></td>
                <td>{pct(1 - m.scores.test.accuracy)}</td><td>{m.scores.test.macro_f1.toFixed(3)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="model-note">Macro-F1 averages the F1 score of the four activities equally, so the short
          stair bouts count as much as driving.</p>
      </section>

      <section className="chart-panel model-card" aria-label="Test participants">
        <h2>Test participants</h2>
        <div className="table-scroll">
          <table className="metrics-table">
            <thead><tr><th>Participant</th><th>Labeled 4-s windows</th><th>MLP matches true label</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td><button className="link-button" onClick={() => onOpenParticipant(p.id)}
                    aria-label={`Open ${p.id} in the Data Viewer`}>{p.id}</button></td>
                  <td>{p.scored_windows.toLocaleString()}</td><td>{pct(p.accuracy)}</td>
                </tr>
              ))}
              <tr className="total-row"><td>All {people.length} combined</td><td>{pooled.scored.toLocaleString()}</td>
                <td>{pct(pooled.correct / pooled.scored)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="model-note">These are the people shown in the Data Viewer; none were used in training. Scores use
          back-to-back windows, exactly as Run model does, so the combined figure differs slightly from the test
          accuracy above, which uses 50%-overlapping windows. Click a participant to open them in the Data Viewer.</p>
      </section>

      <section className="chart-panel model-card" aria-label="Loss versus epoch">
        <h2>Loss vs. epoch</h2>
        <div className="model-plots">
          {models.map(([name, layers, m]) => <LossCurve key={name} title={`${name} (${layers})`} model={m} />)}
        </div>
        <p className="model-note">The dashed line marks the epoch whose weights are kept. MLP validation loss rises
          while its training loss keeps falling: the network fits the training participants more closely
          than new people (overfitting).</p>
      </section>

      <section className="chart-panel model-card" aria-label="Test confusion matrix">
        <h2>Test confusion matrix (MLP)</h2>
        <ConfusionMatrix confusion={mlp.scores.test.confusion} classes={classes} />
        <p className="model-note">Each row shows how the windows of one true activity were classified (row
          percentages). Driving is almost always right; walking and stairs are often confused, because arm
          swing looks similar on level ground and on stairs.</p>
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
