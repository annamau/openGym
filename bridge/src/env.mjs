// Loads KEY=value lines from a local .env file (gitignored) into process.env.
// Real environment variables win over the file. Needs Node 22+ (process.loadEnvFile).
import fs from 'node:fs'

export function loadEnv(file) {
  if (fs.existsSync(file)) process.loadEnvFile(file)
}

/** Which of the keys are set (true/false) — never the values. */
export function envPresence(keys) {
  return Object.fromEntries(keys.map(k => [k, !!process.env[k]]))
}
