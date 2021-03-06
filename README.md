# read-kinesis

Read records from the shards of an AWS Kinesis stream and dump them to standard output.

## Usage

```console
> read-kinesis dump <stream-name> [options]

> # Read from all shards in the specified stream (based on list-shards)
> read-kinesis dump $STREAM_NAME --all

> # Read from specified shards in the stream
> read-kinesis dump $STREAM_NAME --shard shardId-000000000000 --shard shardId-000000000001
```

## Long Wait

If you have a very sparse stream (relatively few records on it), it might take a long time to start getting
any records, or even just to determine there are no records. This has to do with the way Kinesis timeslices
the stream and iterates over timeslices. If you don't have any checkpoints, or your check point is from a
long time ago, the reader may have to read over a bunch of empty timeslices before reaching any records
or the end of the stream. You can add the `--verbose` flag to get some status output to STDERR to see
what's going on.

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

You can also use the `--assume` option to specify the ARN of an IAM role to assume. Specify the option multiple times to specify a chain of
roles that should be assumed. For instance, if you're authorized to assume role A but not role B, but role A is authorized to assume role B,
you can use role B with `--assume A --assume B`.

## CLI Options

| Option                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-r REGION`<br />`--region REGION`      | The AWS region of the stream. **required**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `-s SHARD-ID`<br />`--shard SHARD-ID`   | Specify the name of the shard to read from. Give this option multipe times to read from multiple shards.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `-a`<br />`--all`                       | Read from all shards in the given stream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `-t TIME`<br />`--timestamp TIME`       | Specify a time to start reading from. You can use an ISO-8601 date (e.g., "2020-01-30" or "2020-01-30T12:34:56-0400"), or a "human" duration as parsable by [parse-human-relative-time](https://www.npmjs.com/package/parse-human-relative-time) (e.g, "1 hour ago", "last monday"). Note that this will ignore any existing checkpoints, but wil **still update checkpoints** at the end. This means if you specified time is later than your previous checkpoints, you'll end up missing the records in between the last checkpoint and the timestamp. |
| `-c`<br />`--checkpoint`                | Read and use initial checkpoints from file, if present. Write checkpoints to file if everything completes successful. Use the --checkpoint-file to specify the file to use, the default is `.checkpoints`.                                                                                                                                                                                                                                                                                                                                               |
| `--profile`                             | Use the specified profile from your shared credentials file (typically ~/.aws/credentials) for AWS credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--assume`                              | Assume the AWS role specified by this ARN for reading from Kinesis. You can specify this option multiple times to specify a chain of roles that will be assumed                                                                                                                                                                                                                                                                                                                                                                                          |
| `--json`                                | Output the records in pretty-printed JSON. The default is to use console.log to format the output                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--jsonl`<br />`--json-lines`           | Output the records in JSON lines, one line per record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `-d FORMAT`<br />`--data-format FORMAT` | Specifies how to handle the data payload of kinesis records. See "Data Format" section above                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--checkpoint-file FILE`                | Specify the path to the checkpoint file to use. Only relevant if the `--checkpoint` option is given. (_default:_ `.checkpoints`)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--trim-checkpoints`                    | Overwrite the contents of the checkpoint-file instead of appending to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--stop-after TIMESTAMP`                | Optionally specify a timestamp to stop reading after. Applies individually to each shard read. Reader will read and output an entire batch of records at a time as usual, but will terminate once it gets a batch whose last record is greater than the specified timestamp. Note that this is based on the records "ApproximateArrivalTimestamp" value.                                                                                                                                                                                                 |
