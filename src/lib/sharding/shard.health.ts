// src/lib/sharding/shard.health.ts

import {
    shardingConfig,
} from "../../config/sharding.config";

import {
    healthCheckShard,
} from "./shard.manager";

import {
    ShardHealth,
} from "./shard.types";

export const checkAllShards =
    async (): Promise<
        readonly ShardHealth[]
    > => {
        const results =
            await Promise.all(
                Array.from(
                    shardingConfig.shards.keys(),
                ).map(
                    async (
                        shardId,
                    ): Promise<ShardHealth> => {
                        const start =
                            Date.now();

                        try {
                            await healthCheckShard(
                                shardId,
                            );

                            return {
                                shardId,
                                healthy: true,
                                latencyMs:
                                    Date.now() -
                                    start,
                            };
                        } catch (error) {
                            return {
                                shardId,
                                healthy: false,
                                latencyMs:
                                    Date.now() -
                                    start,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Unknown error",
                            };
                        }
                    },
                ),
            );

        return results;
    };