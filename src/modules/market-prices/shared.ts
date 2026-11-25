// What the phone's screens need from market-prices, without Zod (ADR-009). The Zod schemas are in ./schema.ts.
export { latestByProduct, PRODUCTS, UNIT } from "@/modules/market-prices/domain/prices";
export type { LatestPrice, PriceDto, Product } from "@/modules/market-prices/domain/prices";

export const PRICE_MUTATIONS = { recordPrice: "market-prices.recordPrice" } as const;
