"use client"

import { useState } from "react"

interface ControlGateProps {
  mode: "password" | "locked"
  onUnlocked: () => void
}

export const ControlGate = ({ mode, onUnlocked }: ControlGateProps) => {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const handlePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (mode !== "password") return
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Unlock failed"
        )
        return
      }
      onUnlocked()
    } catch {
      setError("Unlock failed")
    } finally {
      setBusy(false)
    }
  }

  if (mode === "locked") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div
          className="w-full max-w-md rounded-xl border border-red-500/40 bg-red-950/30 px-5 py-6"
          role="alert"
        >
          <h1 className="text-lg font-semibold text-zinc-100">
            TrustGate is locked
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            This public deployment has no control password. Set{" "}
            <code className="font-mono text-zinc-200">
              TRUSTGATE_CONTROL_SECRET
            </code>{" "}
            in the environment, then reload.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/80 px-5 py-6"
      >
        <h1 className="text-lg font-semibold text-zinc-100">Unlock TrustGate</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Payments, policy, and the audit log stay behind a demo password on
          this deployment.
        </p>
        <label htmlFor="control-password" className="sr-only">
          Control password
        </label>
        <input
          id="control-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={handlePasswordChange}
          disabled={busy}
          placeholder="Control password"
          aria-invalid={Boolean(error)}
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
        />
        {error && (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-4 w-full rounded-lg border border-cyan-600/60 bg-cyan-950/50 px-4 py-2 text-sm font-semibold text-cyan-200 transition-colors hover:border-cyan-500 disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  )
}
