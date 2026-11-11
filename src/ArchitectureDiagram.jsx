// Diagram of the MLP: input window -> two hidden layers -> four activity scores.
// A few nodes per layer stand in for the full layer; the dots mark the ones not drawn.
const OUTPUTS = [
  ['Walking', '#4477AA'], ['Descending stairs', '#E69F00'], ['Ascending stairs', '#882255'], ['Driving', '#332288'],
]
const SHOWN = 5                       // nodes drawn per input/hidden layer
const COLUMNS = [80, 280, 480, 660]   // x position of each layer
const TOP = 34, GAP = 30              // y of the first node, spacing between nodes

const nodeY = (count, i) => TOP + i * GAP + ((SHOWN - count) * GAP) / 2

export default function ArchitectureDiagram({ inputs, hidden, dropout }) {
  const layers = [
    { title: 'Input', lines: [`${inputs.toLocaleString()} values`, '400 samples × 3 axes'], count: SHOWN },
    ...hidden.map((units, i) => ({
      title: `Hidden layer ${i + 1}`,
      lines: [`${units} units, ReLU`, `dropout ${dropout}`],
      weights: (i === 0 ? inputs : hidden[i - 1]) * units + units,
      count: SHOWN,
    })),
    { title: 'Output', lines: ['4 scores → softmax'], weights: hidden.at(-1) * 4 + 4, count: 4 },
  ]
  const nodes = layers.map((layer, l) => Array.from({ length: layer.count }, (_, i) => [COLUMNS[l], nodeY(layer.count, i)]))

  return (
    <svg className="architecture" viewBox="0 0 860 280" role="img"
      aria-label={`Network diagram: ${inputs} inputs, hidden layers of ${hidden.join(' and ')} units, 4 outputs`}>
      {/* Connections between neighboring layers (every drawn node to every drawn node). */}
      <g className="arch-links">
        {nodes.slice(0, -1).flatMap((from, l) => from.flatMap(([x1, y1]) =>
          nodes[l + 1].map(([x2, y2]) => <line key={`${l}-${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />)))}
      </g>
      {/* Nodes; output nodes use the activity colors. */}
      {nodes.map((layer, l) => layer.map(([x, y], i) => (
        <circle key={`${l}-${i}`} cx={x} cy={y} r={l === nodes.length - 1 ? 8 : 7}
          className={l === nodes.length - 1 ? 'arch-node arch-output' : 'arch-node'}
          style={l === nodes.length - 1 ? { fill: OUTPUTS[i][1] } : undefined} />
      )))}
      {/* "More units not shown" marks under the input and hidden layers. */}
      {layers.slice(0, -1).map((_, l) => (
        <text key={l} x={COLUMNS[l]} y={nodeY(SHOWN, SHOWN - 1) + 26} className="arch-more">⋮</text>
      ))}
      {OUTPUTS.map(([label], i) => (
        <text key={label} x={COLUMNS[3] + 18} y={nodeY(4, i) + 4} className="arch-class">{label}</text>
      ))}
      {/* Layer captions. */}
      {layers.map((layer, l) => (
        <g key={layer.title} className="arch-caption">
          <text x={COLUMNS[l]} y={226} className="arch-title">{layer.title}</text>
          {layer.lines.map((line, i) => <text key={line} x={COLUMNS[l]} y={246 + i * 16}>{line}</text>)}
          {layer.weights && <text x={(COLUMNS[l - 1] + COLUMNS[l]) / 2} y={18} className="arch-weights">
            {layer.weights.toLocaleString()} weights</text>}
        </g>
      ))}
    </svg>
  )
}
