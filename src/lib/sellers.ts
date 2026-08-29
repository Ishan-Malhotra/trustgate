import sellersData from "../../data/sellers.json";
import type { Seller } from "@/lib/types";

export function getAllSellers(): Seller[] {
  return sellersData as Seller[];
}

export function getSellerById(id: string): Seller | undefined {
  return getAllSellers().find((s) => s.id === id);
}
