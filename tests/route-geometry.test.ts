import { boundsForPoints, decodePolyline, encodePolyline, pointToPolylineDistanceMeters, samplePolyline } from '../src/utils/route-geometry'

describe('route geometry', () => {
  it('decodes the canonical encoded polyline fixture', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ])
  })

  it('encodes the canonical polyline and round-trips signed coordinates', () => {
    const points = [
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodePolyline(encodePolyline([{ latitude: -6.2, longitude: 106.8 }, { latitude: -6.21, longitude: 106.81 }]))).toEqual([{ latitude: -6.2, longitude: 106.8 }, { latitude: -6.21, longitude: 106.81 }])
  })

  it.each(['?', 'abc', String.fromCharCode(200), '_p~iF~ps|U_'])('rejects malformed or truncated geometry', (encoded) => {
    expect(() => decodePolyline(encoded)).toThrow(RangeError)
  })

  it('samples by cumulative distance rather than vertex index', () => {
    const result = samplePolyline([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
      { latitude: 0, longitude: 0.01 },
    ], 3)
    expect(result[1].longitude).toBeCloseTo(0.005, 5)
  })

  it('handles duplicate and all-identical points', () => {
    const point = { latitude: -6.2, longitude: 106.8 }
    expect(samplePolyline([point, point, { latitude: -6.2, longitude: 106.81 }], 3)).toHaveLength(3)
    expect(samplePolyline([point, point], 5)).toEqual([point])
  })

  it('finds the nearest segment rather than only vertices', () => {
    const distance = pointToPolylineDistanceMeters(
      { latitude: 0.0005, longitude: 0.005 },
      [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }],
    )
    expect(distance).toBeGreaterThan(55)
    expect(distance).toBeLessThan(56)
  })

  it('samples and measures antimeridian-crossing geometry on the short arc', () => {
    const line = [{ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }]
    expect(Math.abs(samplePolyline(line, 3)[1].longitude)).toBe(180)
    expect(pointToPolylineDistanceMeters({ latitude: 0.001, longitude: 180 }, line)).toBeLessThan(112)
    expect(boundsForPoints(line)).toMatchObject({ north: 0, south: 0, east: expect.closeTo(-179.9), west: expect.closeTo(179.9) })
  })

  it('returns point and empty-polyline distances and bounds', () => {
    expect(pointToPolylineDistanceMeters({ latitude: 0, longitude: 0.001 }, [{ latitude: 0, longitude: 0 }])).toBeCloseTo(111.2, 0)
    expect(pointToPolylineDistanceMeters({ latitude: 0, longitude: 0 }, [])).toBe(Number.POSITIVE_INFINITY)
    expect(boundsForPoints([{ latitude: -1, longitude: 3 }, { latitude: 2, longitude: -4 }])).toEqual({ north: 2, south: -1, east: 3, west: -4 })
    expect(boundsForPoints([])).toBeNull()
  })
})
