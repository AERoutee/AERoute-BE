jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (headers: Record<string, string | string[] | undefined>) => {
    const result = new Headers()
    Object.entries(headers ?? {}).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => result.append(key, item))
      else if (value !== undefined) result.set(key, value)
    })
    return result
  },
  toNodeHandler: jest.fn(),
}))
