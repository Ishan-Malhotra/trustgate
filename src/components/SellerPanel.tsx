"use client";

import type { ScoredSeller } from "@/lib/ui/types";
import { formatInr, tierBg, tierColor } from "@/lib/ui/types";

interface SellerPanelProps {
  sellers: ScoredSeller[];
  selectedSellerId?: string;
  onSelectSeller: (seller: ScoredSeller) => void;
}

export function SellerPanel({
  sellers,
  selectedSellerId,
  onSelectSeller,
}: SellerPanelProps) {
  const sorted = [...sellers].sort((a, b) => b.score - a.score);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Sellers &amp; Trust Scores
      </h2>
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {sorted.map((seller) => {
          const selected = seller.id === selectedSellerId;
          const isGaming = seller.id === "seller-gaming";

          return (
            <li key={seller.id}>
              <button
                type="button"
                onClick={() => onSelectSeller(seller)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700 hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {seller.name}
                      {isGaming && (
                        <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">
                          Gaming
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{seller.category}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-lg font-semibold ${tierColor(seller.tier)}`}>
                      {seller.score}
                    </p>
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tierBg(seller.tier)} ${tierColor(seller.tier)}`}
                    >
                      {seller.tier}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Limit:{" "}
                  {seller.spendLimit === null
                    ? "unlimited"
                    : seller.spendLimit === 0
                      ? "refuse"
                      : formatInr(seller.spendLimit)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
