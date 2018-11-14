const Logger = require("./logger.js");

const awsSdk = require("aws-sdk");
const awsParamEnv = require("aws-param-env");

const ENVIRONMENT = process.env.ENVIRONMENT || fatalError("FATAL - ENVIRONMENT not defined on startup.");
const NODE_ENV = process.env.NODE_ENV || fatalError("FATAL - NODE_ENV not defined on startup.");

const PARAMS_MAP = {
  "COMMON": [
    "DOMAIN",
    "CLIENT_BUCKET",
    "SURICATA_BUCKET",
    "SPEED_TEST_BUCKET",
    "PG_HOST",
    "AES_EMAIL_KEY",
    "AES_RECEIPT_DATA_KEY",
    "AES_P12_KEY",
    "IOS_SUBSCRIPTION_SECRET",
    "STRIPE_SECRET",
    "STRIPE_PUBLIC_KEY",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_LICENSE_KEY",
    "GOOGLE_PACKAGE_NAME",
    "TRIAL_DAYS",
    "THROTTLE_LIMIT_GIGABYTES",
    "EXPIRED_THROTTLE_KBPS",
    "OVERAGE_THROTTLE_KBPS",
    "EMAIL_SALT",
    "REDIS_HOST",
    "REDIS_PASSWORD"
  ],
  "ADMIN": [
    "PG_ADMIN_PASSWORD",
    "CA_PASSWORD",
    "CERT_ACCESS_SECRET",
    "ADMIN_SESSION_SECRET"
  ],
  "MAIN": [
    "PG_MAIN_PASSWORD",
    "USER_SESSION_SECRET"
  ],
  "RENEWER": [
    "PG_RENEWER_PASSWORD",
    "START_DAYS_AGO",
    "END_DAYS_LATER"
  ],
  "SUPPORT": [
    "PG_SUPPORT_PASSWORD",
    "SUPPORT_SESSION_SECRET"
  ],
  "HELPER": [
    "PG_HELPER_PASSWORD"
  ],
  "WEBHOOK": [
    "PG_WEBHOOK_PASSWORD",
    "STRIPE_WEBHOOK_SECRET"
  ],
  "DEBUG": [
    "PG_DEBUG_PASSWORD"
  ]
}

// Load the parameters from parameter store
function initializeEnvironment(paramPaths) {
  if (NODE_ENV === "production") {
    paramPaths.forEach((paramPath) => {
      awsParamEnv.load( "/" + ENVIRONMENT + "/" + paramPath);
    });
  }
  else if (ENVIRONMENT !== "LOCAL") {
    paramPaths.forEach((paramPath) => {
      awsParamEnv.load( "/" + ENVIRONMENT + "/TEST/" + paramPath);
    });
  }
  // Double check that all required environment variables are loaded
  paramPaths.forEach((paramPath) => {
    var keysToCheck = PARAMS_MAP[paramPath];
    if (keysToCheck == null || keysToCheck.length == 0) {
      fatalError("FATAL - Invalid param path: " + paramPath);
    }
    keysToCheck.forEach((key) => {
      if (!process.env[key]) {
        fatalError("FATAL - " + key + " not defined on startup.");
      }
    })
  })
}

function fatalError(message) {
  Logger.error(message);
  process.exit(1);
}

module.exports = initializeEnvironment;