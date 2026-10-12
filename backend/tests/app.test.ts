import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API_PREFIX, createApp } from '../src/app.js'

const app = createApp()

/**
 * App-level wiring tests. These never touch Postgres/Redis: they exercise the
 * middleware stack, the error envelope and the route guards only.
 */
describe('app wiring', () => {
  it('answers unknown routes with the { error: { code, message } } envelope', async () => {
    const res = await request(app).get(`${API_PREFIX}/definitely-not-a-route`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  })

  it('rejects unauthenticated access to every protected router', async () => {
    const paths = ['/projects', '/findings', '/runs/00000000-0000-4000-8000-000000000001', '/projects/00000000-0000-4000-8000-000000000001/commits']
    for (const path of paths) {
      const res = await request(app).get(`${API_PREFIX}${path}`)
      expect(res.status, path).toBe(401)
      expect(res.body.error.code).toBeDefined()
      expect(typeof res.body.error.message).toBe('string')
    }
  })

  it('rejects malformed bearer tokens with 401', async () => {
    const res = await request(app).get(`${API_PREFIX}/projects`).set('Authorization', 'Bearer not-a-jwt')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBeDefined()
  })

  it('validates request bodies before any database work (register)', async () => {
    const res = await request(app).post(`${API_PREFIX}/auth/register`).send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(Array.isArray(res.body.error.details)).toBe(true)
  })

  it('applies helmet security headers', async () => {
    const res = await request(app).get(`${API_PREFIX}/definitely-not-a-route`)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options'] ?? res.headers['content-security-policy']).toBeDefined()
  })

  it('answers CORS preflight for the configured frontend origin', async () => {
    const res = await request(app).options(`${API_PREFIX}/health`).set('Origin', 'http://localhost:5173')
    expect([200, 204]).toContain(res.status)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})
