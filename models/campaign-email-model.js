const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");

class CampaignEmail {
  
  constructor(row) {
    if (!row) {
      throw new ConfirmedError(400, 999, "Error creating tracker: Null row.");
    }
    this.id = row.id;
    this.campaignId = row.campaign_id;
    this.emailEncrypted = row.email_encrypted;
    this.unsubscribeCode = row.unsubscribe_code;
    this.sent = row.sent;
    this.failed = row.failed;
  }
  
  static addLockdownEmailsToCampaign(campaign) {
    return Database.query(
      `INSERT INTO campaign_emails (campaign_id, email_encrypted, unsubscribe_code)
        SELECT $1, email_encrypted, newsletter_unsubscribe_code
          FROM users
          WHERE email_encrypted IS NOT NULL AND email_confirmed = true AND do_not_email = false AND lockdown = true AND newsletter_subscribed = true
      ON CONFLICT
        DO NOTHING`,
      [campaign.id])
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error adding lockdown emails to campaign", error);
      });
  }
  
  static getUnsentEmailsAndMarkAsSent(campaignId, maxNum) {
    return Database.query(
      `UPDATE campaign_emails
          SET sent = true
          WHERE id IN
          	(SELECT id
             FROM campaign_emails
             WHERE campaign_id = $1 AND sent = false
             LIMIT $2)
          RETURNING *`,
    [campaignId, maxNum])
    .catch( error => {
      throw new ConfirmedError(400, 99, "Error getting unsent emails by id", error);
    })
    .then( result => {
      var campaignEmails = [];
      result.rows.forEach(campaignEmail => {
        campaignEmails.push(new CampaignEmail(campaignEmail));
      })
      return campaignEmails;
    })
  }
  
  static setFailed(id) {
    return Database.query(
      `UPDATE campaign_emails
          SET failed = true
          WHERE id = $1
          RETURNING *`,
    [id])
    .catch( error => {
      Logger.error("Error setting failed for campaign email: ", JSON.stringify(error));
    })
  }
  
}

module.exports = CampaignEmail;