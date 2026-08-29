import { randomUUID } from "crypto";
import type { AuditEntry } from "@/lib/types";
import { promises as fs } from "fs";
import path from "path";

const globalForAudit = globalThis as unknown as {
  auditLog?: AuditEntry[];
};

function getLog(): AuditEntry[] {
  if (!globalForAudit.auditLog) {
    globalForAudit.auditLog = [];
  }
  return globalForAudit.auditLog;
}

const LOG_FILE = path.join(process.cwd(), "data", "audit-log.json");

export function logAudit(
  type: AuditEntry["type"],
  message: string,
  details?: Record<string, unknown>
): AuditEntry {
  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  };

  getLog().push(entry);
  void persistLog(entry);
  return entry;
}

async function persistLog(entry: AuditEntry): Promise<void> {
  try {
    let existing: AuditEntry[] = [];
    try {
      const raw = await fs.readFile(LOG_FILE, "utf-8");
      existing = JSON.parse(raw) as AuditEntry[];
    } catch {
      existing = [];
    }
    existing.push(entry);
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify(existing, null, 2));
  } catch {
    // In-memory log still works if file write fails
  }
}

export function getAuditLog(): AuditEntry[] {
  return [...getLog()];
}

export function clearAuditLog(): void {
  globalForAudit.auditLog = [];
}
