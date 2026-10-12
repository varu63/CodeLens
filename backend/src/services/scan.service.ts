import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import type { StructureMapData } from '../db/queries/structures.queries.js'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache',
  'vendor', '__pycache__', 'tmp', 'storage', '.turbo', '.output', 'out',
])

const MAX_FILES = 4_000
const MAX_FILE_BYTES = 1024 * 1024
const MAX_MOUNT_DEPTH = 3

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head'])

const AUTH_ADMIN_RE = /admin/i
const AUTH_USER_RE =
  /(auth|requireuser|requirelogin|protect|guard|passport|isauthenticated|verifytoken|verifyjwt|checksession|ensureauth|loggedin|currentuser|session)/i

/* ------------------------------ File walking ------------------------------- */

interface SourceFile {
  /** Relative posix path from the workspace root. */
  rel: string
  content: string
}

async function walk(root: string): Promise<{ rel: string; abs: string; size: number }[]> {
  const found: { rel: string; abs: string; size: number }[] = []
  const queue: string[] = [root]

  while (queue.length > 0 && found.length < MAX_FILES) {
    const dir = queue.shift()
    if (!dir) break
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) break
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !/\.(sql|json)$/i.test(entry.name)) {
        continue
      }
      try {
        const info = await stat(abs)
        if (info.size > MAX_FILE_BYTES) continue
        found.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, size: info.size })
      } catch {
        // unreadable file — skip
      }
    }
  }
  return found
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  if (ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS
  return ts.ScriptKind.TS
}

function isCodeFile(rel: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(rel).toLowerCase())
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/* ------------------------------- Stack scan -------------------------------- */

export interface DetectedStackData {
  language: string
  framework: string
  runtime: string
  database: string
  packageManager: string
  frontend?: string
  testFrameworks: string[]
  dependencies: string[]
}

const FRAMEWORKS: Array<[string, string]> = [
  ['@nestjs/core', 'NestJS'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['koa', 'Koa'],
  ['@hapi/hapi', 'hapi'],
  ['hono', 'Hono'],
]

const DATABASES: Array<[string, string]> = [
  ['pg', 'PostgreSQL'],
  ['postgres', 'PostgreSQL'],
  ['mysql2', 'MySQL'],
  ['mysql', 'MySQL'],
  ['mongoose', 'MongoDB'],
  ['mongodb', 'MongoDB'],
  ['@prisma/client', 'Prisma'],
  ['prisma', 'Prisma'],
  ['better-sqlite3', 'SQLite'],
  ['sqlite3', 'SQLite'],
  ['redis', 'Redis'],
  ['ioredis', 'Redis'],
]

const FRONTENDS: Array<[string, string]> = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['@angular/core', 'Angular'],
  ['solid-js', 'SolidJS'],
]

const TEST_FRAMEWORKS: Array<[string, string]> = [
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['mocha', 'Mocha'],
  ['@playwright/test', 'Playwright'],
  ['cypress', 'Cypress'],
  ['supertest', 'Supertest'],
  ['ava', 'AVA'],
  ['jasmine', 'Jasmine'],
  ['@testing-library/react', 'Testing Library'],
]

interface PackageJsonData {
  dir: string
  deps: string[]
  nodeEngine?: string
}

async function readPackageFiles(files: SourceFile[]): Promise<PackageJsonData[]> {
  const manifests: PackageJsonData[] = []
  for (const file of files) {
    if (!file.rel.endsWith('package.json')) continue
    // Root manifest plus one/two levels down (monorepos: backend/, packages/api/).
    if (file.rel.split('/').length > 3) continue
    try {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        engines?: { node?: string }
      }
      const deps = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ]
      manifests.push({
        dir: path.dirname(file.rel) === '.' ? '' : path.dirname(file.rel),
        deps,
        ...(parsed.engines?.node ? { nodeEngine: parsed.engines.node } : {}),
      })
    } catch {
      // malformed package.json — ignore
    }
  }
  return manifests
}

async function detectStack(files: SourceFile[]): Promise<DetectedStackData> {
  const manifests = await readPackageFiles(files)
  const allDeps = new Set<string>()
  for (const manifest of manifests) for (const dep of manifest.deps) allDeps.add(dep)

  const relPaths = new Set(files.map((file) => file.rel))
  const hasTs =
    relPaths.has('tsconfig.json') ||
    files.some((file) => /\.(ts|tsx|mts|cts)$/.test(file.rel))
  const hasPython = files.some((file) => file.rel.endsWith('.py'))
  const hasGo = relPaths.has('go.mod')

  const language = hasTs ? 'TypeScript' : hasGo ? 'Go' : hasPython ? 'Python' : 'JavaScript'

  const pick = (table: Array<[string, string]>): string | null => {
    for (const [dep, label] of table) if (allDeps.has(dep)) return label
    return null
  }

  const packageManager = relPaths.has('pnpm-lock.yaml')
    ? 'pnpm'
    : relPaths.has('yarn.lock')
      ? 'yarn'
      : relPaths.has('bun.lockb')
        ? 'bun'
        : relPaths.has('package-lock.json')
          ? 'npm'
          : hasPyFile(relPaths)
            ? 'pip'
            : 'npm'

  const nodeEngine = manifests.find((manifest) => manifest.nodeEngine)?.nodeEngine
  const runtime = nodeEngine ? `Node.js ${nodeEngine}` : 'Node.js'

  const testFrameworks = TEST_FRAMEWORKS.filter(([dep]) => allDeps.has(dep)).map(([, label]) => label)
  const frontend = pick(FRONTENDS)

  return {
    language,
    framework: pick(FRAMEWORKS) ?? 'None detected',
    runtime,
    database: pick(DATABASES) ?? 'None detected',
    packageManager,
    ...(frontend ? { frontend } : {}),
    testFrameworks,
    dependencies: [...allDeps].sort().slice(0, 60),
  }
}

function hasPyFile(relPaths: Set<string>): boolean {
  for (const rel of relPaths) if (rel.endsWith('.py')) return true
  return false
}

/* ------------------------------ Route scanning ----------------------------- */

interface ParsedCodeFile {
  rel: string
  /** Local variables holding an express router/app instance. */
  routerVars: Set<string>
  /** Routes defined directly on a router-ish variable in this file. */
  routes: Array<{ method: string; path: string; receiver: string; chainText: string; order: number }>
  /** app.use('/prefix', name) style mounts. */
  mounts: Array<{ prefix: string; localName: string; order: number }>
  /** exportName -> local identifier name ('default' maps to export default X). */
  exports: Map<string, string>
  /** local import name -> { rel file, imported name }. */
  imports: Map<string, { file: string; name: string }>
  /** File-level router.use(authThing) detected. */
  fileAuthApplied: boolean
  /** File defines or imports auth-looking middleware but never applies it. */
  mentionsAuth: boolean
}

const IMPORT_RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function resolveImport(fromRel: string, spec: string, knownFiles: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = path.posix.join(path.posix.dirname(fromRel), spec)
  const baseNoJs = base.replace(/\.(js|jsx|mjs|cjs)$/, '')
  const candidates: string[] = []
  for (const suffix of IMPORT_RESOLUTION_SUFFIXES) candidates.push(`${base}${suffix}`)
  for (const suffix of ['.ts', '.tsx', '.js', '.jsx']) candidates.push(`${baseNoJs}${suffix}`)
  for (const suffix of ['.ts', '.tsx', '.js', '.jsx']) candidates.push(`${base}/index${suffix}`)
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

function parseCodeFile(rel: string, content: string, knownFiles: Set<string>): ParsedCodeFile {
  const source = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, false, scriptKindFor(rel))
  const file: ParsedCodeFile = {
    rel,
    routerVars: new Set(),
    routes: [],
    mounts: [],
    exports: new Map(),
    imports: new Map(),
    fileAuthApplied: false,
    mentionsAuth: false,
  }
  let order = 0

  const looksLikeRouterInit = (node: ts.Expression | undefined): boolean => {
    if (!node || !ts.isCallExpression(node)) return false
    const callee = node.expression
    if (ts.isIdentifier(callee)) return callee.text === 'Router'
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      return callee.expression.text === 'express' && callee.name.text === 'Router'
    }
    return false
  }

  /**
   * Middleware chain reduced to names: identifiers, member accesses and
   * middleware factory calls (authorize('admin')). Inline handler functions
   * contribute nothing — their bodies are not middleware references.
   */
  const chainNames = (args: readonly ts.Expression[]): string =>
    args
      .map((arg) => {
        if (ts.isIdentifier(arg)) return arg.text
        if (ts.isPropertyAccessExpression(arg)) return arg.getText(source)
        if (ts.isCallExpression(arg)) return arg.getText(source)
        return ''
      })
      .filter((name) => name.length > 0)
      .join(', ')

  const registerExport = (exportName: string, localName: string): void => {
    file.exports.set(exportName, localName)
  }

  const visit = (node: ts.Node): void => {
    // import … from '…'
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveImport(rel, node.moduleSpecifier.text, knownFiles)
      const clause = node.importClause
      if (target && clause) {
        if (clause.name) file.imports.set(clause.name.text, { file: target, name: 'default' })
        const bindings = clause.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            file.imports.set(element.name.text, {
              file: target,
              name: element.propertyName?.text ?? element.name.text,
            })
          }
        }
      }
    }

    // export const x = … / export { a as b } / export default x
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        registerExport(decl.name.text, decl.name.text)
        if (looksLikeRouterInit(decl.initializer)) file.routerVars.add(decl.name.text)
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        registerExport(element.name.text, element.propertyName?.text ?? element.name.text)
      }
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals && ts.isIdentifier(node.expression)) {
      registerExport('default', node.expression.text)
    }

    // const x = Router() — non-exported router vars still matter for local mounts
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && looksLikeRouterInit(node.initializer)) {
      file.routerVars.add(node.name.text)
    }

    // call expressions: routes, mounts, api calls
    if (ts.isCallExpression(node)) {
      const callee = node.expression

      // router.route('/path').get(handler)
      if (
        ts.isPropertyAccessExpression(callee) &&
        HTTP_METHODS.has(callee.name.text) &&
        ts.isCallExpression(callee.expression)
      ) {
        const inner = callee.expression
        const innerCallee = inner.expression
        if (
          ts.isPropertyAccessExpression(innerCallee) &&
          innerCallee.name.text === 'route' &&
          ts.isIdentifier(innerCallee.expression)
        ) {
          const routePath = literalText(inner.arguments[0])
          if (routePath?.startsWith('/')) {
            const chain = chainNames(node.arguments)
            file.routes.push({
              method: callee.name.text.toUpperCase(),
              path: routePath,
              receiver: innerCallee.expression.text,
              chainText: chain,
              order: order++,
            })
          }
        }
      }

      // router.get('/path', …) — receiver identifier or property access
      if (ts.isPropertyAccessExpression(callee) && HTTP_METHODS.has(callee.name.text)) {
        const receiver = callee.expression
        if (ts.isIdentifier(receiver) || ts.isPropertyAccessExpression(receiver)) {
          const routePath = literalText(node.arguments[0])
          if (routePath?.startsWith('/')) {
            const chain = chainNames(node.arguments.slice(1))
            file.routes.push({
              method: callee.name.text.toUpperCase(),
              path: routePath,
              receiver: ts.isIdentifier(receiver) ? receiver.text : receiver.getText(source),
              chainText: chain,
              order: order++,
            })
          }
        }
      }

      // app.use('/prefix', router) mounts and file-level auth middleware
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'use') {
        const first = node.arguments[0]
        const prefix = literalText(first)
        const second = node.arguments[1]
        if (prefix?.startsWith('/') && second && ts.isIdentifier(second)) {
          file.mounts.push({ prefix, localName: second.text, order: order++ })
        } else if (!prefix || !prefix.startsWith('/')) {
          const middlewareNames = chainNames(node.arguments)
          if (AUTH_USER_RE.test(middlewareNames)) file.fileAuthApplied = true
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)

  for (const varName of file.routerVars) {
    if (AUTH_USER_RE.test(varName)) file.mentionsAuth = true
  }
  for (const imported of file.imports.values()) {
    if (AUTH_USER_RE.test(imported.name)) file.mentionsAuth = true
  }
  for (const route of file.routes) {
    if (AUTH_USER_RE.test(route.chainText)) file.mentionsAuth = true
  }

  return file
}

const PUBLIC_PATH_RE =
  /^\/(health|auth\/(login|register|refresh|google|logout)|api\/v1\/(health|auth\/(login|register|refresh|google)))/i

function classifyAuth(chainText: string, fileDefault: boolean, mentionsAuth: boolean, fullPath: string): string {
  if (PUBLIC_PATH_RE.test(fullPath)) return 'public'
  if (AUTH_ADMIN_RE.test(chainText)) return 'admin'
  if (chainText && AUTH_USER_RE.test(chainText)) return 'user'
  if (!chainText && fileDefault) return 'user'
  if (mentionsAuth && !fileDefault) return 'none-detected'
  if (fileDefault) return 'user'
  return 'public'
}

interface ExtractedRoute {
  method: string
  path: string
  file: string
  auth: string
  order: number
}

function collectRoutes(parsed: Map<string, ParsedCodeFile>): ExtractedRoute[] {
  const extracted: ExtractedRoute[] = []
  const visited = new Set<string>()

  const emitForFile = (fileRel: string, prefix: string, depth: number, inheritedAuth: boolean): void => {
    const file = parsed.get(fileRel)
    if (!file) return
    const visitKey = `${fileRel}::${prefix}`
    if (visited.has(visitKey) || depth > MAX_MOUNT_DEPTH) return
    visited.add(visitKey)

    const fileDefault = file.fileAuthApplied || inheritedAuth

    // Prefixes applied locally: app.use('/api', router) where `router` lives in this file.
    const localMountPrefix = new Map<string, string>()
    for (const mount of file.mounts) {
      if (!file.imports.has(mount.localName) && file.routerVars.has(mount.localName)) {
        localMountPrefix.set(mount.localName, joinPath(localMountPrefix.get(mount.localName) ?? '', mount.prefix))
      }
    }

    for (const route of file.routes) {
      const localPrefix = localMountPrefix.get(route.receiver)
      const fullPath = joinPath(joinPath(prefix, localPrefix ?? ''), route.path)
      extracted.push({
        method: route.method,
        path: fullPath,
        file: fileRel,
        auth: classifyAuth(route.chainText, fileDefault, file.mentionsAuth, fullPath),
        order: route.order,
      })
    }

    for (const mount of file.mounts) {
      const importInfo = file.imports.get(mount.localName)
      if (!importInfo) continue
      const targetFile = parsed.get(importInfo.file)
      if (!targetFile) continue
      const exportLocal = targetFile.exports.get(importInfo.name)
      if (!exportLocal || !targetFile.routerVars.has(exportLocal)) continue
      emitForFile(importInfo.file, joinPath(prefix, mount.prefix), depth + 1, fileDefault)
    }
  }

  const entryRel = findEntryPoint(parsed)
  if (entryRel) {
    emitForFile(entryRel, '', 0, false)
    if (extracted.length > 0) return extracted
  }

  // No clear entry point (or the entry produced nothing): emit every route
  // at its face value so the structure map still reflects the codebase.
  for (const [rel, file] of parsed) {
    if (file.routes.length === 0) continue
    if (visited.has(`${rel}::`)) continue
    const localMountPrefix = new Map<string, string>()
    for (const mount of file.mounts) {
      if (!file.imports.has(mount.localName) && file.routerVars.has(mount.localName)) {
        localMountPrefix.set(mount.localName, joinPath(localMountPrefix.get(mount.localName) ?? '', mount.prefix))
      }
    }
    for (const route of file.routes) {
      const fullPath = joinPath(localMountPrefix.get(route.receiver) ?? '', route.path)
      extracted.push({
        method: route.method,
        path: fullPath,
        file: rel,
        auth: classifyAuth(route.chainText, file.fileAuthApplied, file.mentionsAuth, fullPath),
        order: route.order,
      })
    }
  }
  return extracted
}

function joinPath(prefix: string, routePath: string): string {
  if (!prefix) return routePath
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  if (routePath === '/') return left || '/'
  const right = routePath.startsWith('/') ? routePath : `/${routePath}`
  return `${left}${right}` || '/'
}

const ENTRY_CANDIDATES = [
  'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js', 'src/index.ts', 'src/index.js',
  'app.ts', 'app.js', 'server.ts', 'server.js', 'index.ts', 'index.js',
  'src/main.ts', 'src/main.js',
]

function findEntryPoint(parsed: Map<string, ParsedCodeFile>): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    if (parsed.has(candidate)) return candidate
  }
  let best: string | null = null
  let bestMounts = 0
  for (const [rel, file] of parsed) {
    if (file.mounts.length > bestMounts) {
      bestMounts = file.mounts.length
      best = rel
    }
  }
  return bestMounts > 0 ? best : null
}

/* ------------------------------- SQL scanning ------------------------------ */

interface TableScanResult {
  name: string
  columns: Array<{ name: string; type: string; nullable?: boolean }>
  relations: string[]
}

function parseSqlTables(sql: string): TableScanResult[] {
  const tables: TableScanResult[] = []
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([\w.]+)["`]?\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = createRe.exec(sql)) !== null) {
    const rawName = match[1]
    if (!rawName) continue
    const name = rawName.includes('.') ? (rawName.split('.').pop() ?? rawName) : rawName
    const bodyStart = match.index + match[0].length
    let depth = 1
    let i = bodyStart
    while (i < sql.length && depth > 0) {
      const ch = sql[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    const body = sql.slice(bodyStart, i - 1)
    const columns: TableScanResult['columns'] = []
    const relations: string[] = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '')
      if (!line) continue
      const colMatch = /^["`]?(\w+)["`]?\s+([A-Za-z]\w*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?)/.exec(line)
      if (colMatch && colMatch[1] && colMatch[2]) {
        const colName = colMatch[1]
        const upper = line.toUpperCase()
        if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)/.test(upper)) continue
        const type = colMatch[2].trim().replace(/\s+/g, ' ')
        columns.push({
          name: colName,
          type,
          nullable: !upper.includes('NOT NULL') && !upper.includes('PRIMARY KEY'),
        })
      }
      const refMatch = /REFERENCES\s+["`]?([\w.]+)["`]?/i.exec(line)
      if (refMatch?.[1]) {
        const refName = refMatch[1].includes('.') ? (refMatch[1].split('.').pop() ?? refMatch[1]) : refMatch[1]
        if (!relations.includes(refName)) relations.push(refName)
      }
    }
    if (!tables.some((table) => table.name === name)) {
      tables.push({ name, columns, relations })
    }
  }
  return tables
}

/* --------------------------- Components & calls ---------------------------- */

const COMPONENT_DIR_RE = /(^|\/)(components|pages|views|hooks|services|context|contexts|layouts|features|screens)(\/|$)/

function componentKind(rel: string, baseName: string): string | null {
  const lower = rel.toLowerCase()
  if (/(^|\/)(hooks)(\/|$)/.test(lower) || /^use[A-Z]/.test(baseName)) return 'hook'
  if (/(^|\/)(services)(\/|$)/.test(lower) || /Service$/.test(baseName)) return 'service'
  if (/(^|\/)(context|contexts)(\/|$)/.test(lower) || /Context$/.test(baseName)) return 'context'
  if (/(^|\/)(pages|views|screens)(\/|$)/.test(lower) || /Page$/.test(baseName)) return 'page'
  if (/\.(tsx|jsx)$/.test(lower)) return 'component'
  return null
}

function scanComponents(files: SourceFile[]): StructureMapData['components'] {
  const components: StructureMapData['components'] = []
  const seen = new Set<string>()
  for (const file of files) {
    const rel = file.rel
    if (!COMPONENT_DIR_RE.test(rel)) continue
    if (/\.(test|spec)\./.test(rel) || rel.endsWith('.d.ts')) continue
    const baseName = path.posix.basename(rel).replace(/\.[^.]+$/, '')
    const kind = componentKind(rel, baseName)
    if (!kind) continue
    const key = `${rel}`
    if (seen.has(key)) continue
    seen.add(key)
    components.push({ name: baseName, path: rel, kind })
  }
  return components
}

interface FrontendCall {
  from: string
  method: string
  path: string
}

const API_CALL_RECEIVERS = /^(fetch|axios|client|api|http|request|httpClient)$/i

function scanApiCalls(files: SourceFile[]): FrontendCall[] {
  const calls: FrontendCall[] = []
  const seen = new Set<string>()

  for (const file of files) {
    if (!isCodeFile(file.rel)) continue
    const source = ts.createSourceFile(
      file.rel,
      file.content,
      ts.ScriptTarget.Latest,
      false,
      scriptKindFor(file.rel),
    )

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        let method: string | null = null
        let receiverName: string | null = null

        if (ts.isIdentifier(callee)) {
          receiverName = callee.text
        } else if (ts.isPropertyAccessExpression(callee)) {
          const receiver = callee.expression
          if (ts.isIdentifier(receiver)) {
            receiverName = receiver.text
            method = callee.name.text.toUpperCase()
          }
        }

        if (receiverName && API_CALL_RECEIVERS.test(receiverName)) {
          const pathArg = literalText(node.arguments[0])
          if (pathArg && (pathArg.startsWith('/api') || pathArg.includes('/api/'))) {
            let httpMethod = method ?? 'GET'
            if (receiverName.toLowerCase() === 'fetch' && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
              for (const prop of node.arguments[1].properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === 'method'
                ) {
                  const value = literalText(prop.initializer)
                  if (value) httpMethod = value.toUpperCase()
                }
              }
            }
            const key = `${file.rel}::${httpMethod}::${pathArg}`
            if (!seen.has(key)) {
              seen.add(key)
              calls.push({ from: file.rel, method: httpMethod, path: pathArg })
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
  }
  return calls
}

/* --------------------------------- Entry ----------------------------------- */

export interface ScanOutput {
  structure: StructureMapData
  stack: DetectedStackData
}

export async function scanWorkspace(rootDir: string): Promise<ScanOutput> {
  const walked = await walk(rootDir)
  const files: SourceFile[] = []
  for (const entry of walked) {
    try {
      files.push({ rel: entry.rel, content: await readFile(entry.abs, 'utf8') })
    } catch {
      // unreadable — skip
    }
  }

  const knownFiles = new Set(files.map((file) => file.rel))
  const parsed = new Map<string, ParsedCodeFile>()
  for (const file of files) {
    if (!isCodeFile(file.rel)) continue
    try {
      parsed.set(file.rel, parseCodeFile(file.rel, file.content, knownFiles))
    } catch {
      // parser failure on one file never fails the scan
    }
  }

  const routes = collectRoutes(parsed)
    .sort((a, b) => (a.file === b.file ? a.order - b.order : a.file.localeCompare(b.file)))
    .map((route) => ({ method: route.method, path: route.path, file: route.file, auth: route.auth }))

  const seenRoutes = new Set<string>()
  const dedupedRoutes = routes.filter((route) => {
    const key = `${route.method} ${route.path}`
    if (seenRoutes.has(key)) return false
    seenRoutes.add(key)
    return true
  })

  const tables: StructureMapData['tables'] = []
  const seenTables = new Set<string>()
  for (const file of files) {
    if (!file.rel.toLowerCase().endsWith('.sql')) continue
    for (const table of parseSqlTables(file.content)) {
      if (seenTables.has(table.name)) continue
      seenTables.add(table.name)
      tables.push(table)
    }
  }

  const components = scanComponents(files)
  const apiCalls = scanApiCalls(files).map((call) => ({ ...call, status: 'ok' as const }))
  const stack = await detectStack(files)

  return {
    structure: { routes: dedupedRoutes, tables, components, apiCalls },
    stack,
  }
}

export function countsFromStructure(structure: StructureMapData): {
  routeCount: number
  tableCount: number
  componentCount: number
  apiCallCount: number
} {
  return {
    routeCount: structure.routes.length,
    tableCount: structure.tables.length,
    componentCount: structure.components.length,
    apiCallCount: structure.apiCalls.length,
  }
}
