import { z } from 'zod'

// .env is optional — in test/CI the real environment may already hold values.
try {
  process.loadEnvFile()
} catch {
  // no .env file present
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:5000/api/v1/auth/google/callback'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('storage'),
  S3_ENDPOINT: z.string().default('http://localhost:9090'),
  S3_BUCKET: z.string().default('proofloop'),
  S3_ACCESS_KEY: z.string().default('proofloop'),
  S3_SECRET_KEY: z.string().default('proofloop-secret'),
  ML_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  ML_SERVICE_URL: z.string().default('http://localhost:8000'),
  ML_SERVICE_KEY: z.string().default(''),
  SANDBOX_CPU_LIMIT: z.coerce.number().positive().default(1.5),
  SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(1024),
  SANDBOX_TIMEOUT_SEC: z.coerce.number().int().positive().default(300),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`)
  process.exit(1)
}

export const env = parsed.data

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
