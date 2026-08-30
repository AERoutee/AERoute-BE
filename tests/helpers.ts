import type { NextFunction, Request, Response } from 'express'

export function request(overrides: Partial<Request> = {}) {
  return { body: {}, headers: {}, params: {}, query: {}, path: '/', ...overrides } as Request
}

export function response(locals: Record<string, unknown> = {}) {
  const value = {
    locals,
    status: jest.fn(),
    json: jest.fn(),
    set: jest.fn(),
    send: jest.fn(),
  } as unknown as Response
  jest.mocked(value.status).mockReturnValue(value)
  jest.mocked(value.json).mockReturnValue(value)
  jest.mocked(value.set).mockReturnValue(value)
  jest.mocked(value.send).mockReturnValue(value)
  return value
}

export function next() {
  return jest.fn() as jest.MockedFunction<NextFunction>
}

export function file(buffer = Buffer.from('image'), mimetype = 'image/jpeg') {
  return { buffer, mimetype, fieldname: 'images', originalname: 'image.jpg', encoding: '7bit', size: buffer.length, destination: '', filename: '', path: '', stream: undefined } as unknown as Express.Multer.File
}
