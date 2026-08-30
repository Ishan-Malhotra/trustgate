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
  if (!getAnthropicWorkspaceId()) {
    return "Your Anthropic key is identity-linked, so it also needs ANTHROPIC_WORKSPACE_ID in .env.local. Copy the wrkspc_… id from Claude Console → Settings → Workspaces. Or create a key scoped to one workspace so this header is not required.";
  }
  return "Anthropic is configured.";
}
