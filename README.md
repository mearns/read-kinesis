# kinesis-reader

Read records from the shards of an AWS Kinesis stream and dump them to standard output.

## Usage

```console
> ./kinesis-reader.sh dump <stream-name> [options]

> # Read from all shards in the specified stream (based on list-shards)
> ./kinesis-reader.sh dump $STREAM_NAME --all

> # Read from specified shards in the stream
> ./kinesis-reader.sh dump $STREAM_NAME --shard shardId-000000000000 --shard shardId-000000000001
```

## Output

For each record read from Kinesis, the record is presented with all of it's fields and some additional
fields beginning with a `_` prefix. These fields are as follows:

| Record field  | Description                                        |
| ------------- | -------------------------------------------------- |
| `_shardId`    | The shard it came from (see note 1, below)         |
| `_streamName` | The name of the stream                             |
| `_data`       | The data payload of the record (see note 2, below) |

### Notes:

1. If the `--shard` option is used, the value of the `__shardId` field is the value given in
   the option. Kinesis supports some interpretation of the shardId, so multiple values may alias
   to the same shard. E.g., `--shard 0` and `--shard 000` both refer to the shard whose _actual_
   shard ID is "shardId-000000000000".

2. The `Data` field that comes from Kinesis is _not_ shown as it's not particularly useful, being
   replaced instead with the `_data` field whose value depends on the `--data-format` as described
   in the "Data Format" section.

## Data Format

Kinesis record payloads are binary data. By default, this tool assumes the binary data
is utf8 encoded text, and attempts to decode it as such. You can change the behavior using the
`--data-format` option (`-d` for short). The following options are available:

| `--data-format` arguments | Description                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `bin`                     | Presents the data as a Buffer of octets                                               |
| `hex`                     | Presents the data as a hex string                                                     |
| `base64`                  | Presents the data as a base64 string                                                  |
| `utf8`                    | Parses the data as utf8 and presents the text                                         |
| `json`                    | Parses the data as utf8 encoded JSON and presents it as the JSON value (not a string) |

## Checkpoints

A checkpoint describes where the reader leftoff in a particular shard (in a particular stream).
You can add the `--checkpoint` option to specify that checkpoints should be used. When given,
checkpoints are loaded from the checkpoint file, if it exists (the default checkpoint file is
`.checkpoints` in the current directory, you can use the `--checkpoint-file` option to specify
an alternate). If no checkpoints are found for a shard, it starts at the trim horizon (i.e.,
the oldest record currently in the shard).

After reading completes successfully, if the `--checkpoint` option is given, then updated
checkpoints are appended to the checkpoint file, indicating the furthest that the command read
in each shard so that subsequent commands can pick up where it left off.

The checkpoint file is appended to by default, so it could potentially get really big. Use
the `--trim-checkpoints` option to overwrite the entire file, instead.

## Credentials / Authorization

You'll need to have AWS credentials authorized for reading from the specified Kinesis stream. There
are various ways to provide these; see
["Setting Credentials in Node.js"](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html)
in the AWS documentation for details. Here's a quick summary of your options (in order of precedence):

1. Define the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables (and
   optionally `AWS_SESSION_TOKEN`)
2. Your [credentials file](https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/credentials.html#credentials-file-format) (usually `~/.aws/credentials/`)

If you specify the `--profile` option to the command, it will use the specified profile from your
credentials file.
