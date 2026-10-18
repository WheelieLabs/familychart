export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { acquireDbKey } = await import("./lib/encryption/db-key")
    await acquireDbKey()

    const { acquireFileKey } = await import("./lib/encryption/file-key")
    await acquireFileKey()

    const { getDb } = await import("./lib/db")
    getDb()

    if (process.env.CRON_MODE === "internal") {
      const { initInternalCron } = await import("./lib/cron")
      initInternalCron()
    }

    const { emitHealthyBootSignal } = await import("./lib/ops-health-log")
    emitHealthyBootSignal()
  }
}
