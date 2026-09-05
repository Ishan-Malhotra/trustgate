import { promises as fs } from "fs"
import path from "path"
import { Redis } from "@upstash/redis"
import { getEnvValue } from "@/lib/config/env"
import { isHardenedDeployment } from "@/lib/config/controlAuth"
import { logAudit } from "@/lib/audit/logger"

export const KILL_SWITCH_KEY = "trustgate:payments_killed"

export type KillSwitchBackend = "redis" | "file" | "memory"

export interface KillSwitchStore {
  readonly backend: KillSwitchBackend
  get(): Promise<boolean>
  set(killed: boolean): Promise<void>
}

/**
 * Shared-cell memory store. Two "instances" that receive the same `cell`
 * object behave like a cross-instance KV. Two different cells reproduce
 * the old per-process globalThis bug.
 */
export function createMemoryKillSwitchStore(cell: {
  killed: boolean
}): KillSwitchStore {
  return {
    backend: "memory",
    async get() {
      return Boolean(cell.killed)
    },
    async set(killed) {
      cell.killed = killed
    },
  }
}

export function createRedisKillSwitchStore(redis: {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: boolean) => Promise<unknown>
}): KillSwitchStore {
  return {
    backend: "redis",
    async get() {
      try {
        return parseKilledFlag(await redis.get(KILL_SWITCH_KEY))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logAudit("error", `[kill-switch] Redis read failed — fail closed: ${message}`)
        return true
      }
    },
    async set(killed) {
      await redis.set(KILL_SWITCH_KEY, killed)
    },
  }
}

export function createFileKillSwitchStore(
  filePath = path.join(process.cwd(), "data", "kill-switch.json")
): KillSwitchStore {
  return {
    backend: "file",
    async get() {
      try {
        const raw = await fs.readFile(filePath, "utf-8")
        const parsed = JSON.parse(raw) as { killed?: unknown }
        return parsed.killed === true
      } catch (err) {
        if (isMissingFile(err)) return false
        const message = err instanceof Error ? err.message : String(err)
        logAudit("error", `[kill-switch] File read failed — fail closed: ${message}`)
        return true
      }
    },
    async set(killed) {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(
        filePath,
        `${JSON.stringify({ killed }, null, 2)}\n`
      )
    },
  }
}

export function isKillSwitchRedisConfigured(): boolean {
  return Boolean(getUpstashRedisUrl() && getUpstashRedisToken())
}

export function getUpstashRedisUrl(): string | undefined {
  return getEnvValue("UPSTASH_REDIS_REST_URL")
}

export function getUpstashRedisToken(): string | undefined {
  return getEnvValue("UPSTASH_REDIS_REST_TOKEN")
}

let redisStore: KillSwitchStore | undefined
let fileStore: KillSwitchStore | undefined
let testDefaultStore: KillSwitchStore | undefined
let storeOverride: KillSwitchStore | undefined

export function setKillSwitchStoreForTests(
  store: KillSwitchStore | undefined
): void {
  storeOverride = store
}

export function getKillSwitchStore(): KillSwitchStore {
  if (storeOverride) return storeOverride
  if (process.env.VITEST) {
    if (!testDefaultStore) {
      testDefaultStore = createMemoryKillSwitchStore({ killed: false })
    }
    return testDefaultStore
  }
  if (isKillSwitchRedisConfigured()) {
    if (!redisStore) {
      redisStore = createRedisKillSwitchStore(
        new Redis({
          url: getUpstashRedisUrl()!,
          token: getUpstashRedisToken()!,
        })
      )
    }
    return redisStore
  }
  if (!fileStore) {
    fileStore = createFileKillSwitchStore()
    if (isHardenedDeployment()) {
      logAudit(
        "error",
        "[kill-switch] UPSTASH_REDIS_REST_URL / TOKEN missing on this Vercel deployment — kill switch is not cross-instance until Redis is set"
      )
    }
  }
  return fileStore
}

export function parseKilledFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  )
}
