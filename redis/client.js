const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const Redis = require("redis");

const ENVIRONMENT = process.env.ENVIRONMENT;
const NODE_ENV = process.env.NODE_ENV;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

var redisClient;

if (NODE_ENV == "production" || ENVIRONMENT === "LOCAL") {
  redisClient = Redis.createClient({
    host: REDIS_HOST,
    port: 6379,
    password: REDIS_PASSWORD,
    tls: (ENVIRONMENT == "LOCAL" ? undefined : {}),
    retryStrategy: function (options) {
        if (options.error && options.error.code === "ECONNREFUSED") {
            // End reconnecting on a specific error and flush all commands with
            // a individual error
            return new ConfirmedError(500, 100, "Redis - The server refused the connection");
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            // End reconnecting after a specific timeout and flush all commands
            // with a individual error
            return new ConfirmedError(500, 101, "Redis - Retry time exhausted");
        }
        if (options.attempt > 10) {
            // End reconnecting with built in error
            return undefined;
        }
        // reconnect after
        return Math.min(options.attempt * 100, 3000);
    }
  });
}
else {
  redisClient = require("redis-mock").createClient();
}

module.exports = redisClient;