import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'))
export const targets = () => readJson('config', 'targets.json')
export const selection = () => readJson('config', 'selection.json')

export function jsonRes(body, { status = 200, cookies = [] } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}
export const textRes = (body, status = 200) => new Response(body, { status })
