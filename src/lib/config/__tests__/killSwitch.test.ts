import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  assertPaymentsAllowed,
  isPaymentsKilled,
  KILL_SWITCH_MESSAGE,
  setPaymentsKilled,
} from "@/lib/config/killSwitch"
import {
  createMemoryKillSwitchStore,
  createRedisKillSwitchStore,
  KILL_SWITCH_KEY,
  setKillSwitchStoreForTests,
} from "@/lib/config/killSwitchStore"

describe("killSwitch", () => {
  beforeEach(() => {
    setKillSwitchStoreForTests(createMemoryKillSwitchStore({ killed: false }))
  })

  afterEach(() => {
    setKillSwitchStoreForTests(undefined)
  })

  it("defaults to payments enabled", async () => {
    expect(await isPaymentsKilled()).toBe(false)
    expect(await assertPaymentsAllowed()).toEqual({ ok: true })
  })

  it("blocks payments when engaged", async () => {
    await setPaymentsKilled(true)
    expect(await isPaymentsKilled()).toBe(true)
    expect(await assertPaymentsAllowed()).toEqual({
      ok: false,
      error: KILL_SWITCH_MESSAGE,
    })
  })

  it("re-enables payments when released", async () => {
    await setPaymentsKilled(true)
    await setPaymentsKilled(false)
    expect(await isPaymentsKilled()).toBe(false)
    expect((await assertPaymentsAllowed()).ok).toBe(true)
  })

  it("reads the store on every isPaymentsKilled call (no in-process cache)", async () => {
    let reads = 0
    const cell = { killed: false }
    setKillSwitchStoreForTests({
      backend: "memory",
      async get() {
        reads += 1
        return cell.killed
      },
      async set(killed) {
        cell.killed = killed
      },
    })
    await isPaymentsKilled()
    await isPaymentsKilled()
    expect(reads).toBe(2)
  })
})

describe("kill switch cross-instance store", () => {
  afterEach(() => {
    setKillSwitchStoreForTests(undefined)
  })

  it("OLD isolated globalThis-style stores do not share the flag", async () => {
    const instanceA = createMemoryKillSwitchStore({ killed: false })
    const instanceB = createMemoryKillSwitchStore({ killed: false })

    setKillSwitchStoreForTests(instanceA)
    await setPaymentsKilled(true)
    expect(await isPaymentsKilled()).toBe(true)

    setKillSwitchStoreForTests(instanceB)
    expect(await isPaymentsKilled()).toBe(false)
    expect(await assertPaymentsAllowed()).toEqual({ ok: true })
  })

  it("shared store is visible to a second instance on every read", async () => {
    const sharedCell = { killed: false }
    const instanceA = createMemoryKillSwitchStore(sharedCell)
    const instanceB = createMemoryKillSwitchStore(sharedCell)

    setKillSwitchStoreForTests(instanceA)
    await setPaymentsKilled(true)

    setKillSwitchStoreForTests(instanceB)
    expect(await isPaymentsKilled()).toBe(true)
    expect(await assertPaymentsAllowed()).toEqual({
      ok: false,
      error: KILL_SWITCH_MESSAGE,
    })
  })

  it("Redis-backed store writes the shared key and reads it back uncached", async () => {
    const remote = new Map<string, boolean>()
    const redis = {
      get: async (key: string) => remote.get(key) ?? null,
      set: async (key: string, value: boolean) => {
        remote.set(key, value)
        return "OK"
      },
    }
    const instanceA = createRedisKillSwitchStore(redis)
    const instanceB = createRedisKillSwitchStore(redis)

    setKillSwitchStoreForTests(instanceA)
    await setPaymentsKilled(true)
    expect(remote.get(KILL_SWITCH_KEY)).toBe(true)

    setKillSwitchStoreForTests(instanceB)
    expect(await isPaymentsKilled()).toBe(true)
  })

  it("fails closed when the Redis read throws", async () => {
    const redis = {
      get: async () => {
        throw new Error("timeout")
      },
      set: async () => "OK",
    }
    setKillSwitchStoreForTests(createRedisKillSwitchStore(redis))
    expect(await isPaymentsKilled()).toBe(true)
    expect(await assertPaymentsAllowed()).toEqual({
      ok: false,
      error: KILL_SWITCH_MESSAGE,
    })
  })
})
