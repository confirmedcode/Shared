const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const DOMAIN = process.env.DOMAIN;
const LD_DOMAIN = process.env.LD_NEW_DOMAIN;
const NODE_ENV = process.env.NODE_ENV;
const EMAIL_SALT = process.env.EMAIL_SALT;

const Database = require("../utilities/database.js");
const Secure = require("../utilities/secure.js");

const fs = require("fs-extra");
const path = require("path");
const handlebars = require("handlebars");
const AWS = require("aws-sdk");
const awsSesClient = new AWS.SES({
  apiVersion: "2010-12-01",
  region: "us-east-1"
});

module.exports = {

  // === Main
  sendConfirmation: (toAddress, code, browser = false, lockdown = false) => {
    let emailEncoded = encodeURIComponent(toAddress)
    return send(
      lockdown ? `team@${LD_DOMAIN}` : `team@${DOMAIN}`,
      toAddress,
      "Click to Confirm Email",
      "confirm-email", {
        confirmemailurl: `https://www.${DOMAIN}/confirm-email?email=${emailEncoded}&code=${code}&browser=${browser}&lockdown=${lockdown}`
      }
    );
  },

  sendChangeEmailConfirmation: (toAddress, code) => {
    let emailEncoded = encodeURIComponent(toAddress)
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "Click to Confirm Change of Email",
      "confirm-change-email", {
        confirmemailurl: `https://www.${DOMAIN}/confirm-change-email?email=${emailEncoded}&code=${code}`
      }
    );
  },

  sendResetPassword: (toAddress, code, lockdown = false) => {
    return send(
      lockdown ? `team@${LD_DOMAIN}` : `team@${DOMAIN}`,
      toAddress,
      "Your Request to Reset Password",
      "reset-password", {
        reseturl: `https://www.${DOMAIN}/reset-password?code=${code}&lockdown=${lockdown}`
      }
    );
  },

  sendCancelSubscription: (toAddress) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "[One-Time Offer] Tell Us Why You Cancelled, Get Free VPN",
      "cancel-subscription", {
        signinurl: `https://www.${DOMAIN}/signin?redirecturi=%2Fnew-subscription%3Fbrowser%3Dtrue`
      }
    );
  },

  // === Admin/Support
  sendAuditAlert: (toAddress, action, reason) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "Account Action Notification",
      "audit-alert", {
        action: action,
        reason: reason,
        time: new Date()
      }
    );
  },

  sendConfirmationAdmin: (toAddress, code) => {
    return send(
      `admin@${DOMAIN}`,
      toAddress,
      "Click to Confirm Email",
      "confirm-admin-email", {
        confirmemailurl: `https://admin.${DOMAIN}/confirm-email?code=${code}`
      }
    );
  },

  sendConfirmationSupport: (toAddress, code) => {
    return send(
      `admin@${DOMAIN}`,
      toAddress,
      "Click to Confirm Email",
      "confirm-admin-email", {
        confirmemailurl: `https://support.${DOMAIN}/confirm-email?code=${code}`
      }
    );
  },

  sendAdminAlert: (subject, body) => {
    Logger.info(`Sending Admin Email
      SUBJECT: ${subject}
      BODY: ${body}`);
    return sendPlain(
      `admin@${DOMAIN}`,
      `admin@${DOMAIN}`,
      `ADMIN ALERT: ${subject}`,
      body
    );
  },

  // === Webhook

  sendTrialWillEnd: (toAddress) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "Your Trial is Ending",
      "trial-will-end", {
        signinurl: `https://www.${DOMAIN}/signin`
      }
    );
  },

  sendCardWillExpire: (toAddress) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "[Action Required] Your Payment Method is Expiring",
      "card-will-expire", {
        signinurl: `https://www.${DOMAIN}/signin?redirecturi=%2Fpayment-methods`
      }
    );
  },

  sendPaymentFailed: (toAddress) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "[Action Required] Payment Failed - Please Update Payment Method",
      "payment-failed", {
        signinurl: `https://www.${DOMAIN}/signin?redirecturi=%2Fpayment-methods`
      }
    );
  },

  sendReferralPromo: (toAddress, referralCode) => {
    const referralUrl = `https://www.${DOMAIN}/signup?refer=${referralCode}`;
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "Refer a Friend & Earn Discounts",
      "referral-promo", {
        referralurl: referralUrl,
        smsurl: `sms:&body=Protect%20your%20internet%20privacy%20with%20the%20fully-audited%20Confirmed%20VPN.%20Use%20my%20referral%20link%20to%20get%2010%25%20off%3A%20` + encodeURIComponent(referralUrl),
        emailurl: `mailto:?subject=Protect%20Your%20Internet%20Privacy%20-%20Discount%20Inside&body=Protect%20your%20internet%20privacy%20with%20the%20fully-audited%20Confirmed%20VPN.%20Use%20my%20referral%20link%20to%20get%2010%25%20off%3A%20` + encodeURIComponent(referralUrl)
      }
    );
  },

  sendTrialStartedReferrer: (toAddress, referredEmail) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "[Bonus Discount Pending] Your Referral Just Signed Up for a Trial",
      "trial-started-referrer", {
        signinurl: `https://www.${DOMAIN}/signin`,
        referredEmail: referredEmail
      }
    );
  },

  sendSubscriptionStartedReferrer: (toAddress, referredEmail) => {
    return send(
      `team@${DOMAIN}`,
      toAddress,
      "[Bonus Discount Activated] Your Referral's Subscription is Now Active",
      "subscription-started-referrer", {
        signinurl: `https://www.${DOMAIN}/signin`,
        referredEmail: referredEmail
      }
    );
  }

  // sendExpired: (email) => {
  //   return getCompiledView("email/expired-email.html", {
  //     signinurl: `https://www.${DOMAIN}/signin`
  //   })
  //   .then( result => {
  //     return sendEmail(email,
  //       "Subscription Expired",
  //       result,
  //       `Hello,\n\n
  //       Your subscription to Confirmed VPN has expired. This could be because of a billing issue, or that you cancelled your subscription, or something else. Click the following to check your account and restart your subscription. You can also reply to this email directly if you have any questions:\n
  //       https://www.${DOMAIN}/signin\n\n
  //       Thanks,\n
  //       Team Confirmed`);
  //   })
  //   .catch(error => {
  //     throw new ConfirmedError(500, 56, "Error sending expired email", error);
  //   });
  // }

};

function send(fromAddress, toAddress, subject, templateName, parameters) {
  var html, text, optOutLink;
  var emailHashed = Secure.hashSha512(toAddress, EMAIL_SALT);
  var doNotEmail = false;
  return Database.query(
      `SELECT do_not_email, do_not_email_code
    FROM users
    WHERE email = $1
    LIMIT 1`,
      [emailHashed])
    .catch(error => {
      Logger.error("Error getting do not email or do not email code: " + error);
    })
    .then(result => {
      var optOutCode = "";
      if (result && result.rows[0]) {
        doNotEmail = result.rows[0].do_not_email;
        optOutCode = result.rows[0].do_not_email_code;
      }
      optOutLink = `https://${DOMAIN}/do-not-email?email=${toAddress}&code=${optOutCode}`;
      return getCompiledEmail(`${templateName}.html`, parameters)
    })
    .then(result => {
      html = result + `<div style="width=100%; text-align:center;"><a href="${optOutLink}" style="font-size: 10px; text-decoration: underline; color: gray;">Email Opt-Out</a></div>`;
      return getCompiledEmail(`${templateName}.txt`, parameters);
    })
    .then(result => {
      text = result + "\n--\nEmail Opt-Out: " + `${optOutLink}`;
      if (doNotEmail == true) {
        Logger.info(`Account has do_not_email set to true, not emailing.`);
        return Promise.resolve("email");
      }
      if (NODE_ENV === "test") {
        Logger.info(`Test env - not sending email, would have sent:
        From: ${fromAddress}
        To: ${toAddress}
        Subject: ${subject}
        Html: ${html}
        Text: ${text}`);
        return Promise.resolve("testSuccess");
      } else {
        return awsSesClient.sendEmail({
          Source: `Confirmed / Lockdown Team <${fromAddress}>`,
          Destination: {
            ToAddresses: [toAddress]
          },
          Message: {
            Subject: {
              Data: subject
            },
            Body: {
              Html: {
                Charset: "UTF-8",
                Data: html
              },
              Text: {
                Charset: "UTF-8",
                Data: text
              }
            }
          }
        }).promise();
      }
    })
    .catch(error => {
      throw new ConfirmedError(500, 56, `Error sending ${subject} email from ${fromAddress}`, error);
    });
}

function sendPlain(fromAddress, toAddress, subject, body) {
  if (NODE_ENV === "test") {
    Logger.info(`Test env - not sending email, would have sent:
      From: ${fromAddress}
      To: ${toAddress}
      Subject: ${subject}
      Text: ${body}`);
    return Promise.resolve("testSuccess");
  } else {
    return awsSesClient.sendEmail({
        Source: `Confirmed Team <${fromAddress}>`,
        Destination: {
          ToAddresses: [toAddress]
        },
        Message: {
          Subject: {
            Data: subject
          },
          Body: {
            Text: {
              Charset: "UTF-8",
              Data: body
            }
          }
        }
      }).promise()
      .catch(error => {
        throw new ConfirmedError(500, 56, `Error sending ${subject} email from ${fromAddress}`, error);
      });
  }
}

function getCompiledEmail(filename, parameters) {
  return fs.readFile(path.join(__dirname, "..", "emails", filename), "utf-8")
    .then(conf => {
      var template = handlebars.compile(conf);
      return template(parameters);
    })
    .catch(error => {
      throw new ConfirmedError(500, 56, "Error getting file", error);
    });
}
