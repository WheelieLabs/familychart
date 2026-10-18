import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"

export const PORT = 4100
// 127.0.0.1, not localhost: some networks (WSL) are slow to fall back from IPv6.
export const BASE_URL = `http://127.0.0.1:${PORT}`

/** Environment of the test instance: a scratch database, plain http on localhost, and a fixed secret. */
export function serverEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DB_PATH: join(process.env.FC_UI_TEST_DIR!, "familychart.db"),
    NEXTAUTH_URL: BASE_URL,
    AUTH_URL: BASE_URL,
    // Host trust for plain http on localhost (Auth.js trustHost); session cookies stay non-Secure
    // only under `next dev` — production UI tests use the API request context for bootstrap/sign-in.
    BEHIND_REVERSE_PROXY: "true",
    NEXTAUTH_SECRET: "ui-test-secret-0123456789abcdef0123456789abcdef",
  }
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Starts the app on the test port and waits until it answers. The production build by default (run
 * `npm run build` first, which `npm run test:ui` does); FC_UI_DEV=1 uses the dev server. With
 * FC_UI_REUSE_SERVER=1 a server that is already running is used as it is. Returns the stop function.
 *
 * Playwright's own `webServer` option is not used: its "is the port free" probe can hang for two
 * minutes on some networks before it starts the server.
 */
export async function startServer(): Promise<() => Promise<void>> {
  if (process.env.FC_UI_REUSE_SERVER && (await isUp())) return async () => {}

  const args = process.env.FC_UI_DEV
    ? ["next", "dev", "--port", String(PORT), "--webpack"]
    : ["next", "start", "--port", String(PORT)]
  const child: ChildProcess = spawn("npx", args, {
    env: serverEnv(),
    stdio: ["ignore", "ignore", process.env.CI ? "inherit" : "ignore"],
    detached: true,
  })

  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    if (await isUp()) {
      return async () => {
        // The child leads its own process group (npx starts next beneath it): stop the group.
        try {
          process.kill(-child.pid!, "SIGTERM")
        } catch {
          /* already gone */
        }
      }
    }
    if (child.exitCode !== null) throw new Error(`The app exited with code ${child.exitCode} while starting.`)
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error("The app did not answer /api/health within 5 minutes.")
}
