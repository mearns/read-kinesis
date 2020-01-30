const MAX_RETRIES = 10;
const INITIAL_BACKOFF_MS = 10;
const BACKOFF_DITHER_FACTOR = 1;

function withRetry(f) {
    return withRetryRecursive(
        f,
        [],
        MAX_RETRIES,
        INITIAL_BACKOFF_MS,
        INITIAL_BACKOFF_MS * BACKOFF_DITHER_FACTOR
    );
}

module.exports = withRetry;

async function withRetryRecursive(
    f,
    prevErrors,
    retries,
    backoff,
    backoffDither
) {
    try {
        return await f();
    } catch (error) {
        if (error.retryable) {
            const allErrors = [...prevErrors, error];
            if (retries) {
                if (backoff) {
                    const dither = Math.floor(backoffDither * Math.random());
                    await wait(backoff + dither);
                }
                return withRetryRecursive(
                    f,
                    allErrors,
                    retries - 1,
                    backoff + backoff
                );
            }
            throw new OutOfRetriesError(error, prevErrors);
        }
        throw new NonRetryableError(error, prevErrors);
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(() => resolve(), ms));
}

class NonRetryableError extends Error {
    constructor(cause, prevErrors) {
        super(
            `Retryable caught a non-retryable error: ${cause.name}: ${cause.message}`
        );
        this.name = "NonRetryableError";
        Error.captureStackTrace(this, this.constructor);
        this.lastError = cause;
        this.cause = usefulCause(cause);
        this.prevErrors = prevErrors.map(usefulCause);
    }
}

class OutOfRetriesError extends Error {
    constructor(lastError, prevErrors) {
        const allErrors = [...prevErrors, lastError];
        super(
            `Ran out of retries after ${allErrors.length} error(s): ${[
                ...new Set(allErrors.map(e => e.name))
            ].join(", ")}`
        );
        this.name = "OutOfRetriesError";
        Error.captureStackTrace(this, this.constructor);
        this.lastError = lastError;
        this.cause = usefulCause(lastError);
        this.prevErrors = prevErrors.map(usefulCause);
    }
}

function usefulCause(cause) {
    if (Array.isArray(cause)) {
        return cause.map(usefulCause);
    }
    if (
        cause instanceof NonRetryableError ||
        cause instanceof OutOfRetriesError
    ) {
        return {
            ...without(cause, "cause", "lastError"),
            ...usefulCause(cause.lastError),
            wrappedBy: cause
        };
    }
    const { name, message, stack, ...other } = cause;
    return { name, message, stack, ...other };
}

function without(obj, ...props) {
    const res = { ...obj };
    for (const prop of props) {
        delete res[prop];
    }
    return res;
}

module.exports = withRetry;
