/**
 * A Checkpoint refers to a specific point in a Kinesis stream. The lastReadSequenceNumber
 * is the sequence number ofa particular record, while the shardIterator may be advanced
 * past that through empty timeslices in the shard (but not to any additional records).
 * If the shardIterator is still valid, it should be used to read from. If the shardIterator
 * is expired, you can request a new shard iterator from the lastReadSequenceNumber using
 * the AFTER_SEQUENCE_NUMBER iterator type.
 */
export interface Checkpoint {
    shardIterator: ShardIterator | null;
    lastReadSequenceNumber: SequenceNumber | null;
}

type ShardIterator = string;
type SequenceNumber = string;

export interface InitialShardReadCursor {
    /**
     * Read the first set of records and return an advanced cursor.
     */
    next: ShardReadCursorAdvance;
}

export interface ShardReadCursor {
    /** The set of read records (possibly empty). */
    records: object[];

    /** The checkpoint at the end of the given set of records. */
    checkpoint: Checkpoint;

    /**
     * The function to get the next (advanced) cursor. Present if and only if the cursor
     * has not reached the end of the shard.
     */
    next?: ShardReadCursorAdvance;
}

/**
 * A function used by a {@link ShardReadCursor} or an {@link InitialShardReadCursor} to read the next
 * set of records and advance the cursor.
 */
export type ShardReadCursorAdvance = () => Promise<ShardReadCursor>;
