class CallerError extends Error {
    constructor(message, props = {}) {
        super(message);
        this.name = "CallerError";
        Error.captureStackTrace(this, this.constructor);
        Object.assign(this, props);
    }
}

module.exports = {
    CallerError
};
