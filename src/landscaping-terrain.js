// Analytic demo terrain: capture the mode, never a live DOM value.
// Sharing the formula avoids approximation by a sampled height grid.
export function createTerrainHeight(mode = 'flat') {
  if (mode === 'slope') return (x, z) => x * .055 + z * .018;
  if (mode === 'cross') return (x, z) => x * .018 + z * .19;
  if (mode === 'waves') return (x, z) => Math.sin(x * .52) * .12 + Math.cos(z * .63) * .08 + Math.sin((x + z) * .27) * .05;
  return () => 0;
}
