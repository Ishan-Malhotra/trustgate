import { search_catalog } from "@/lib/catalog/searchCatalog"
import type { CatalogSearchResult } from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import type { UserPolicy } from "@/lib/types"

export interface ShoppingAgentInput {
  query: string
  budget?: number
}

/**
 * Thin shopping-agent orchestrator: finds deals via search_catalog.
 * TrustGate alone decides whether each deal can be transacted.
 */
export async function runShoppingAgent(
  input: ShoppingAgentInput,
  ctx: AgentContext,
  userPolicy: UserPolicy
): Promise<CatalogSearchResult & { shoppingAgent: true }> {
  const result = await search_catalog(input, ctx, userPolicy)
  return { ...result, shoppingAgent: true }
}
