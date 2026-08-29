export function normalizeTileCoordinates(zoom: number, x: number, y: number) {
  const gridSize = 2 ** zoom
  return { x: ((x % gridSize) + gridSize) % gridSize, y, isValidY: y >= 0 && y < gridSize }
}
