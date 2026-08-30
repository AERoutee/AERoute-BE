jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../src/config/index.js', () => ({ env: { BETTER_AUTH_URL: 'https://api.example.com' } }))
jest.mock('../src/modules/profile/providers/avatar-storage.provider.js', () => ({
  putAvatar: jest.fn(),
  getAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
}))

import sharp from 'sharp'
import { ProfileController } from '../src/modules/profile/profile.controller'
import type { ProfileRepository } from '../src/modules/profile/profile.repository'
import { ProfileService } from '../src/modules/profile/profile.service'
import { deleteAvatar, getAvatar, putAvatar } from '../src/modules/profile/providers/avatar-storage.provider'
import { file, next, request, response } from './helpers'

const sharpMock = jest.mocked(sharp)
const putMock = jest.mocked(putAvatar)
const getMock = jest.mocked(getAvatar)
const deleteMock = jest.mocked(deleteAvatar)

function repository() {
  return {
    findAvatar: jest.fn(),
    updateAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  } as unknown as jest.Mocked<ProfileRepository>
}

function validSharp(width = 128, height = 128, output = Buffer.from('webp')) {
  sharpMock
    .mockReturnValueOnce({ metadata: jest.fn().mockResolvedValue({ width, height }) } as never)
    .mockReturnValueOnce({
      autoOrient: jest.fn().mockReturnValue({
        resize: jest.fn().mockReturnValue({
          webp: jest.fn().mockReturnValue({ toBuffer: jest.fn().mockResolvedValue(output) }),
        }),
      }),
    } as never)
}

describe('profile avatar service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    deleteMock.mockResolvedValue(undefined)
  })

  it('requires an uploaded file', async () => {
    await expect(new ProfileService(repository()).uploadAvatar('user-1')).rejects.toMatchObject({ statusCode: 400, code: 'avatar_required' })
  })

  it('rejects corrupt and undersized images before storage', async () => {
    const repo = repository()
    sharpMock.mockReturnValueOnce({ metadata: jest.fn().mockRejectedValue(new Error('corrupt')) } as never)
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).rejects.toMatchObject({ code: 'avatar_invalid' })

    validSharp(63, 128)
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).rejects.toMatchObject({ code: 'avatar_too_small' })
    expect(putMock).not.toHaveBeenCalled()
  })

  it('stores a public processed avatar, updates profile, and removes the old object', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue({ avatarKey: 'avatars/user-1/old.webp' })
    repo.updateAvatar.mockResolvedValue({ image: 'https://cdn/new.webp' })
    validSharp()
    putMock.mockResolvedValue({ url: 'https://cdn/new.webp', isPublic: true })
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).resolves.toEqual({ image: 'https://cdn/new.webp' })
    expect(repo.updateAvatar).toHaveBeenCalledWith('user-1', expect.stringMatching(/^avatars\/user-1\/.+\.webp$/u), 'https://cdn/new.webp')
    expect(deleteMock).toHaveBeenCalledWith('avatars/user-1/old.webp')
  })

  it('uses the private proxy URL when public read verification degrades', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue(null)
    repo.updateAvatar.mockResolvedValue({ image: '' })
    validSharp()
    putMock.mockResolvedValue({ url: 'https://cdn/new.webp', isPublic: false })
    const result = await new ProfileService(repo).uploadAvatar('user id', file())
    expect(result.image).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/profile\/avatar\/user%20id\?v=.+/u)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('rolls back the new object and returns a stable error when profile update fails', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue(null)
    repo.updateAvatar.mockRejectedValue(new Error('db'))
    validSharp()
    putMock.mockResolvedValue({ url: 'https://cdn/new.webp', isPublic: true })
    deleteMock.mockRejectedValue(new Error('cleanup unavailable'))
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).rejects.toMatchObject({ statusCode: 500, code: 'avatar_profile_update_failed', retryable: true })
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^avatars\/user-1\//u))
  })

  it('propagates storage upload and image processing failures', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue(null)
    validSharp()
    putMock.mockRejectedValue(new Error('s3'))
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).rejects.toThrow('s3')

    sharpMock.mockReturnValueOnce({ metadata: jest.fn().mockResolvedValue({ width: 128, height: 128 }) } as never)
      .mockReturnValueOnce({ autoOrient: jest.fn(() => { throw new Error('sharp output') }) } as never)
    await expect(new ProfileService(repo).uploadAvatar('user-1', file())).rejects.toThrow('sharp output')
  })

  it('removes profile state and best-effort deletes an existing object', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue({ avatarKey: 'old.webp' })
    repo.removeAvatar.mockResolvedValue({} as never)
    deleteMock.mockRejectedValue(new Error('ignored'))
    await expect(new ProfileService(repo).removeAvatar('user-1')).resolves.toEqual({ image: null })
    expect(repo.removeAvatar).toHaveBeenCalledWith('user-1')
    expect(deleteMock).toHaveBeenCalledWith('old.webp')
  })

  it('does not delete storage when no avatar exists and propagates repository removal failure', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValue(null)
    repo.removeAvatar.mockResolvedValue({} as never)
    await new ProfileService(repo).removeAvatar('user-1')
    expect(deleteMock).not.toHaveBeenCalled()

    repo.removeAvatar.mockRejectedValue(new Error('db'))
    await expect(new ProfileService(repo).removeAvatar('user-1')).rejects.toThrow('db')
  })

  it('reads an existing private avatar and rejects absent profile keys', async () => {
    const repo = repository()
    repo.findAvatar.mockResolvedValueOnce({ avatarKey: 'avatar.webp' }).mockResolvedValueOnce(null)
    getMock.mockResolvedValue(Buffer.from('body'))
    await expect(new ProfileService(repo).readAvatar('user-1')).resolves.toEqual(Buffer.from('body'))
    expect(getMock).toHaveBeenCalledWith('avatar.webp')
    await expect(new ProfileService(repo).readAvatar('user-1')).rejects.toMatchObject({ statusCode: 404, code: 'avatar_not_found' })
  })
})

describe('profile avatar endpoint controllers', () => {
  it('PUT serializes the uploaded image URL for the authenticated user', async () => {
    const avatar = file()
    const service = { uploadAvatar: jest.fn().mockResolvedValue({ image: 'https://cdn/avatar.webp' }) }
    const res = response({ userId: 'user-1' })
    await new ProfileController(service as never).uploadAvatar(request({ file: avatar }), res, next())
    expect(service.uploadAvatar).toHaveBeenCalledWith('user-1', avatar)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: { image: 'https://cdn/avatar.webp' } })
  })

  it('DELETE clears the authenticated user avatar', async () => {
    const service = { removeAvatar: jest.fn().mockResolvedValue({ image: null }) }
    const res = response({ userId: 'user-1' })
    await new ProfileController(service as never).removeAvatar(request(), res, next())
    expect(service.removeAvatar).toHaveBeenCalledWith('user-1')
    expect(res.json).toHaveBeenCalledWith({ data: { image: null } })
  })

  it('GET returns bytes with immutable and cross-origin image headers', async () => {
    const body = Buffer.from('avatar')
    const service = { readAvatar: jest.fn().mockResolvedValue(body) }
    const res = response()
    await new ProfileController(service as never).readAvatar(request({ params: { userId: 'user-1' } }), res, next())
    expect(service.readAvatar).toHaveBeenCalledWith('user-1')
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'image/webp', 'Content-Length': String(body.length), 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }))
    expect(res.send).toHaveBeenCalledWith(body)
  })
})
