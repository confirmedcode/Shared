const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Constants
const PLAN_TO_ESTIMATED_REVENUE = {
  "ios-monthly": 4.99,
  "ios-annual": 49.99,
  "all-monthly": 9.99,
  "all-annual": 99.99
}

// Utilities
const Database = require("../utilities/database.js");

class Partner {
  
  constructor(row) {
    if (!row) {
      throw new ConfirmedError(500, 999, "Error creating partner: Null partner.");
    }
    this.id = row.id;
    this.title = row.title;
    this.code = row.code;
    this.percentageShare = row.percentage_share;
    this.revenueMultiple = this.percentageShare / 100;
  }
  
  getCurrentSnapshot() {
    return Database.query(
      `SELECT
        SUBSTRING(users.partner_campaign FROM character_length($1) + 1) AS partner_campaign,
	      subscriptions.receipt_type,
        subscriptions.plan_type,
        subscriptions.expiration_date,
        subscriptions.cancellation_date,
        subscriptions.in_trial,
        subscriptions.failed_last_check, 
        subscriptions.updated
    FROM subscriptions
      INNER JOIN users
        ON (subscriptions.user_id = users.id)
    WHERE users.partner_campaign LIKE $2
      AND
      subscriptions.expiration_date > now()
      AND
      subscriptions.cancellation_date IS NULL;`,
      [this.code + "-", this.code + "-%"])
    .catch( error => {
      throw new ConfirmedError(500, 70, "Error looking up Partner referrals", error);
    })
    .then( result => {
      // Structure of campaigns is:
      // campaigns[campaign-id][plan-type/"Total"]["trial"/"paying"] = [subscription]
      var campaigns = {};
      result.rows.forEach(row => {
        if (!(row.partner_campaign in campaigns)) {
          campaigns[row.partner_campaign] = {};
          for (var plan in PLAN_TO_ESTIMATED_REVENUE) {
            campaigns[row.partner_campaign][plan] = {
              "trial": [],
              "paying": []
            };
          }
        }
        if (row.in_trial == true) {
          campaigns[row.partner_campaign][row.plan_type]["trial"].push(row);
        }
        else {
          campaigns[row.partner_campaign][row.plan_type]["paying"].push(row);
        }
      });
      // Sum the revenue
      var summary = {
        "percentageShare": this.percentageShare,
        "trial": 0,
        "paying": 0,
        "revenue": 0,
        "revenueMinusApple": 0,
        "revenueYourShare": 0
      }
      for (var campaignKey in campaigns) {
        var plans = campaigns[campaignKey];
        var total = {
          "trial": {
            length: 0
          },
          "paying": {
            length: 0
          },
          "revenue": 0,
          "revenueMinusApple": 0,
          "revenueYourShare": 0
        }
        for (var planKey in plans) {
          var trialSubscriptions = plans[planKey]["trial"];
          total["trial"]["length"] = total["trial"]["length"] + trialSubscriptions.length;
          var payingSubscriptions = plans[planKey]["paying"];
          total["paying"]["length"] = total["paying"]["length"] + payingSubscriptions.length;
          var revenue = 0;
          for (var key in payingSubscriptions) {
            revenue = revenue + PLAN_TO_ESTIMATED_REVENUE[planKey]
          }
          plans[planKey].revenue = revenue.toFixed(2);
          total["revenue"] = total["revenue"] + revenue;
          var revenueMinusApple = revenue * 0.7;
          plans[planKey].revenueMinusApple = revenueMinusApple.toFixed(2);
          total["revenueMinusApple"] = total["revenueMinusApple"] + revenueMinusApple;
          var revenueYourShare = revenue * 0.7 * this.revenueMultiple;
          plans[planKey].revenueYourShare = revenueYourShare.toFixed(2);
          total["revenueYourShare"] = total["revenueYourShare"] + revenueYourShare;
        };
        summary["trial"] = summary["trial"] + total["trial"].length;
        summary["paying"] = summary["paying"] + total["paying"].length;
        summary["revenue"] = summary["revenue"] + total["revenue"];
        summary["revenueMinusApple"] = summary["revenueMinusApple"] + total["revenueMinusApple"];
        summary["revenueYourShare"] = summary["revenueYourShare"] + total["revenueYourShare"];
        total["revenue"] = total["revenue"].toFixed(2);
        total["revenueMinusApple"] = total["revenueMinusApple"].toFixed(2);
        total["revenueYourShare"] = total["revenueYourShare"].toFixed(2);
        campaigns[campaignKey]["Total"] = total;
      };
      summary["trial"] = summary["trial"] || 0;
      summary["paying"] = summary["paying"] || 0;
      summary["revenue"] = summary["revenue"].toFixed(2) || 0;
      summary["revenueMinusApple"] = summary["revenueMinusApple"].toFixed(2);
      summary["revenueYourShare"] = summary["revenueYourShare"].toFixed(2);
      
      return new PartnerSnapshot({
        create_date: new Date(),
        partner_code: this.code,
        summary: JSON.stringify(summary),
        campaigns: JSON.stringify(campaigns)
      });
    });
  }
  
  static getWithCode(code) {
    return Database.query(
      `SELECT * FROM partners
      WHERE code = $1
      LIMIT 1`,
      [code])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error getting partner: ", error);
      })
      .then( result => {
        return new Partner(result.rows[0]);
      });
  }
  
  static list() {
    return Database.query(
      `SELECT * FROM partners`,
      [])
    .catch( error => {
      throw new ConfirmedError(500, 14, "Error listing partners", error);
    })
    .then( result => {
      var partners = [];
      result.rows.forEach(row => {
        partners.push(new Partner(row));
      });
      return partners;
    });
  }

  static create(title, partnerCode, percentageShare) {
    return Database.query(
      `INSERT INTO partners(title, code, percentage_share)
      VALUES($1, $2, $3)
      RETURNING *`,
      [title, partnerCode, percentageShare])
      .catch( error => {
        throw new ConfirmedError(500, 14, "Error creating partner", error);
      })
      .then( result => {
        return new Partner(result.rows[0]);
      });
  }
  
  static delete(id) {
    return Database.query(
      `DELETE FROM partners
      WHERE id = $1
      RETURNING *`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error deleting partner: ", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such partner.");
        }
        return new Partner(result.rows[0]);
      });
  }

}

module.exports = Partner;

// Models - Refer after export to avoid circular/incomplete reference
const PartnerSnapshot = require("./partner-snapshot-model.js");