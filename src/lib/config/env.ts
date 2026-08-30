import { existsSync, readFileSync } from "fs";
import path from "path";

export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }

  return result;
}

export function hydrateEnvFromLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!value) continue;
    const current = process.env[key]?.trim();
    if (!current) {
      process.env[key] = value;
    }
  }
}

export function getEnvValue(name: string): string | undefined {
  hydrateEnvFromLocal();
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getAnthropicApiKey(): string | undefined {
  return getEnvValue("ANTHROPIC_API_KEY");
}

export function getAnthropicWorkspaceId(): string | undefined {
  return getEnvValue("ANTHROPIC_WORKSPACE_ID");
}

export function isLlmConfigured(): boolean {
  return Boolean(getAnthropicApiKey());
}
