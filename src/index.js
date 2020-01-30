const fs = require("fs");
const readFromShard = require("./shard-reader");
const yargs = require("yargs");
const AWS = require("aws-sdk");
const { CallerError } = require("./error");
const { getFormatterOptions, getFormatter } = require("./formatter");

async function dumpStream(args) {
    const kinesis = new AWS.Kinesis({
        apiVersion: "2013-12-02",
        region: args.region
    });
    const shardIds = args.all ? await listShards(kinesis, args) : args.shard;
    if (!shardIds || !shardIds.length) {
        throw new CallerError("No shard IDs specified");
    }

    const checkpoints = await getCheckpoints(args);
    const streamName = args["stream-name"];
    const newCheckpoints = await Promise.all(
        shardIds.map(shardId =>
            dumpShard(
                kinesis,
                args,
                getFormatter(args.dataFormat),
                shardId,
                checkpoints[`${streamName}:${shardId}`]
            )
        )
    );
    if (args.checkpointFile) {
        const time = new Date().toISOString();
        await appendFile(
            args.checkpointFile,
            newCheckpoints
                .map(cp => ({ time, ...cp }))
                .map(cp => `${JSON.stringify(cp)}\n`)
                .join(""),
            "utf8"
        );
    }
}

async function getCheckpoints(args) {
    if (args.checkpointFile) {
        let content;
        try {
            content = await readFile(args.checkpointFile, "utf8");
        } catch (error) {
            if (error.code === "ENOENT") {
                return {};
            }
            throw error;
        }
        const checkpointLines = content
            .split(/[\r\n]+/)
            .map(line => line.trim())
            .filter(line => line.length)
            .map(line => {
                return JSON.parse(line);
            });
        return checkpointLines.reduce(
            (checkpoints, { streamName, shardId, ...checkpoint }) => {
                checkpoints[`${streamName}:${shardId}`] = checkpoint;
                return checkpoints;
            },
            {}
        );
    }
    return {};
}

function appendFile(...args) {
    return new Promise((resolve, reject) => {
        fs.appendFile(...args, (error, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
        });
    });
}

function readFile(...args) {
    return new Promise((resolve, reject) => {
        fs.readFile(...args, (error, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
        });
    });
}

async function listShards(kinesis, args) {
    const streamName = args["stream-name"];
    return (await kinesis
        .listShards({
            StreamName: streamName
        })
        .promise()).Shards.map(shard => shard.ShardId);
}

async function dumpShard(kinesis, args, formatter, shardId, checkpoint) {
    const streamName = args["stream-name"];
    let reader = readFromShard(kinesis, streamName, shardId, checkpoint);
    while (reader.next) {
        reader = await reader.next();
        const records = reader.records;
        records.forEach(record => {
            const output = {
                _shardId: shardId,
                _streamName: streamName,
                ...record
            };
            output._data = formatter(output.Data);
            delete output.Data;
            if (args.json) {
                console.log(JSON.stringify(output, null, 4));
            } else if (args.jsonl) {
                console.log(JSON.stringify(output));
            } else {
                console.log(output);
            }
        });
    }
    return {
        streamName,
        shardId,
        ...reader.checkpoint
    };
}

function parseArgs() {
    return yargs
        .command(
            "dump <stream-name>",
            "Dump records from the specified stream",
            _yargs =>
                _yargs
                    .positional("stream-name", {
                        description: "The name of the stream to read"
                    })
                    .option("r", {
                        alias: "region",
                        required: true,
                        type: "string",
                        description: "The AWS region of the stream"
                    })
                    .option("s", {
                        alias: "shard",
                        description:
                            "Specify the name of the shard to read from. Give this option multipe times to read from multiple shards.",
                        type: "string",
                        array: true
                    })
                    .option("a", {
                        alias: "all",
                        conflicts: "s",
                        type: "boolean",
                        description: "Read from all shards in the given stream"
                    })
                    .option("json", {
                        description:
                            "Output the records in pretty-printed JSON. The default is to use console.log to format the output",
                        type: "boolean"
                    })
                    .option("jsonl", {
                        alias: "json-lines",
                        description:
                            "Output the records in JSON lines, one line per record",
                        type: "boolean",
                        conflicts: "json"
                    })
                    .option("c", {
                        alias: "checkpoint-file",
                        description:
                            "Read and use initial checkpoints from the given file, if present. Write checkpoints to the specified file if everything completes successful.",
                        type: "string"
                    })
                    .option("d", {
                        alias: "data-format",
                        // prettier-ignore
                        choices: getFormatterOptions(),
                        default: "utf-8",
                        description:
                            "Specifies how to handle the data payload of kinesis records."
                    })
                    .strict()
        )
        .option("debug", {
            hidden: true,
            type: "boolean"
        })
        .strict()
        .demandCommand(
            1,
            1,
            "You must specify a command",
            "You must specify exactly one command"
        ).argv;
}

async function main() {
    const args = parseArgs();
    args._ = Array.isArray(args._) ? args._ : [args._];
    const [command] = args._;
    try {
        switch (command) {
            case "dump":
                await dumpStream(args);
                return;

            default:
                throw new Error(`Failed to handle command ${command}`);
        }
    } catch (error) {
        if (args.debug) {
            console.error(error);
        } else {
            console.error(
                `An error occurred (${error.name}): ${error.message}`
            );
        }
        process.exitCode = 1;
    }
}

main();