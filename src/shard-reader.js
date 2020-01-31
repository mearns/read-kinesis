const withRetry = require("./retry");

/**
 * Get an iterative reader to read records our of the specified Kinesis shard, starting form
 * the given checkpoint (or the TRIM_HORIZON if no checkpoint is available).
 *
 * @param {AWS.Kinesis} kinesis A Kinesis client to use.
 * @param {string} streamName The name of the stream to read from.
 * @param {string} shardId The shardID to read from.
 * @param {Checkpoint} lastCheckpoint Optional, the last known checkpoint.
 *
 * @returns {InitialShardReadCursor}
 */
function readFromShard(kinesis, streamName, shardId, lastCheckpoint) {
    const shard = new KinesisShard(kinesis, streamName, shardId);
    return {
        next: () => readAndAdvance(shard, lastCheckpoint || {})
    };
}

module.exports = readFromShard;

/**
 * Reads one batch of records from the specified shard, starting at the given checkpoint, or the
 * TRIM_HORIZON if the checkpoint isn't given, or is empty.
 *
 * This is meant to be used in a chase-the-tail conga-line kind of fashion. Each call returns
 * the records read and an updated checkpoint, but also a `next` function that can be called
 * without parameters to read the next batch of records. When there are no records left to
 * read, the `next` function is omitted.
 *
 * ```javascript
 * let cursor = createShardReader(...);
 * while (cursor.next) {
 *      cursor = awwait cursor.next();
 *      processRecords(cursor.records);
 *      commitCheckpoint(cursor.checkpoint);
 * }
 * ```
 *
 * @param {KinesisShard} shard
 * @param {Checkpoint} [lastCheckpoint]
 *
 * @returns {Promise<ShardReadCursor>} The returned cursor has the data that was read starting from the given
 * checkpoint, and a {@link ShardReadCursorAdvance} function to get the next cursor.
 */
async function readAndAdvance(shard, lastCheckpoint = {}) {
    const shardIterator = await shard.getShardIteratorFromCheckpoint(
        lastCheckpoint
    );
    const getRecordsResponse = await shard.getOneBatchOfRecords({
        shardIterator,
        lastReadSequenceNumber: lastCheckpoint.lastReadSequenceNumber
    });
    const nextCheckpoint = getNextCheckpoint(
        getRecordsResponse,
        lastCheckpoint
    );
    return {
        records: getRecordsResponse.Records,
        checkpoint: nextCheckpoint,
        ...(moreToRead(getRecordsResponse) && {
            next: () => readAndAdvance(shard, nextCheckpoint)
        })
    };
}

// Max value for Limit, per https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetRecords.html
const MAX_BATCH_SIZE = 10000;
const INITIAL_BATCH_SIZE = Math.floor(MAX_BATCH_SIZE / 4);
const MIN_BATCH_SIZE = 1;
const BATCH_SIZE_DECREASE_MULTIPLE = 0.5;
const BATCH_SIZE_INCREASE_MULTIPLE = 1.5;

let batchSize = INITIAL_BATCH_SIZE;

function batchSizeWasSuccessful(usedBatchSize) {
    batchSize = Math.min(
        MAX_BATCH_SIZE,
        Math.max(
            batchSize,
            Math.round(usedBatchSize * BATCH_SIZE_INCREASE_MULTIPLE)
        )
    );
}

function batchSizeWasUnsuccessful(usedBatchSize) {
    batchSize = Math.max(
        MIN_BATCH_SIZE,
        Math.min(
            batchSize,
            Math.round(usedBatchSize * BATCH_SIZE_DECREASE_MULTIPLE)
        )
    );
}

/**
 * Represents a specific Kinesis shard. Mostly jsut so we don't have to keep passing
 * the kinesis client, streamName, and shardId everywhere.
 */
class KinesisShard {
    constructor(kinesis, streamName, shardId) {
        this.kinesis = kinesis;
        this.streamName = streamName;
        this.shardId = shardId;
    }

    /**
     * Read one batch of records from the given checkpoint, return the response object form
     * the getRecords.
     * @param {Checkpoint} lastCheckpoint The checkpoint value to start from.
     * @returns {object} The response body from the Kinesis getRecords call.
     */
    getOneBatchOfRecords({ shardIterator, lastReadSequenceNumber }) {
        return withRetry(async () => {
            const usedBatchSize = batchSize;
            try {
                const response = await this.kinesis
                    .getRecords({
                        ShardIterator: shardIterator,
                        Limit: usedBatchSize
                    })
                    .promise();
                batchSizeWasSuccessful(usedBatchSize);
                return response;
            } catch (error) {
                if (error.code === "ExpiredIteratorException") {
                    const newShardIterator = await this.getShardIteratorFromLastReadSequenceNumber(
                        lastReadSequenceNumber
                    );
                    return this.getOneBatchOfRecords({
                        shardIterator: newShardIterator,
                        lastReadSequenceNumber
                    });
                } else if (
                    error.code === "ProvisionedThroughputExceededException"
                ) {
                    batchSizeWasUnsuccessful(usedBatchSize);
                }
                throw error;
            }
        });
    }

    getShardIteratorFromLastReadSequenceNumber(lastReadSequenceNumber) {
        if (lastReadSequenceNumber) {
            return this.requestShardIterator(
                "AFTER_SEQUENCE_NUMBER",
                lastReadSequenceNumber
            );
        }
        return this.requestShardIterator("TRIM_HORIZON");
    }

    getShardIteratorFromTimestamp(timestamp) {
        return this.requestShardIterator("AT_TIMESTAMP", undefined, timestamp);
    }

    getShardIteratorFromCheckpoint({
        shardIterator,
        lastReadSequenceNumber,
        timestamp
    }) {
        // If we already have a shard iterator, use it.
        if (shardIterator) {
            return shardIterator;
        }
        if (lastReadSequenceNumber) {
            return this.getShardIteratorFromLastReadSequenceNumber(
                lastReadSequenceNumber
            );
        } else if (timestamp) {
            return this.getShardIteratorFromTimestamp(timestamp);
        }
        return this.requestShardIterator("TRIM_HORIZON");
    }

    /**
     * Request a new shard iterator for this shard from kinesis.
     * @param {string} iteratorType
     * @param {string} sequenceNumber
     */
    requestShardIterator(iteratorType, sequenceNumber, timestamp) {
        return withRetry(
            async () =>
                (await this.kinesis
                    .getShardIterator({
                        StreamName: this.streamName,
                        ShardId: this.shardId,
                        ShardIteratorType: iteratorType,
                        StartingSequenceNumber: sequenceNumber,
                        Timestamp: timestamp
                    })
                    .promise()).ShardIterator
        );
    }
}

function moreToRead(getRecordsResponse) {
    return (
        getRecordsResponse.MillisBehindLatest &&
        getRecordsResponse.NextShardIterator
    );
}

function getNextCheckpoint(getRecordsResponse, lastCheckpoint) {
    return {
        shardIterator: getRecordsResponse.NextShardIterator,
        lastReadSequenceNumber:
            (last(getRecordsResponse.Records) || {}).SequenceNumber ||
            (lastCheckpoint || {}).lastReadSequenceNumber ||
            null
    };
}

function last(ari) {
    const OFF_BY_ONE = -1;
    return ari[ari.length + OFF_BY_ONE];
}

/**
 * @typedef {import("./shard-reader").Checkpoint} Checkpoint
 * @typedef {import("./kinesis-reader").ShardReadCursor} ShardReadCursor
 * @typedef {import("./kinesis-reader").InitialShardReadCursor} InitialShardReadCursor
 * @typedef {import("./kinesis-reader").ShardReadCursorAdvance} ShardReadCursorAdvance
 */
