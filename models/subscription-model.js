const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const Secure = require("../utilities/secure.js");
const Stripe = require("../utilities/stripe.js");
const Email = require("../utilities/email.js");
const Receipt = require("./receipt-model.js");
const User = require("./user-model.js");

// Local Variables
var successChecked = 0; // How many subscriptions succeeded updating in this job
var failedChecked = 0; // How many subscriptions failed updating in this job

// Constants
const ENVIRONMENT = process.env.ENVIRONMENT;
const AES_RECEIPT_DATA_KEY = process.env.AES_RECEIPT_DATA_KEY;
var gracePeriodDays = 3;
if (ENVIRONMENT === "DEVELOPMENT") {
  gracePeriodDays = 0;
}
const ONE_DAY_SECONDS = 86400;
const PLANS = {
  "all-annual": {
    isAll: true,
    name: "Pro Plan - Annual",
    description: "Unlimited VPN for Windows, Mac, iOS, and Android, with a maximum of five (5) devices connected simultaneously."
  },
  "all-monthly": {
    isAll: true,
    name: "Pro Plan - Monthly",
    description: "Unlimited VPN for Windows, Mac, iOS, and Android, with a maximum of five (5) devices connected simultaneously."
  },
  "ios-annual": {
    isAll: false,
    name: "iOS Plan - Annual",
    description: "Unlimited VPN for iPad and iPhone, with a maximum of three (3) devices connected simultaneously."
  },
  "ios-monthly": {
    isAll: false,
    name: "iOS Plan - Monthly",
    description: "Unlimited VPN for iPad and iPhone, with a maximum of three (3) devices connected simultaneously."
  },
  "android-annual": {
    isAll: false,
    name: "Android Plan - Annual",
    description: "Unlimited VPN for Android tablets and phones, with a maximum of three (3) devices connected simultaneously."
  },
  "android-monthly": {
    isAll: false,
    name: "Android Plan - Monthly",
    description: "Unlimited VPN for Android tablets and phones, with a maximum of three (3) devices connected simultaneously."
  }
};

class Subscription {
  
  constructor(subscriptionRow, filtered = false) {
    if (!subscriptionRow) {
      throw new ConfirmedError(500, 999, "Error creating subscription: Null subscription.");
    }

    this.planType = subscriptionRow.plan_type;
    this.receiptId = subscriptionRow.receipt_id;

    this.expirationDate = new Date(subscriptionRow.expiration_date);
    // expiration date we show users should subtract the grace period
    var expirationDateMinusGrace = new Date(subscriptionRow.expiration_date);
    expirationDateMinusGrace.setTime(expirationDateMinusGrace.getTime() - gracePeriodDays * ONE_DAY_SECONDS * 1000);
    this.expirationDateString = expirationDateMinusGrace.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    this.expirationDateMs = this.expirationDate.getTime()/1000;
    
    if (subscriptionRow.cancellation_date) {
      this.cancellationDate = new Date(subscriptionRow.cancellation_date);
      this.cancellationDateString = this.cancellationDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      this.cancellationDateMs = this.cancellationDate.getTime()/1000;
    }
    else {
      this.cancellationDate = null;
      this.cancellationDateString = null;
      this.cancellationDateMs = null;
    }
    
    if (!filtered) {
      this.planIsAll = PLANS[this.planType].isAll;
      this.planName = PLANS[this.planType].name;
      this.planDescription = PLANS[this.planType].description;
      this.userId = subscriptionRow.user_id;
      this.receiptDataEncrypted = subscriptionRow.receipt_data;
      this.receiptType = subscriptionRow.receipt_type;
      this.updated = new Date(subscriptionRow.updated);
      this.inTrial = subscriptionRow.in_trial;
      this.id = subscriptionRow.id;
      this.failedLastCheck = subscriptionRow.failed_last_check;
      this.renewEnabled = subscriptionRow.renew_enabled;
    }
    
  }
  
  get receiptData() {
    if (this.receiptDataEncrypted) {
      return Secure.aesDecrypt(this.receiptDataEncrypted, AES_RECEIPT_DATA_KEY);
    }
    else {
      return null;
    }
  }
  
  static getIfReceiptExists(receipt) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE receipt_id = $1 AND receipt_type = $2
      LIMIT 1`,
      [receipt.id, receipt.type])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error checking if receipt exists", error); 
      })
      .then( result => {
        if (result.rows.length === 0) {
          return false;
        }
        else {
          return new Subscription(result.rows[0]);
        }
      });
  }
  
  static getWithReceiptId(receiptId) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE receipt_id=$1`,
      [receiptId])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting subscription", error); 
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(400, 26, "Error getting subscription: no such subscription");
        }
        return new Subscription(result.rows[0]);
      });
  }
  
  static getWithUserAndReceiptId(user, receiptId) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE user_id=$1 AND
        receipt_id=$2`,
      [user.id, receiptId])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting subscription", error); 
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(400, 26, "Error getting subscription: no such subscription");
        }
        return new Subscription(result.rows[0]);
      });
  }
  
  static updateWithUserAndReceipt(user, receipt) {
    // add to the db with three day buffer, or if there is an existing user_id & receipt_id pair, then update its fields
    var receiptDataEncrypted = Secure.aesEncrypt(receipt.data.toString(), AES_RECEIPT_DATA_KEY);
    return Database.query(
      `INSERT INTO subscriptions(user_id, plan_type, receipt_id, receipt_data, expiration_date, cancellation_date, receipt_type, in_trial)
      VALUES($1, $2, $3, $4, to_timestamp($5) + interval '1 day' * $10, to_timestamp($6), $7, $8)
      ON CONFLICT ON CONSTRAINT subscriptions_receipt_id_pkey DO UPDATE
      SET 
        user_id = $1,
        plan_type = $2,
        receipt_data = $4,
        expiration_date = to_timestamp($5) + interval '1 day' * $10,
        cancellation_date = to_timestamp($6),
        updated = to_timestamp($9),
        receipt_type = $7,
        in_trial = $8 
      RETURNING *`,
      [user.id, receipt.planType, receipt.id, receiptDataEncrypted, receipt.expireDateMs/1000, receipt.cancelDateMs == null ? null : receipt.cancelDateMs/1000, receipt.type, receipt.inTrial, Date.now()/1000, gracePeriodDays])
      .catch( error => {
        throw new ConfirmedError(500, 8, "Error creating/updating subscription", error); 
      })
      .then( result => {
        if (result.rowCount !== 1) {
          throw new ConfirmedError(500, 8, "Error creating/updating subscription: No subscription created/updated");
        }
        var subscription = new Subscription(result.rows[0]);
        return subscription;
      });
  }
  
  sendEmailIfNeeded() {
    // Only notify on Stripe
    if (this.receiptType !== "stripe") {
      return true;
    }
    var now = new Date();
    var threeDaysAgo = (new Date()).setDate(now.getDate() - 3);
    var tenDaysAgo = (new Date()).setDate(now.getDate() - 10);
    // Expired more than 3 days ago and emailed more than 10 days ago and wasn't explicitly cancelled
    if (this.expirationDate < threeDaysAgo && this.lastExpireEmailDate < tenDaysAgo && this.cancellationDate == null) {
      return User.getWithId(this.userId)
      .then( user => {
        return Email.sendExpired(user.email);
      })
      .then(result => {
        return Database.query(
          `UPDATE subscriptions 
          SET last_expire_email_date = now()
          WHERE receipt_id = $1
          RETURNING *`,
          [this.receiptId])
          .catch( error => {
            throw new ConfirmedError(500, 8, "Error updating last expire email date", error); 
          })
          .then( result => {
            if (result.rowCount !== 1) {
              throw new ConfirmedError(500, 26, "Couldn't update last expire email date for " + this.receiptId);
            }
            return new Subscription(result.rows[0]);
          });
      });
    }
    return true;
  }
  
  updateWithReceipt(receipt) {
    var receiptDataEncrypted = Secure.aesEncrypt(receipt.data, AES_RECEIPT_DATA_KEY);
    return Database.query(
      `UPDATE subscriptions 
      SET receipt_data = $1,
          expiration_date = to_timestamp($2) + interval '1' day * $8,
          cancellation_date = to_timestamp($3),
          receipt_type = $4,
          in_trial = $5,
          failed_last_check = false,
          renew_enabled = $6,
          updated = now()
      WHERE receipt_id = $7
      RETURNING *`,
      [receiptDataEncrypted,
        receipt.expireDateMs/1000,
        receipt.cancelDateMs == null ? null : receipt.cancelDateMs/1000,
        receipt.type,
        receipt.inTrial,
        receipt.renewEnabled,
        receipt.id,
        gracePeriodDays])
    .catch( error => {
      throw new ConfirmedError(500, 8, "Error updating subscription with receipt", error); 
    })
    .then( result => {
      if (result.rowCount !== 1) {
        throw new ConfirmedError(500, 26, "Couldn't update receipt for: " + this.receiptId);
      }
      return new Subscription(result.rows[0]);
    });
  }
  
  setFailed(bool) {
    return Database.query(
      `UPDATE subscriptions 
      SET failed_last_check = $1, updated = now() 
      WHERE receipt_id = $2 
      RETURNING *`,
      [bool, this.receiptId])
      .catch( error => {
        Logger.error("ERROR Couldn't set failed_last_check for: " + this.receiptId, error); 
      })
      .then(result => {
        if (result.rowCount !== 1) {
          Logger.error("ERROR Couldn't set failed_last_check for: " + this.receiptId);
        }
        else {
          return new Subscription(result.rows[0]);
        }
      });
  }
  
  static renewFailed() {
    Logger.info("Checking for failed subscription checks.");
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE failed_last_check = true`)
    .catch( error => {
      throw new ConfirmedError(500, 26, "Error getting failed subscriptions", error); 
    })
    .then( failedSubscriptionRows => {
      Logger.info("Found " + failedSubscriptionRows.rows.length + " failed subscription checks.");
      return makeRenewChainFromRows(failedSubscriptionRows);
    })
    .then(() => {
      Logger.info("Finshed renewing failed subscriptions.");
    })
    .catch( error => {
      Logger.error("ERROR: Failed to get failed subscriptions for failed check:" + error);
    });
  }
  
  static renewUser(id) {
    Logger.info("Checking one user's subscriptions: " + id);
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE user_id = $1`,
      [id])
    .catch( error => {
      throw new ConfirmedError(500, 26, "Error getting subscriptions for user", error); 
    })
    .then( subscriptionRows => {
      Logger.info("Found " + subscriptionRows.rows.length + " subscriptions.");
      return makeRenewChainFromRows(subscriptionRows);
    })
    .then( () => {
      Logger.info("Finshed renewing one user's subscriptions.");
    })
    .catch( error => {
      Logger.error("ERROR: Failed to get subscriptions for user renewal." + error);
    });
  }
  
  static renewRange(startDaysAgo, endDaysLater) {
    successChecked = 0;
    failedChecked = 0;
    Logger.info(`Checking for subscriptions expiring between ${startDaysAgo} days ago and ${endDaysLater} days in the future`);
    const now = Date.now()/1000;
    const startDaysAgoEpoch = now - ONE_DAY_SECONDS * startDaysAgo;
    const endDaysLaterEpoch = now + ONE_DAY_SECONDS * endDaysLater;
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE
      (
        to_timestamp($1) < expiration_date AND expiration_date < to_timestamp($2)
      )
      OR
        failed_last_check = true`,
      [startDaysAgoEpoch, endDaysLaterEpoch]
    )
    .catch( error => {
      throw new ConfirmedError(500, 26, `Failed to get subscriptions: ${error}`); 
    })
    .then( subscriptionRows => {
      Logger.info("Found " + subscriptionRows.rows.length + " subscriptions.");
      return makeRenewChainFromRows(subscriptionRows);
    })
    .catch( error => {
      Logger.error(`ERROR: Failed to get subscriptions for days range: ${error}`);
    })
    .then( () => {
      Logger.info("Finshed renewing subscriptions in days range.");
      return {
        success: successChecked,
        fail: failedChecked
      };
    });
  }
  
  static renewAll() {
    successChecked = 0;
    failedChecked = 0;
    Logger.info("Checking for subscriptions.");
    return Database.query("SELECT * FROM subscriptions")
    .catch( error => {
      throw new ConfirmedError(500, 26, "Failed to get all subscriptions", error); 
    })
    .then( subscriptionRows => {
      Logger.info("Found " + subscriptionRows.rows.length + " subscriptions.");
      return makeRenewChainFromRows(subscriptionRows);
    })
    .catch( error => {
      Logger.error("ERROR: Failed to get subscriptions for all check. " + error);
    });
  }
  
}

function makeRenewChainFromRows(subscriptionRows) {
  let chain = Promise.resolve();
  for (const subscriptionRow of subscriptionRows.rows) {
    var subscription;
    chain = chain
      .then(() => {
        subscription = new Subscription(subscriptionRow);
        // make an updated Receipt from the subscription
        Logger.info("Renewing " + subscription.receiptId);
        if (subscription.receiptType === "stripe") {
          return Stripe.getSubscription(subscription.receiptId)
            .then(stripeSubscription => {
              return Receipt.createWithStripe(stripeSubscription);
            });
        }
        else {
          return Receipt.createWithIAP(subscription.receiptData, subscription.receiptType);
        }
      })
      .then( receipt => {
        return subscription.updateWithReceipt(receipt);
      })
      .then( updatedSubscription => {
        successChecked = successChecked + 1;
        Logger.info("Subscription updated for ID: " + updatedSubscription.receiptId);
        return updatedSubscription;
      })
      .catch( error => {
        if (error.statusCode == 200) {
          Logger.info("INFO: Acceptable error updating ID " + subscription.receipt_id + ": " + error.message + " - " + error.raw);
          successChecked = successChecked + 1;
        }
        else {
          Logger.error("ERROR: Error updating ID " + subscription.receiptId + ": " + error.message + " - " + error.stack);
          failedChecked = failedChecked + 1;
          subscription.setFailed(true);
        }
      });
  }
  return chain;
}

module.exports = Subscription;