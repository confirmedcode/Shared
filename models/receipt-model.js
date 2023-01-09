const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const rp = require("request-promise");
const errors = require("request-promise/errors");
const crypto = require("crypto");

// Constants
const ENVIRONMENT = process.env.ENVIRONMENT;
const NODE_ENV = process.env.NODE_ENV;
const IOS_SUBSCRIPTION_SECRET = process.env.IOS_SUBSCRIPTION_SECRET;
const ITUNES_PROD_URL = "https://buy.itunes.apple.com/verifyReceipt";
const ITUNES_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME;
const GOOGLE_LICENSE_KEY = process.env.GOOGLE_LICENSE_KEY;
const GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/token";
const TEST_ANDROID_RECEIPT_ID = "GPA.3330-7836-8005-98670";
const TEST_IOS_RECEIPT_ID = "1000000386259702";
const IOS_PRODUCT_ID_TO_PLAN_TYPE = {
  "LockdownProAnnualLTO": "all-annual",
  "TunnelsiOSUnlimitedMonthly": "ios-monthly",
  "TunnelsiOSUnlimited": "ios-annual",
  "UnlimitedTunnels": "all-monthly",
  "AnnualUnlimitedTunnels": "all-annual",
  "LockdowniOSVpnMonthly": "ios-monthly",
  "LockdowniOSVpnAnnual": "ios-annual",
  "LockdowniOSVpnMonthlyPro": "all-monthly",
  "LockdowniOSVpnAnnualPro": "all-annual"
};
const ANDROID_PRODUCT_ID_TO_PLAN_TYPE = {
  "paid_sub": "android-monthly",
  "paid_sub_annual": "android-annual",
  "unlimitedtunnels": "all-monthly",
  "androidtunnels": "android-monthly",
  "androidtunnelsannual": "android-annual",
  "unlimitedtunnelsannual": "all-annual"
};

class Receipt {

  constructor(type, id, planType, expireDateMs, cancelDateMs, inTrial, renewEnabled, data, expirationIntentCancelled = false) {
    this.type = type;
    if (id == TEST_IOS_RECEIPT_ID && (NODE_ENV !== "test" && NODE_ENV !== "development")) {
      throw new ConfirmedError(400, 57, "Not allowed to use the iOS test receipt in non-test environment.");
    }
    if (id == TEST_ANDROID_RECEIPT_ID && (NODE_ENV !== "test" && NODE_ENV !== "development")) {
      throw new ConfirmedError(400, 57, "Not allowed to use the Android test receipt in non-test environment.");
    }
    this.id = id;
    this.planType = planType;
    this.expireDateMs = expireDateMs;
    this.cancelDateMs = cancelDateMs;
    this.inTrial = inTrial;
    this.renewEnabled = renewEnabled;
    this.data = data;
    this.expirationIntentCancelled = expirationIntentCancelled;
  }

  static createWithStripe(stripeSubscription) {
    // Use startsWith to account for internationalization (all-monthly-GBP, all-annual-KRW, etc)
    var plan = "invalid";
    if (stripeSubscription.plan.id.startsWith("all-annual")) {
      plan = "all-annual";
    } else if (stripeSubscription.plan.id.startsWith("all-monthly")) {
      plan = "all-monthly";
    }
    return new Receipt("stripe",
      stripeSubscription.id,
      plan,
      stripeSubscription.status == "trialing" ? stripeSubscription.trial_end * 1000 : stripeSubscription.current_period_end * 1000,
      stripeSubscription.canceled_at == null ? null : stripeSubscription.canceled_at * 1000,
      stripeSubscription.status == "trialing",
      stripeSubscription.canceled_at == null,
      JSON.stringify(stripeSubscription),
      stripeSubscription.canceled_at != null);
  }

  static createWithIAP(receiptData, receiptType, isIosSandbox = false, attempt = 0) {
    if (receiptData == "") {
      throw new ConfirmedError(400, 5, "Missing receipt for " + receiptType + " request");
    }
    if (receiptType == "ios") {
      return rp({
          method: "POST",
          uri: (isIosSandbox || NODE_ENV === "test") ? ITUNES_SANDBOX_URL : ITUNES_PROD_URL,
          body: {
            "receipt-data": receiptData,
            "password": IOS_SUBSCRIPTION_SECRET,
            "exclude-old-transactions": true
          },
          json: true
        })
        .catch(errors.StatusCodeError, function (error) {
          if (error.statusCode == 503) {
            if (attempt < 3) {
              Logger.info("Got a 503 from Apple, trying again with attempt: " + attempt);
              return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
            } else {
              Logger.info("Got a 503 from Apple, but failed 3 times, giving up.");
              throw new ConfirmedError(500, 10, "Error validating receipt with Apple.", error);
            }
          } else if (error.statusCode == 302) {
            if (attempt < 3) {
              Logger.info("Got a 302 from Apple, trying again with attempt: " + attempt);
              return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
            } else {
              Logger.info("Got a 302 from Apple, but failed 3 times, giving up.");
              throw new ConfirmedError(500, 10, "Error validating receipt with Apple.", error);
            }
          } else {
            throw new ConfirmedError(500, 10, "Error validating receipt with Apple, unrecognized statusCode", error);
          }
        })
        .catch(errors.RequestError, function (error) {
          if (attempt < 10) {
            Logger.info("Got a request error, trying again with attempt: " + attempt);
            if (error != null) {
              if (error.name != null) {
                Logger.info(error.name)
              }
              if (error.cause != null) {
                Logger.info(error.cause)
              }
            }
            return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
          } else {
            Logger.info("Got a request error, but failed 3 times, giving up.");
            throw new ConfirmedError(500, 10, "Error validating receipt with Apple.", error);
          }
        })
        .then(body => {
          // console.log(JSON.stringify(body, null, 2)) // DEBUG ONLY
          if (body.status != 0) {
            if (body.hasOwnProperty("data")) {
              // don't log user receiptData if Apple returned it to us
              body.data = "";
            }
            if (body.status == 21007 && isIosSandbox == false) {
              // if (ENVIRONMENT === "PROD") {
//                 throw new ConfirmedError(400, 9925, "Sandbox receipts are not valid for Production");
//               } else {
                // Received a sandbox receipt when trying prod url - try again with sandbox url
                return Receipt.createWithIAP(receiptData, receiptType, true);
                //}
            } else if (body.status == 21199 && body.is_retryable == true) {
              if (attempt < 3) {
                Logger.info("Got a retryable Apple error 21199, trying again with attempt: " + attempt);
                return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
              } else {
                Logger.info("Got a retryable Apple error, but failed 3 times, giving up.");
                throw new ConfirmedError(400, 10, "Error on response from Apple for receipt verification. Status: " + body.status + " body: " + JSON.stringify(body));
              }
            } else if (body.status == 21010 && body.is_retryable == false) {
              throw new ConfirmedError(200, 995, "Non-retryable Apple error, payment failed. Body: " + JSON.stringify(body));
            } else if (21100 <= body.status && body.status <= 21199 &&
              (body.is_retryable == true || !body.hasOwnProperty("is_retryable"))) {
              if (attempt < 3) {
                Logger.info("Got a potentially retryable Apple error, trying again with attempt: " + attempt + ". JSON: " + JSON.stringify(body));
                return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
              } else {
                Logger.info("Got a potentially retryable Apple error, but failed 3 times, giving up.");
                throw new ConfirmedError(400, 10, "Error on response from Apple for receipt verification. Status: " + body.status + " body: " + JSON.stringify(body));
              }
            } else {
              throw new ConfirmedError(400, 10, "Error on response from Apple for receipt verification. Status: " + body.status + " body: " + JSON.stringify(body));
            }
          }

          if (!body.hasOwnProperty("latest_receipt_info") || body.latest_receipt_info.length == 0) {
            throw new ConfirmedError(400, 9, "No subscription found in iOS receipt", body);
          }
          // choose the receipt with the latest expiration date
          var latestExpirationIndex = 0
          var latestExpirationMs = 0;
          for (var index = 0; index < body.latest_receipt_info.length; index++) {
            if (body.latest_receipt_info[index].hasOwnProperty("expires_date_ms") && body.latest_receipt_info[index].expires_date_ms > latestExpirationMs) {
              latestExpirationIndex = index;
              latestExpirationMs = body.latest_receipt_info[index].expires_date_ms
            }
          }
          var latestReceiptInfo = body.latest_receipt_info[latestExpirationIndex];

          if (!body.hasOwnProperty("pending_renewal_info") || body.pending_renewal_info.length == 0) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt missing pending_renewal_info", body);
          }
          var pendingRenewalInfo = body.pending_renewal_info[0];

          if (!latestReceiptInfo.hasOwnProperty("original_transaction_id")) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt missing original_transaction_id", body);
          }
          var planType = IOS_PRODUCT_ID_TO_PLAN_TYPE[latestReceiptInfo.product_id];
          if (planType == null) {
            throw new ConfirmedError(400, 49, "Unrecognized product ID from iOS receipt: " + latestReceiptInfo.product_id, body);
          }
          if (!latestReceiptInfo.hasOwnProperty("expires_date_ms")) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt missing expires_date_ms", body);
          }
          if (!latestReceiptInfo.hasOwnProperty("is_trial_period")) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt missing is_trial_period", body);
          }
          if (!pendingRenewalInfo.hasOwnProperty("auto_renew_status")) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt pending_renewal_info missing auto_renew_status", body);
          }
          if (!body.hasOwnProperty("latest_receipt")) {
            throw new ConfirmedError(400, 9, "iOS subscription receipt missing latest_receipt", body);
          }
          return new Receipt("ios",
            latestReceiptInfo.original_transaction_id,
            planType,
            latestReceiptInfo.expires_date_ms,
            latestReceiptInfo.cancellation_date_ms,
            latestReceiptInfo.is_trial_period,
            pendingRenewalInfo.auto_renew_status == 1 ? true : false,
            body.latest_receipt,
            pendingRenewalInfo.expiration_intent == 1 ? true : false);
        });
    } else if (receiptType == "android") {
      // decode the base64 from receiptData, extract fields, validate fields
      var receiptDecoded = null;
      var receipt = null;
      try {
        receiptDecoded = Buffer.from(receiptData, "base64").toString("utf-8");
        receipt = JSON.parse(receiptDecoded);
      } catch (error) {
        throw new ConfirmedError(400, 65, "Unable to decode Android base64 receipt sent from client", error);
      }
      if (receiptDecoded == null || receipt == null) {
        throw new ConfirmedError(400, 65, "Unable to decode Android base64 receipt sent from client");
      }
      let responseCode = receipt.RESPONSE_CODE;
      if (responseCode != 0) {
        throw new ConfirmedError(400, 64, "Android purchase failed on client side with response code: " + responseCode);
      }
      if (!receipt.hasOwnProperty("INAPP_PURCHASE_DATA")) {
        throw new ConfirmedError(400, 66, "Missing field INAPP_PURCHASE_DATA in android receipt");
      }
      if (!receipt.hasOwnProperty("INAPP_DATA_SIGNATURE")) {
        throw new ConfirmedError(400, 66, "Missing field INAPP_DATA_SIGNATURE in android receipt");
      }
      if (!verifyAndroidReceipt(GOOGLE_LICENSE_KEY, JSON.stringify(receipt.INAPP_PURCHASE_DATA), receipt.INAPP_DATA_SIGNATURE)) {
        throw new ConfirmedError(400, 63, "Android receipt does not match its signature");
      }
      let purchaseData = receipt.INAPP_PURCHASE_DATA;
      if (!purchaseData.hasOwnProperty("orderId")) {
        throw new ConfirmedError(400, 66, "Missing field orderId in android receipt");
      }
      if (!purchaseData.hasOwnProperty("purchaseToken")) {
        throw new ConfirmedError(400, 66, "Missing field purchaseToken in android receipt");
      }
      let purchaseToken = purchaseData["purchaseToken"];
      if (purchaseData["packageName"] != GOOGLE_PACKAGE_NAME) {
        throw new ConfirmedError(400, 66, "Android package name does not match. Received: " + purchaseData["packageName"]);
      }
      var productId = purchaseData["productId"];
      var planType = ANDROID_PRODUCT_ID_TO_PLAN_TYPE[productId];
      if (planType == null) {
        throw new ConfirmedError(400, 68, "Invalid android productId: " + purchaseData["productId"]);
      }

      // Get validated details from Google Play API
      // get a new access token using the refresh token
      return rp({
          method: "POST",
          uri: GOOGLE_OAUTH_URL,
          formData: {
            "grant_type": "refresh_token",
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": GOOGLE_REFRESH_TOKEN
          },
          json: true
        })
        .catch(error => {
          throw new ConfirmedError(500, 61, "Error getting access_token from Google with refresh_token", error);
        })
        .then(body => {
          // use access token to get user subscription with purchase_token
          let access_token = body.access_token;
          return rp({
            method: "GET",
            uri: "https://www.googleapis.com/androidpublisher/v3/applications/" +
              GOOGLE_PACKAGE_NAME + "/purchases/subscriptions/" +
              productId + "/tokens/" +
              purchaseToken +
              "?access_token=" + access_token,
            json: true
          });
        })
        .catch(errors.StatusCodeError, function (error) {
          if (error.statusCode == 503) {
            if (attempt < 3) {
              console.log("Got a 503 from Google, trying again with attempt: " + attempt);
              return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
            } else {
              console.log("Got a 503 from Google, but failed 3 times, giving up.");
              throw new ConfirmedError(500, 1002, "Error validating receipt with Google", error.stack);
            }
          } else if (error.statusCode == 410) {
            throw new ConfirmedError(200, 62, "Invalid purchase token.", error.stack);
          } else {
            throw new ConfirmedError(500, 621, "Error validating receipt with Google - unrecognized status code", error.stack)
          }
        })
        .catch(errors.RequestError, function (error) {
          if (attempt < 3) {
            console.log("Got a request error, trying again with attempt: " + attempt + " error: " + JSON.stringify(error));
            return Receipt.createWithIAP(receiptData, receiptType, isIosSandbox, attempt + 1);
          } else {
            console.log("Got a request error, but failed 3 times, giving up.");
            throw new ConfirmedError(500, 620, "Error validating receipt with Google", error.stack);
          }
        })
        .then(body => {
          if (body.paymentState == 0) {
            Logger.info("Android payment not received - still pending: " + purchaseData.orderId);
            // This flag is ambiguous from Google Play. Log but don't throw error because update of subscription expiration date should catch non-payment cases anyway.
            //throw new ConfirmedError(400, 67, "Android payment not received - still pending");
          }
          if (!body.hasOwnProperty("startTimeMillis")) {
            throw new ConfirmedError(400, 66, "Missing field startTimeMillis in android receipt");
          }
          if (!body.hasOwnProperty("expiryTimeMillis")) {
            throw new ConfirmedError(400, 66, "Missing field expiryTimeMillis in android receipt");
          }
          if (!body.hasOwnProperty("autoRenewing")) {
            throw new ConfirmedError(400, 66, "Missing field autoRenewing in android receipt");
          }
          if (!body.hasOwnProperty("orderId")) {
            throw new ConfirmedError(400, 66, "Missing field orderId in android receipt");
          }
          if (body.orderId.split("..")[0] != purchaseData.orderId) {
            throw new ConfirmedError(400, 69, "OrderId in client receipt and Google verified receipt do not match");
          }
          return new Receipt("android",
            purchaseData.orderId,
            planType,
            body.expiryTimeMillis,
            body.userCancellationTimeMillis,
            body.paymentState == 2,
            body.autoRenewing,
            receiptData,
            body.hasOwnProperty("cancelReason") && body.cancelReason == 0
          );
        });

    } else {
      throw new ConfirmedError(400, 11, "Invalid IAP receipt type: " + receiptType);
    }
  }

}

function verifyAndroidReceipt(publicKey, signedData, signature) {
  var decodedPublicKey = getPublicKey(publicKey);
  var verifier = crypto.createVerify("SHA1");
  verifier.update(signedData);
  return verifier.verify(decodedPublicKey, signature, "base64");
}

function getPublicKey(publicKey) {
  if (!publicKey) {
    return null;
  }
  var key = chunkSplit(publicKey, 64, "\n");
  var pkey = "-----BEGIN PUBLIC KEY-----\n" + key + "-----END PUBLIC KEY-----\n";
  return pkey;
}

function chunkSplit(str, len, end) {
  len = parseInt(len, 10) || 76;
  if (len < 1) {
    return false;
  }
  end = end || "\r\n";
  return str.match(new RegExp(".{0," + len + "}", "g")).join(end);
}

module.exports = Receipt;