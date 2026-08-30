export function fromNodeHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item))
    else if (value !== undefined) result.set(name, value)
  }
  return result
}
