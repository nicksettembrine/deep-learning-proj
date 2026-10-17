// Shared formatting and Plotly styling for the Model and Train tabs.
export const pct = (value) => `${(value * 100).toFixed(1)}%`
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'
export const TRAIN_COLOR = '#1D1D1F'   // graphite
export const VAL_COLOR = '#007AFF'     // blue
export const PLOT_LAYOUT = {
  autosize: true, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
  font: { family: FONT, size: 12, color: '#6E6E73' },
}
