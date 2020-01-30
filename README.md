# kinesis-reader

## Overview

```console
> ./kinesis-reader.sh dump <stream-name> [options]

> # Read from all shards in the specified stream (based on list-shards)
> ./kinesis-reader.sh dump $STREAM_NAME --all

> # Read from specified shards in the stream
> ./kinesis-reader.sh dump $STREAM_NAME --shard shardId-000000000000 --shard shardId-000000000001
```

## Checkpoints

A checkpoint describes where the reader leftoff in a particular shard (in a particular stream).
You can add the `--checkpoint-file` option to specify the name of a file where checkpoints are
stored. If the file already exists, then checkpoints will be loaded from it and the reader will
pick up from there. If the checkpoint file doesn't exist, it will read from the trim horizon
(i.e., the oldest record still in the shard).

If the `--checkpoint-file` option is given, the updated checkpoints will be _appended_ to it
after successful completion. If you do this a lot, the file could potentially get really large.
