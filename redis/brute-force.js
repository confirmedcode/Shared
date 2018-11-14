const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const RedisClient = require("./client.js");
const Secure = require("../utilities/secure.js");
const ExpressBrute = require("express-brute");
const RedisStore = require("express-brute-redis");
const moment = require("moment");

const ENVIRONMENT = process.env.ENVIRONMENT;
const NODE_ENV = process.env.NODE_ENV;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const ONE_SECOND = 1 * 1000;
const ONE_MINUTE = 1 * 60 * 1000;

const store = new RedisStore({
  client: RedisClient,
  prefix: "b:" // "brute force"
});

const failCallback = function (request, response, next, nextValidRequestDate) {
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

const handleStoreError = function (error) {
  throw new ConfirmedError(500, -1, "Error with ExpressBrute", error);
};

function makeBruteForce(freeRetries = 500, minWaitMillis = 0.5 * ONE_SECOND, maxWaitMillis = 15 * ONE_MINUTE) {
  return new ExpressBrute(
    store,
    {
      freeRetries: freeRetries,
      minWait: minWaitMillis,
      maxWait: maxWaitMillis,
      failCallback: failCallback,
      handleStoreError: handleStoreError
    }
  );
}

module.exports = makeBruteForce;