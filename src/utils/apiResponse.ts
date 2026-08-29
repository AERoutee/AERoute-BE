export function apiResponse<T>(data: T, stats?: Record<string, number>) {
  return stats ? { data, stats } : { data }
}
