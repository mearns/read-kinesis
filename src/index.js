#!/usr/bin/env node

const fs = require("fs");
const readFromShard = require("./shard-reader");
const yargs = require("yargs");
const AWS = require("aws-sdk");
const { CallerError } = require("./error");
const { getFormatterOptions, getFormatter } = require("./formatter");
const withRetry = require("./retry");

let logger = silentLogger;

function getCreds(args) {
    if (args.profile) {
        const {
            AccessKeyId: accessKeyId,
            SecretAccessKey: secretAccessKey,
            SessionToken: sessionToken
        } = new AWS.SharedIniFileCredentials({
            profile: args.profile
        });
        logger(`Loaded credentials for profile ${args.profile}`);
        return { accessKeyId, secretAccessKey, sessionToken };
    }
    return {};
}

async function optionallyAssumeRole(args, baseCreds) {
    if (args.assume) {
        return args.assume.reduce(async (promiseForPreviousCreds, roleArn) => {
            const prevCreds = await promiseForPreviousCreds;
            const sts = new AWS.STS({
                apiVersion: "2011-06-15",
                region: args.region,
                ...prevCreds
            });
            const creds = (await withRetry(() =>
                sts
                    .assumeRole({
                        RoleArn: roleArn,
                        RoleSessionName: `kinesis-reader-${new Date().getTime()}`
                    })
                    .promise()
            )).Credentials;
            logger(`Assumed role: ${roleArn}`);
            const {
                AccessKeyId: accessKeyId,
                SecretAccessKey: secretAccessKey,
                SessionToken: sessionToken
            } = creds;
            return { accessKeyId, secretAccessKey, sessionToken };
        }, Promise.resolve(baseCreds));
    }
    return baseCreds;
}

async function dumpStream(args) {
    const baseCreds = getCreds(args);
    const creds = await optionallyAssumeRole(args, baseCreds);
    const kinesis = new AWS.Kinesis({
        apiVersion: "2013-12-02",
        region: args.region,
        ...creds
    });
    const shardIds = args.all ? await listShards(kinesis, args) : args.shard;
    if (!shardIds || !shardIds.length) {
        throw new CallerError("No shard IDs specified");
    }
    logger("Will read from the following shards:", shardIds);

    const checkpointProvider = args.timestamp
        ? () => ({
              timestamp: args.timestamp
          })
        : await getCheckpoints(args).then(
              checkpoints => (streamName, shardId) =>
                  checkpoints[`${streamName}:${shardId}`]
          );
    const streamName = args["stream-name"];
    const newCheckpoints = await Promise.all(
        shardIds.map(shardId =>
            dumpShard(
                kinesis,
                args,
                getFormatter(args.dataFormat),
                shardId,
                checkpointProvider(streamName, shardId)
            )
        )
    );
    if (args.checkpoint) {
        const time = new Date().toISOString();
        const content = newCheckpoints
            .map(cp => ({ time, ...cp }))
            .map(cp => `${JSON.stringify(cp)}\n`)
            .join("");
        if (args.trimCheckpoints) {
            await writeFile(args.checkpointFile, content, "utf8");
        } else {
            await appendFile(args.checkpointFile, content, "utf8");
        }
    }
}

async function getCheckpoints(args) {
    if (args.checkpoint) {
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

function writeFile(...args) {
    return new Promise((resolve, reject) => {
        fs.writeFile(...args, (error, data) => {
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
        logger("Got one batch of records", {
            recordCount: records.length,
            shardId,
            streamName
        });
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
                        conflicts: "shard",
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
                        alias: "checkpoint",
                        type: "boolean",
                        description:
                            "Read and use initial checkpoints from file, if present. Write checkpoints to file if everything completes successful. " +
                            'Use the --checkpoint-file to specify the file to use, the default is ".checkpoints".'
                    })
                    .option("t", {
                        alias: "timestamp",
                        type: "string",
                        description:
                            "Specify a timestamp to start reading from. If you are using --checkpoints, this will ignore any " +
                            "existing checkpoints, but will still update checkpoints after completion. This could cause you to skip " +
                            "over records in between your previous checkpoint and the given timestamp."
                    })
                    .option("checkpoint-file", {
                        description:
                            "Specify the path to the checkpoint file to use. Only relevant if the --checkpoint option is given.",
                        type: "string",
                        default: ".checkpoints"
                    })
                    .option("trim-checkpoints", {
                        description:
                            "If set, overwrite the contents of the checkpoint-file instead of appending to it.",
                        type: "boolean",
                        implies: "checkpoint"
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
        .option("profile", {
            description:
                "Use the specified profile from your shared credentials file (typically ~/.aws/credentials) for AWS credentials"
        })
        .option("assume", {
            description:
                "Assume the AWS role specified by this ARN for reading from Kinesis. You can specify this option multiple " +
                "times to specify a chain of roles that will be assumed.",
            type: "string",
            array: true
        })
        .option("verbose", {
            type: "boolean",
            alias: "v",
            description: "Output messages to STDERR about what's happening"
        })
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
    logger = args.verbose ? verboseLogger : silentLogger;
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

function verboseLogger(message, ...meta) {
    console.error(message, ...meta);
}

function silentLogger() {}

main();
