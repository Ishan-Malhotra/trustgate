import type {
  AuditEntry,
  FinalDecision,
  PaymentAction,
  SellerListing,
  SellerTrustCheck,
  TrustTier,
  UserPolicy,
} from "@/lib/types";

export interface CatalogSeller {
  id: string;
  name: string;
  category: string;
  known_for?: string[];
  listings?: SellerListing[];
  score?: number;
  tier?: TrustTier;
  spendLimit?: number | null;
}

export interface ScoredSeller extends CatalogSeller {
  account_age_days: number;
  kyc_verified: boolean;
  dispute_rate_history: number[];
  return_rate: number;
  price_volatility: number;
  score: number;
  tier: TrustTier;
  spendLimit: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  decision?: FinalDecision;
  explanation?: string;
  payment?: Record<string, unknown>;
  evaluatedSellers?: SellerTrustCheck[];
  chosenSellerId?: string;
}

export interface SellersResponse {
  sellers: CatalogSeller[];
  userPolicy: UserPolicy;
  llmConfigured?: boolean;
  anthropicWorkspaceConfigured?: boolean;
  razorpayConfigured?: boolean;
}

export interface EvaluateResponse {
  seller: { id: string; name: string };
  decision: FinalDecision;
  explanation: string;
  payment?: Record<string, unknown>;
  userPolicy: UserPolicy;
  auditLog: AuditEntry[];
}

export interface PurchaseResponse {
  response: string;
  explanation?: string;
  decision?: FinalDecision;
  payment?: Record<string, unknown>;
  evaluatedSellers?: SellerTrustCheck[];
  chosenSellerId?: string;
  auditLog: AuditEntry[];
}

export function tierColor(tier: TrustTier): string {
  switch (tier) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-amber-400";
    case "low":
      return "text-red-400";
  }
}

export function tierBg(tier: TrustTier): string {
  switch (tier) {
    case "high":
      return "bg-emerald-500/15 border-emerald-500/30";
    case "medium":
      return "bg-amber-500/15 border-amber-500/30";
    case "low":
      return "bg-red-500/15 border-red-500/30";
  }
}

export function actionLabel(action: PaymentAction): string {
  switch (action) {
    case "capture":
      return "Capture";
    case "hold":
      return "Hold";
    case "refuse":
      return "Refuse";
  }
}

export function actionColor(action: PaymentAction): string {
  switch (action) {
    case "capture":
      return "text-emerald-400";
    case "hold":
      return "text-amber-400";
    case "refuse":
      return "text-red-400";
  }
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatListings(listings?: SellerListing[]): string {
  if (!listings?.length) return "Price on request";
  return listings.map((l) => `${l.item} ${formatInr(l.price)}`).join(" · ");
}
