import { createAnthropic } from "@ai-sdk/anthropic";
import {
  getAnthropicApiKey,
  getAnthropicWorkspaceId,
} from "@/lib/config/env";

export function getAnthropicProvider() {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return null;

  const workspaceId = getAnthropicWorkspaceId();
  return createAnthropic({
    apiKey,
    headers: workspaceId
      ? { "anthropic-workspace-id": workspaceId }
      : undefined,
  });
}

export function missingAnthropicConfigMessage(): string {
  if (!getAnthropicApiKey()) {
    return "The buyer agent needs ANTHROPIC_API_KEY in .env.local (same line, no quotes).";
  }
  return "Your Anthropic key still looks identity-linked. Use a workspace-scoped key from the Default Workspace, or set ANTHROPIC_WORKSPACE_ID to the wrkspc_… id from Claude Console → Settings → Workspaces.";
}
