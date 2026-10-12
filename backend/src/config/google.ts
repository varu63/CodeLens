import { OAuth2Client } from 'google-auth-library'
import { env } from './env.js'

export const googleEnabled =
  env.GOOGLE_CLIENT_ID.length > 0 && env.GOOGLE_CLIENT_SECRET.length > 0

export const googleClient = new OAuth2Client({
  clientId: env.GOOGLE_CLIENT_ID || 'unconfigured',
  clientSecret: env.GOOGLE_CLIENT_SECRET || 'unconfigured',
  redirectUri: env.GOOGLE_CALLBACK_URL,
})

export interface GoogleProfile {
  googleId: string
  email: string
  name: string
  avatarUrl?: string
}

export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const { tokens } = await googleClient.getToken(code)
  if (!tokens.id_token) throw new Error('Google did not return an id_token')

  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Google profile is missing required fields')
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? 'ProofLoop user',
    avatarUrl: payload.picture,
  }
}
