const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const fs = require("fs-extra");
const path = require("path");
const Database = require("../utilities/database.js");
const Secure = require("../utilities/secure.js");
const Email = require("../utilities/email.js");
const Stripe = require("../utilities/stripe.js");

// Constants
const AES_P12_KEY = process.env.AES_P12_KEY;
const AES_EMAIL_KEY = process.env.AES_EMAIL_KEY;
const EMAIL_SALT = process.env.EMAIL_SALT;

class User {
  
  constructor(userRow, accessDeleted = false) {
    if (!userRow) {
      throw new ConfirmedError(500, 999, "Error creating user: Null user.");
    }
    if (userRow.delete_date && accessDeleted == false) {
      throw new ConfirmedError(400, 999, "This user has been deleted and cannot be accessed.");
    }
    this.id = userRow.id;
    this.emailHashed = userRow.email;
    this.emailEncrypted = userRow.email_encrypted;
    this.passwordHashed = userRow.password;
    this.stripeId = userRow.stripe_id;
    this.emailConfirmed = userRow.email_confirmed;
    this.emailConfirmCode = userRow.email_confirm_code;
    this.passwordResetCode = userRow.password_reset_code;
    this.monthUsageMegabytes = userRow.month_usage_megabytes;
    this.monthUsageUpdate = new Date(userRow.month_usage_update);
    this.referralCode = userRow.referral_code;
    this.referredBy = userRow.referred_by;
    this.partnerCampaign = userRow.partner_campaign;
    this.createDate = new Date(userRow.create_date);
    this.deleteDate = userRow.delete_date ? new Date(userRow.delete_date) : null;
    this.deleteReason = userRow.delete_reason;
    this.doNotEmail = userRow.do_not_email;
    this.banned = userRow.banned;
    this.lockdown = userRow.lockdown;
  }
  
  get email() {
    if (this.emailEncrypted) {
      return Secure.aesDecrypt(this.emailEncrypted, AES_EMAIL_KEY);
    }
    else {
      return null;
    }
  }
  
  getStripeCurrency() {
    if (this.stripeId) {
      return Stripe.getCustomer(this.stripeId)
      .then(customer => {
        return customer.currency;
      });
    }
    else {
      return Promise.resolve(null);
    }
  }
  
  getActiveReferrals() {
    return Database.query(
      `SELECT
      	subscriptions.plan_type,
        subscriptions.in_trial,
      	users.email_encrypted
      FROM
      	users
      INNER JOIN subscriptions ON
      	subscriptions.user_id = users.id
    	AND
    	  users.referred_by = $1
      AND
        receipt_type = 'stripe'
    	AND
    	  cancellation_date IS NULL
      AND
        expiration_date > to_timestamp($2)`,      
      [this.id, Date.now()/1000])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting referrals for user", error); 
      })
      .then( result => {
        var referrals = {
          active: [],
          trial: []
        };
        result.rows.forEach(row => {
          var email = Secure.aesDecrypt(row.email_encrypted, AES_EMAIL_KEY);
          if (row.in_trial == true) {
            referrals.trial.push(email);
          }
          else {
            referrals.active.push(email);
          }
        });
        // calculate percent off
        var percentOff = 0;
        if (this.referredBy) {
          percentOff = percentOff + 10;
        }
        if (referrals.active) {
          percentOff = percentOff + referrals.active.length * 10;
        }
        percentOff = Math.min(percentOff, 100);
        referrals.percentOff = percentOff;
        return referrals;
      });
  }
  
  delete(reason, banned) {
    var promise = new Promise((resolve, reject) => {
      resolve("No stripeid for customer");
    });
    if (this.stripeId) {
      promise = Stripe.deleteCustomer(this.stripeId)
        .catch(error => {
          Logger.error("Error deleting Stripe customer and cancelling subscriptions at Stripe for: " + this.stripeId);
        });
    }
    return promise.then(result => {
      return Database.query("DELETE FROM subscriptions WHERE user_id=$1 RETURNING *", [this.id]);
    })
    .catch(error => {
      throw new ConfirmedError(500, 30, "Error deleting subscriptions", error);
    })
    .then(result => {
      return Database.query(
        `UPDATE users
          SET
            email_encrypted = NULL,
            password = NULL,
            stripe_id = NULL,
            month_usage_megabytes = 0,
            month_usage_update = now(),
            referred_by = NULL,
            create_date = now(),
            delete_date = now(),
            delete_reason = $1,
            banned = $2
          WHERE id = $3`,
      [reason, banned, this.id]);
    })
    .catch(error => {
      throw new ConfirmedError(500, 31, "Error deleting user", error);
    })
    .then(result => { 
      if (result.rowCount !== 1) {
        throw new ConfirmedError(400, 31, "Error deleting user: did not delete id: " + this.id);
      }
      return true;
    });
  }
  
  getPaymentMethods() {
    if (this.stripeId) {
      return Stripe.getPaymentMethods(this.stripeId);
    }
    else {
      return Promise.resolve([]);
    }
  }
  
  updateWithStripe(stripeSubscription) {
    var receipt = Receipt.createWithStripe(stripeSubscription);
    return Subscription.updateWithUserAndReceipt(this, receipt)
      .then( subscription => {
        return this;
      });
  }
  
  changePassword(currentPassword, newPassword) {
    return this.assertPassword(currentPassword)
      .then( passwordMatches => {
        return Secure.hashPassword(newPassword);
      })
      .then(newPasswordHashed => {
        return Database.query(
          `UPDATE users 
          SET password = $1
          WHERE id = $2
          RETURNING *`,
          [newPasswordHashed, this.id])
        .catch( error => {
          throw new ConfirmedError(500, 70, "Error changing user password", error);
        })
        .then( result => {
          if (result.rowCount !== 1) {
            throw new ConfirmedError(500, 71, "Error changing user password: no user changed.");
          }
          return true;
        });
      });
  }
  
  createStripeCustomer(source) {
    // if already has one, then don't create
    if (this.stripeId != null) {
      return Promise.resolve();
    }
    var stripeCustomer;
    return Stripe.createCustomer(this.id, source)
      .catch( error => {
        throw new ConfirmedError(500, 24, "Error creating Stripe customer", error);
      })
      .then( customer => {
        stripeCustomer = customer;
        return Database.query(
          `UPDATE users
          SET stripe_id = $1
          WHERE id = $2
          RETURNING *`,
          [customer.id, this.id]);
      })
      .catch( error => {
        throw new ConfirmedError(500, 23, "Error updating user with stripeid", error);
      })
      .then( result => {
        if (result.rowCount !== 1) {
          throw new ConfirmedError(500, 23, "Error updating user with stripeid: no user updated");
        }
        this.stripeId = stripeCustomer.id;
        return stripeCustomer;
      });
  }
  
  createStripeSubscription(source, plan, trial, browserLocale, paramLocale, is3ds) {
    return Stripe.hasSource(this.stripeId, source)
    .then( hasSource => {
      if (hasSource != true) {
        return Stripe.createSource(this.stripeId, source);
      }
      else {
        return Promise.resolve();
      }
    })
    .then( result => {
      return Stripe.setDefaultSource(this.stripeId, source);
    })
    .then( result => {
      return this.getActiveReferrals();
    })
    .then( referrals => {
      return Stripe.createSubscription(this.stripeId, this.id, plan, trial, browserLocale, paramLocale, this.referredBy, referrals, is3ds ? source : undefined);
    })
    .catch( error => {
      throw new ConfirmedError(500, 22, "Error creating subscription", error);
    })
    .then( stripeSubscription => {
      return this.updateWithStripe(stripeSubscription);
    });
    return p;
  }
  
  getKey(platform) {
    return this.getActiveSubscriptions()
      .then(activeSubscriptions => {
        if ( activeSubscriptions.length === 0 ) {
          throw new ConfirmedError(200, 6, "No active subscriptions");
        }
        // check that we have the correct plan for the key being requested
        var hasAllSub = false;
        var hasAndroidSub = false;
        var hasIosSub = false;
        activeSubscriptions.forEach((activeSubscription) => {
          var planType = activeSubscription.planType;
          if (planType == "all-monthly" || planType == "all-annual") {
            hasAllSub = true;
            hasAndroidSub = true;
            hasIosSub = true;
          }
          if (planType == "android-monthly" || planType == "android-annual" ) {
            hasAndroidSub = true;
          }
          if (planType == "ios-monthly" || planType == "ios-annual" ) {
            hasIosSub = true;
          }
        });
        // Get the latest non-revoked serial so we can retrive the correct key
        switch (platform) {
          case "mac":
          case "windows":
            if (!hasAllSub) {
              throw new ConfirmedError(400, 38, "Requested Mac/Windows, but doesn't have desktop subscription");
            }
            break;
          case "ios":
            if (!hasIosSub) {
              throw new ConfirmedError(400, 52, "Requested iOS, but doesn't have iOS or desktop subscription");
            }
            break;
          case "android":
            if (!hasAndroidSub) {
              throw new ConfirmedError(400, 51, "Requested Android, but doesn't have Android or desktop subscription");
            }
            break;
          default:
            throw new ConfirmedError(400, 51, "Invalid platform");
        }
        return Certificate.getCurrentActiveWithUserId(this.id)
        .then(certificate => {
          return {
            id: this.id,
            b64: certificate.p12
          };
        });
    });
  }
  
  getSubscriptions( filtered = false ) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE user_id=$1`,
      [this.id])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting subscriptions", error); 
      })
      .then( result => {
        var subscriptions = [];
        result.rows.forEach(row => {
          subscriptions.push(new Subscription(row, filtered));
        });
        return subscriptions;
      });
  }
  
  getActiveSubscriptions( filtered = false ) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE
        user_id=$1 AND
        cancellation_date IS NULL AND
        expiration_date > to_timestamp($2)`,
      [this.id, Date.now()/1000])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting active subscriptions", error); 
      })
      .then( result => {
        var subscriptions = [];
        result.rows.forEach(row => {
          subscriptions.push(new Subscription(row, filtered));
        });
        return subscriptions;
      });
  }
  
  getActiveProSubscriptions( filtered = false ) {
    return Database.query(
      `SELECT * FROM subscriptions
      WHERE
        user_id=$1 AND
        cancellation_date IS NULL AND
        expiration_date > to_timestamp($2) AND
        (plan_type = 'all-monthly' OR plan_type = 'all-annual')`,
      [this.id, Date.now()/1000])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting active pro subscriptions", error); 
      })
      .then( result => {
        var subscriptions = [];
        result.rows.forEach(row => {
          subscriptions.push(new Subscription(row, filtered));
        });
        return subscriptions;
      });
  }
  
  cancelSubscriptionWithReceiptId(receiptId) {
    var subscription;
    return Subscription.getWithUserAndReceiptId(this, receiptId)
    .then( result => {
      subscription = result;
      return Stripe.deleteSubscription(subscription.receiptId);
    })
    .then( stripeSubscription => {
      return this.updateWithStripe(stripeSubscription);
    })
    .then( result => {
      return subscription.sendCancellationEmail();
    });
  }
  
  convertShadowUser(newEmail, newPassword) {
    return User.failIfEmailTaken(newEmail)
      .then(success => {
        return Secure.hashPassword(newPassword);
      })
      .then(newPasswordHashed => {
        const emailEncrypted = Secure.aesEncrypt(newEmail, AES_EMAIL_KEY);
        const newEmailHashed = Secure.hashSha512(newEmail, EMAIL_SALT);
        return Database.query(
          `UPDATE users 
          SET email = $1, email_encrypted = $2, password = $3
          WHERE id = $4 
          RETURNING *`,
          [newEmailHashed, emailEncrypted, newPasswordHashed, this.id])
        .catch( error => {
          throw new ConfirmedError(500, 21, "Error updating user for convertShadowUser", error);
        })
        .then( success => {
          return Email.sendConfirmation(newEmail, this.emailConfirmCode, false);
        });
      });
  }
  
  changeEmail(newEmail) {
    if (this.emailConfirmed !== true) {
      throw new ConfirmedError(400, 110, "Can't change email on user without confirmed email.");
    }
    const emailConfirmCode = Secure.generateEmailConfirmCode();
    return User.failIfEmailTaken(newEmail)
      .then(success => {
        const newEmailHashed = Secure.hashSha512(newEmail, EMAIL_SALT);
        return Database.query(
          `UPDATE users 
          SET change_email = $1, email_confirm_code = $2
          WHERE id = $3
          RETURNING *`,
          [newEmailHashed, emailConfirmCode, this.id])
        .catch( error => {
          throw new ConfirmedError(500, 299, "Error updating user for changeEmail", error);
        })
        .then( success => {
          return Email.sendChangeEmailConfirmation(newEmail, emailConfirmCode);
        });
      });
  }
  
  assertPassword(password) {
    return Secure.assertPassword(this.passwordHashed, password);
  }
  
  static getReferrerUserId(referCode) {
    return Database.query(
      `SELECT id
      FROM users
      WHERE referral_code = $1
      LIMIT 1`,
      [referCode.toUpperCase()])
      .catch( error => {
        throw new ConfirmedError(500, 14, "Error looking up referral code", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(400, 125, "Referral code doesn't exist or is invalid.");
        }
        return result.rows[0].id;
      })
  }
  
  static createWithEmailAndPassword(email, password, browser = false, referrerUserId, lockdown = false) {
    return User.failIfEmailTaken(email)
      .then( success => {
        return Secure.hashPassword(password);
      })
      .then(passwordHashed => {
        const emailHashed = Secure.hashSha512(email, EMAIL_SALT);
        const emailEncrypted = Secure.aesEncrypt(email, AES_EMAIL_KEY);
        const emailConfirmCode = Secure.generateEmailConfirmCode();
        return Database.query(
          `INSERT INTO users(email, email_encrypted, password, email_confirm_code, referred_by, lockdown)
          VALUES($1, $2, $3, $4, $5, $6)
          RETURNING *`,
          [emailHashed, emailEncrypted, passwordHashed, emailConfirmCode, referrerUserId, lockdown])
          .catch( error => {
            throw new ConfirmedError(500, 14, "Error creating user", error);
          })
      })
      .then( result => {
        const user = new User(result.rows[0]);
        Email.sendConfirmation(email, user.emailConfirmCode, browser, lockdown);
        return user;
      });
  }
  
  static getWithIdAndPassword(id, password) {
    return module.exports.getWithId(id)
      .then( user => {
        return user.assertPassword(password)
          .then( passwordMatch => {
            return user;
          });
      });
  }
  
  static getWithId(id, columns = "*", accessDeleted = false) {
    return Database.query(
      `SELECT ${columns} FROM users
      WHERE id = $1
      LIMIT 1`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error getting user: ", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "Incorrect Login.");
        }
        return new User(result.rows[0], accessDeleted);
      });
  }
  
  static getWithEmail(email, columns = "*", accessDeleted = false) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
      `SELECT ${columns} FROM users
      WHERE email = $1
      LIMIT 1`,
      [emailHashed])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user by email", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "Incorrect Login.");
        }
        return new User(result.rows[0], accessDeleted);
      });
  }
  
  static getWithStripeId(stripeId, columns = "*") {
    return Database.query(
      `SELECT ${columns} FROM users
      WHERE stripe_id=$1`,
      [stripeId])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user by stripe id", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(500, 7, `No such stripeId: ${stripeId}`);
        }
        else {
          if (result.rowCount > 1) {
            Logger.error("Multiple users found with same Stripe ID, using first one.");
          }
          return new User(result.rows[0]);
        }
      });
  }
  
  static getWithEmailAndPassword(email, password) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
      `SELECT * FROM users
      WHERE email = $1
      ORDER BY email_confirmed DESC
      LIMIT 1`,
      [emailHashed])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user by email", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "Incorrect Login.");
        }
        var user = new User(result.rows[0]);
        return user.assertPassword(password)
          .then( passwordMatch => {
            return user;
          });
      });
  }
  
  static getWithIAPReceipt(receiptData, receiptType, partnerCampaign = null) {
    return Receipt.createWithIAP(receiptData, receiptType)
      .then( receipt => {
        // If receiptId, receiptType exists in database, use that user. Otherwise create a new user.
        return Subscription.getIfReceiptExists(receipt)
          .then( subscription => {
            // The receipt exists in the database - get the user and update the subscription
            if (subscription) {
              return User.getWithId(subscription.userId)
                .then( user => {
                  return Subscription.updateWithUserAndReceipt(user, receipt)
                    .then(subscription => {
                      return user;
                    });
                });
            }
            // Receipt doesn't exist in the database - create a user and subscription for it.
            else {
              const emailConfirmCode = Secure.generateEmailConfirmCode();
              return Certificate.getUnassigned()
                .then(certificate => {
                  return Database.query(
                    `INSERT INTO users(id, email_confirm_code, partner_campaign)
                    VALUES($1, $2, $3)
                    RETURNING *`,
                    [certificate.userId, emailConfirmCode, partnerCampaign])
                  .catch( error => {
                    throw new ConfirmedError(500, 14, "Error creating user with IAP receipt", error);
                  });
                })
                .then(result => {
                  var user = new User(result.rows[0]);
                  return Subscription.updateWithUserAndReceipt(user, receipt)
                    .then(subscription => {
                      return user;
                    });
                });
            }
          });
      });
  }
  
  static confirmChangeEmail(code, email) {
    const emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    const emailEncrypted = Secure.aesEncrypt(email, AES_EMAIL_KEY);
    return Database.query(
    `SELECT * FROM users
    WHERE email_confirm_code = $1
      AND change_email = $2
    LIMIT 1`,
    [code, emailHashed])
    .catch( error => {
      throw new ConfirmedError(500, 19, "Error looking up confirmation code", error);
    })
    .then( result => {
      if (result.rows.length !== 1) {
        throw new ConfirmedError(400, 18, "Error looking up confirmation code - not found.");
      }
      var user = new User(result.rows[0]);
      // Confirm the email - update database
      return Database.query(
        `UPDATE users 
        SET email = $1, email_encrypted = $2, change_email = NULL
        WHERE email_confirm_code = $3 AND
          change_email = $1
        RETURNING *`,
        [emailHashed, emailEncrypted, code])
      .catch( error => {
        throw new ConfirmedError(500, 19, "Error accepting confirmation code", error);
      })
      .then( result => {
        if (result.rowCount !== 1) {
          throw new ConfirmedError(400, 18, "No such confirmation code and email combination");
        }
        return user;
      });
    });
  }

  static confirmEmail(code, email) {
    const emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
    `SELECT * FROM users
    WHERE email_confirm_code = $1
      AND email = $2
    LIMIT 1`,
    [code, emailHashed])
    .catch( error => {
      throw new ConfirmedError(500, 19, "Error looking up confirmation code", error);
    })
    .then( result => {
      if (result.rows.length !== 1) {
        throw new ConfirmedError(400, 18, "Error looking up confirmation code - not found.");
      }
      var user = new User(result.rows[0]);
      // If already confirmed, end here
      if (user.emailConfirmed) {
        return true;
      }
      // Not confirmed, assign an ID if it doesn't have one, and confirm it.
      let toReturn = Promise.resolve();
      if (!user.id) {
        toReturn = toReturn.then(() => {
          return Certificate.getUnassigned()
          .then(certificate => {
            return Database.query(
              `UPDATE users 
              SET id = $1
              WHERE email = $2
              RETURNING *`,
            [certificate.userId, emailHashed])
            .catch( error => {
              throw new ConfirmedError(500, 15, "Error assigning id to user", error);
            });
          })
          .then(result => {
            if (result.rowCount !== 1) {
              throw new ConfirmedError(500, 16, "Error assigning id to user: no matching email found.");
            }
            user = new User(result.rows[0]);
            return true;
          });
        });
      }
      // Confirm the email - update database as confirmed
      return toReturn.then(() => {
        return Database.query(
          `UPDATE users 
          SET email_confirmed = true 
          WHERE email_confirm_code = $1 AND
            email_confirmed = false AND
            email = $2
          RETURNING *`,
          [code, emailHashed])
        .catch( error => {
          throw new ConfirmedError(500, 19, "Error accepting confirmation code", error);
        })
        .then( result => {
          if (result.rowCount !== 1) {
            throw new ConfirmedError(400, 18, "No such confirmation code and email combination");
          }
          return user;
        });
      });
    });
  }
  
  static failIfEmailTaken(email) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
      `SELECT * FROM users
      WHERE email = $1
      LIMIT 1`,
      [emailHashed])
      .catch( error => {
        throw new ConfirmedError(500, 15, "Error checking if email already exists.", error);
      })
      .then( result => {
        if (result.rows.length === 1) {
          var user = new User(result.rows[0]);
          if (!user.emailConfirmed) {
            throw new ConfirmedError(200, 1, "Email registered, but not confirmed. Check email for the confirmation link.");
          }
          else {
            throw new ConfirmedError(400, 40, "That email is already registered. Please try signing in.");
          }
        }
        return emailHashed;
      });
  }
  
  static resendConfirmCode(email, lockdown = false) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
      `SELECT *
      FROM users
      WHERE email = $1
      LIMIT 1`,
      [emailHashed])
      .catch( error => {
        throw new ConfirmedError(500, 58, "Error looking up email for resending confirm code", error);
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(400, 59, "No such email");
        }
        var user = new User(result.rows[0]);
        if (user.emailConfirmed) {
          throw new ConfirmedError(400, 60, "Email already confirmed. Try signing in.");
        }
        else {
          return Email.sendConfirmation(email, user.emailConfirmCode, true, lockdown);
        }
      });
  }
  
  static generatePasswordReset(email, lockdown = false) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    var passwordResetCode = Secure.generatePasswordResetCode();
    return Database.query(
      `UPDATE users
      SET password_reset_code = $1
      WHERE email = $2 AND
        email_confirmed = true
      RETURNING *`,
      [passwordResetCode, emailHashed])
      .catch( error => {
        throw new ConfirmedError(500, 72, "Error adding password reset code to database", error);
      })
      .then( result => {
        if (result.rowCount === 1) {
          return Email.sendResetPassword(email, passwordResetCode, lockdown);
        }
        else {
          return true;
        }
      });
  }
  
  static resetPassword(code, newPassword) {
    return Secure.hashPassword(newPassword)
      .then(newPasswordHashed => {
        return Database.query(
          `UPDATE users 
          SET password = $1,
            password_reset_code = NULL
          WHERE password_reset_code = $2
          RETURNING *`,
          [newPasswordHashed, code]);
      })
      .catch( error => {
        throw new ConfirmedError(500, 76, "Error setting new user password", error);
      })
      .then( result => {
        if (result.rowCount !== 1) {
          throw new ConfirmedError(400, 77, "Error setting new user password: Invalid reset code.");
        }
        return true;
      });
  }
  
  static hasActiveSubscription(id) {
    return Database.query(
      `SELECT COUNT(*) AS cnt FROM subscriptions
       WHERE
         user_id=$1 AND
         cancellation_date IS NULL AND
         expiration_date > to_timestamp($2)`,
       [id, Date.now()/1000])
    .catch( error => {
      throw new ConfirmedError(500, 26, "Error checking if a user id has an active subscription", error); 
    })
    .then( result => {
      var count = result.rows[0].cnt;
      if (count == 0) {
        return false;
      }
      else {
        return true;
      }
    });
  }
  
  static getMonthlyUsage(id) {
    return Database.query(
      `SELECT month_usage_megabytes, month_usage_update FROM users
      WHERE id = $1
      LIMIT 1`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user usage by id", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such user id.");
        }
        let user = new User(result.rows[0]);
        let date = new Date();
        let firstOfCurrentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        // outdated monthly usage, don't throttle
        if (user.monthUsageUpdate < firstOfCurrentMonth) {
          return 0;
        }
        else {
          return user.monthUsageMegabytes;
        }
      })
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting monthly usage", error); 
      });
  }
  
  static updateUserUsageById(id, usage) {
    //Logger.info("updating userid: " + id + " usage: " + usage);
    return Database.query(
      `SELECT month_usage_megabytes, month_usage_update FROM users
      WHERE id = $1
      LIMIT 1`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user usage by id", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, `No such user id: ${id}`);
        }
        let user = new User(result.rows[0]);
        let date = new Date();
        let firstOfCurrentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        var midnightToday = new Date();
        midnightToday.setHours(0,0,0,0);
        // outdated monthly usage, reset it
        if (user.monthUsageUpdate < firstOfCurrentMonth) {
          //Logger.info("last update was before first of current month");
          return Database.query(
            `UPDATE users SET month_usage_megabytes = ($1), month_usage_update = ($2)
            WHERE id = $3`,
            [Math.floor(usage), midnightToday, id])
            .catch( error => {
              throw new ConfirmedError(500, 7, "Error setting user usage by id", error);
            });
        }
        else {
          //Logger.info("last update was after first of current month");
          return Database.query(
            `UPDATE users SET month_usage_megabytes = ($1), month_usage_update = ($2)
            WHERE id = $3`,
            [Math.floor(user.monthUsageMegabytes + usage), midnightToday, id])
            .catch( error => {
              throw new ConfirmedError(500, 7, "Error setting user usage by id", error);
            });
        }
      });
  }
  
  static setDoNotEmail(email, code) {
    var emailHashed = Secure.hashSha512(email, EMAIL_SALT);
    return Database.query(
      `UPDATE users
      SET do_not_email = true
      WHERE email = $1 AND do_not_email_code = $2
      RETURNING *`,
      [emailHashed, code])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error setting do not email", error);
      })
      .then( result => {
        if (result.rowCount !== 1) {
          throw new ConfirmedError(400, 89, "Wrong code and/or email for email opt-out");
        }
        return true;
      });
  }
  
}

module.exports = User;

// Models - Refer after export to avoid circular/incomplete reference
const Subscription = require("./subscription-model.js");
const Receipt = require("./receipt-model.js");
const Certificate = require("./certificate-model.js");