const { CallerError } = require("./error");

function binaryFormatter(buffer) {
    return buffer;
}

function hexFormatter(buffer) {
    return buffer.toString("hex");
}

function base64Formatter(buffer) {
    return buffer.toString("base64");
}

function utf8Formatter(buffer) {
    return buffer.toString("utf8");
}

function jsonFormatter(buffer) {
    return JSON.parse(buffer.toString("utf8"));
}

const formatters = {
    binary: binaryFormatter,
    bin: binaryFormatter,
    buf: binaryFormatter,
    buffer: binaryFormatter,
    hex: hexFormatter,
    "base-64": base64Formatter,
    base64: base64Formatter,
    b64: base64Formatter,
    "utf-8": utf8Formatter,
    utf8: utf8Formatter,
    json: jsonFormatter
};
const formatterOptions = Object.keys(formatters);

module.exports = {
    getFormatterOptions: () => formatterOptions,
    getFormatter: format => {
        const formatter = formatters[format];
        if (formatter == null) {
            throw new CallerError(`Invalid format name specified: ${format}`, {
                format
            });
        }
        return formatter;
    }
};
