const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const RedisClient = require("./client.js");
const Secure = require("../utilities/secure.js");
const ExpressRateLimit = require("express-rate-limit");
const RateLimitRedis = require("rate-limit-redis");
const moment = require("moment");

const ENVIRONMENT = process.env.ENVIRONMENT;
const NODE_ENV = process.env.NODE_ENV;
const REDIS_SALT = process.env.REDIS_SALT;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const ONE_SECOND = 1 * 1000;
const ONE_MINUTE = 1 * 60 * 1000;

var bruteApiCount = 0;

const store = new RateLimitRedis({
  expiry: 60,
  resetExpiryOnChange: false,
  prefix: "erl:", // "express rate limit",
  client: RedisClient
});

const failCallback = function (request, response, next) {
  var nextValidRequestDate = request.rateLimit.resetTime;
  var humanTime = moment(nextValidRequestDate).fromNow();
  return response.format({
    json: () => {
      response.status(429).json({
        code: 999,
        message: "Too many requests in this time frame.",
        nextValidRequestDate: nextValidRequestDate,
        nextValidRequestDateHuman: humanTime
      });
    },
    html: () => {
      request.flashRedirect("error", "Too many requests in this time frame. Try again " + humanTime + "." , "notification");
    }
  });
};

function makeBruteForce(freeRetries = 500) {
  bruteApiCount = bruteApiCount + 1;
  var thisApiCount = bruteApiCount; // create a copy of bruteApiCount for this scope
  return new ExpressRateLimit({
    max: freeRetries,
    windowMs: 60000,
    statusCode: 429,
    headers: true,
    keyGenerator: function (request) {
        return Secure.hashSha512(request.ip, REDIS_SALT) + "-" + thisApiCount;
    },
    handler: failCallback,
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    store: store
  });
}

module.exports = makeBruteForce;