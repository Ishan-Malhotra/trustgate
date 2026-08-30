"use client";

import type { CatalogSeller } from "@/lib/ui/types";
import {
  formatInr,
  formatListings,
  tierBg,
  tierColor,
} from "@/lib/ui/types";
import type { SellerTrustCheck } from "@/lib/types";

interface SellerPanelProps {
  sellers: CatalogSeller[];
  revealedById: Record<string, SellerTrustCheck>;
  chosenSellerId?: string;
  devMode: boolean;
  onToggleDevMode: () => void;
}

export function SellerPanel({
  sellers,
  revealedById,
  chosenSellerId,
  devMode,
  onToggleDevMode,
}: SellerPanelProps) {
  const sorted = [...sellers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Available Sellers
        </h2>
        <button
          type="button"
          onClick={onToggleDevMode}
          aria-pressed={devMode}
          aria-label="Toggle developer mode to show all trust scores"
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            devMode
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          }`}
        >
          Dev mode
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-600">
        {devMode
          ? "Debug: scores and tiers visible for every seller."
          : "Public catalog only. Trust scores appear after the agent evaluates a seller."}
      </p>
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {sorted.map((seller) => {
          const revealed = revealedById[seller.id];
          const showScore =
            devMode && seller.score !== undefined && seller.tier
              ? { score: seller.score, tier: seller.tier, spendLimit: seller.spendLimit ?? null }
              : revealed
                ? {
                    score: revealed.score,
                    tier: revealed.tier,
                    spendLimit: revealed.spendLimit,
                  }
                : null;
          const selected = seller.id === chosenSellerId;
          const isGaming = seller.id === "seller-gaming";

          return (
            <li key={seller.id}>
              <div
                className={`w-full rounded-lg border p-3 text-left ${
                  selected
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-zinc-800 bg-zinc-950/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {seller.name}
                      {devMode && isGaming && (
                        <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">
                          Gaming
                        </span>
                      )}
                      {selected && (
                        <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-300">
                          Chosen
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{seller.category}</p>
                  </div>
                  {showScore && (
                    <div className="shrink-0 text-right">
                      <p className={`font-mono text-lg font-semibold ${tierColor(showScore.tier)}`}>
                        {showScore.score}
                      </p>
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tierBg(showScore.tier)} ${tierColor(showScore.tier)}`}
                      >
                        {showScore.tier}
                      </span>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  {formatListings(seller.listings)}
                </p>
                {showScore && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Limit:{" "}
                    {showScore.spendLimit === null
                      ? "unlimited"
                      : showScore.spendLimit === 0
                        ? "refuse"
                        : formatInr(showScore.spendLimit)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
