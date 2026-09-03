import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')

describe('route place association schema and migration', () => {
  it('defines only Place ID and AERoute-owned association metadata', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
    const model = schema.match(/model TrRoutePlace \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(schema).toContain('enum RoutePlaceKind')
    expect(model).toMatch(/routeResultId\s+String\s+@db\.Uuid/)
    expect(model).toMatch(/placeId\s+String/)
    expect(model).toMatch(/role\s+String\?\s+@db\.VarChar\(16\)/)
    expect(model).toContain('@@unique([routeResultId, kind, ordinal])')
    expect(model).toContain('@@index([routeResultId, kind])')
    expect(model).toContain('@@index([placeIdRefreshedAt])')
    expect(model).not.toMatch(/name|address|latitude|longitude|types|facilit|accessibility|googleMapsUri|photo|attribution/i)
  })

  it('adds one forward-only migration without changing prior migrations', () => {
    const migration = readFileSync(join(root, 'prisma/migrations/20260902000100_add_route_place_associations/migration.sql'), 'utf8')
    expect(migration).toContain('CREATE TYPE "RoutePlaceKind" AS ENUM (\'REST_STOP\', \'TRANSIT_STOP\')')
    expect(migration).toContain('CREATE TABLE "TrRoutePlace"')
    expect(migration).toContain('ON DELETE CASCADE')
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TYPE/i)
  })
})
