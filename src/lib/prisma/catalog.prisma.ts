// src/lib/prisma/catalog.prisma.ts

import { PrismaClient } from "@prisma/client";
import { shardingConfig } from "../../config/sharding.config";

let catalogClient: PrismaClient | null = null;

/**
 * Lazily initializes and returns the PrismaClient instance for the global Catalog Database.
 */
export const getCatalogClient = (): PrismaClient => {
  if (!catalogClient) {
    catalogClient = new PrismaClient({
      datasources: {
        db: {
          url: shardingConfig.catalogUrl,
        },
      },
      log:
        process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }
  return catalogClient;
};

/**
 * Exported singleton instance of the Catalog Database PrismaClient.
 */
export const catalogDb = getCatalogClient();
export const catalogPrisma = catalogDb;

/**
 * Disconnects the Catalog Database PrismaClient connection if active.
 */
export const disconnectCatalogDb = async (): Promise<void> => {
  if (catalogClient) {
    await catalogClient.$disconnect();
    catalogClient = null;
  }
};

export default catalogDb;
