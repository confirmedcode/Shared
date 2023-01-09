const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");

class Campaign {

  constructor(row) {
    if (!row) {
      throw new ConfirmedError(400, 999, "Error creating campaign: Null row.");
    }
    this.id = row.id;
    this.name = row.name;
    this.fromAddress = row.from_address;
    this.subject = row.subject;
    this.html = row.html;
    this.plaintext = row.plaintext;
    this.createDate = new Date(row.create_date);
    this.lastSentDate = row.last_sent_date ? new Date(row.last_sent_date) : null
  }

  static getById(id) {
    return Database.query(
      `SELECT *
      FROM campaigns
      WHERE id = $1`,
      [id]
    )
    .catch( error => {
      throw new ConfirmedError(400, 99, "Error getting campaign by id", error);
    })
    .then( result => {
      if (result.rows.length === 0) {
        throw new ConfirmedError(400, 99, "No such campaign.");
      }
      return new Campaign(result.rows[0]);
    });
  }

  static getStats(id) {
    return Database.query(
      `SELECT count(*) AS total,
        count(CASE WHEN sent THEN 1 END) as sent,
        count(CASE WHEN failed THEN 1 END) as failed
      FROM campaign_emails
      WHERE campaign_id = $1`,
      [id]
    )
    .catch( error => {
      throw new ConfirmedError(400, 99, "Error getting campaign detail", error);
    })
    .then( result => {
      if (result.rows.length === 0) {
        throw new ConfirmedError(400, 99, "No such campaign.");
      }
      return {
        total: result.rows[0].total,
        sent: result.rows[0].sent,
        failed: result.rows[0].failed
      }
    });
  }

  static getAll() {
    return Database.query(
      `SELECT * FROM campaigns ORDER BY ID DESC`
      )
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error getting campaigns", error);
      })
      .then( result => {
        var campaigns = [];
        result.rows.forEach(campaign => {
          campaigns.push(new Campaign(campaign));
        })
        return campaigns;
      })
  }

  static create(name, fromAddress, subject, html, plaintext) {
    var toReturn;
    return Database.query(
      `INSERT INTO campaigns(name, from_address, subject, html, plaintext)
      VALUES($1, $2, $3, $4, $5)
      RETURNING *`,
      [name, fromAddress, subject, html, plaintext])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error creating Campaign", error);
    })
    .then( result => {
      toReturn = new Campaign(result.rows[0]);
      // add all non-opted-out, confirmed emails to this
      return CampaignEmail.addLockdownEmailsToCampaign(toReturn)
    })
    .then( result => {
      return toReturn;
    });
  }

  static createSubscribedOnly(name, fromAddress, subject, html, plaintext) {
    let toReturn;

    return Database.query(
        `INSERT INTO campaigns(name, from_address, subject, html, plaintext)
          VALUES($1, $2, $3, $4, $5)
          RETURNING *`,
        [name, fromAddress, subject, html, plaintext])
        .catch( error => {
          throw new ConfirmedError(400, 14, "Error creating Campaign", error);
        })
        .then( result => {
          toReturn = new Campaign(result.rows[0]);

          // add only subscribed users
          return CampaignEmail.addLockdownSubscribedEmailsToCampaign(toReturn)
        })
        .then( result => {
          return toReturn;
        });
  }

  static createNonSubscribed(name, fromAddress, subject, html, plaintext) {
    var toReturn;

    return Database.query(
      `INSERT INTO campaigns(name, from_address, subject, html, plaintext)
        VALUES($1, $2, $3, $4, $5)
        RETURNING *`,
      [name, fromAddress, subject, html, plaintext])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error creating Campaign", error);
    })
    .then( result => {
      toReturn = new Campaign(result.rows[0]);
      // add all non-opted-out, non-subscribed, confirmed emails to this
      return CampaignEmail.addLockdownNonSubscribedEmailsToCampaign(toReturn)
    })
    .then( result => {
      return toReturn;
    });
  }

  static createSubscriptionCancelled(name, fromAddress, subject, html, plaintext) {
    let toReturn;

    return Database.query(
        `INSERT INTO campaigns(name, from_address, subject, html, plaintext)
          VALUES($1, $2, $3, $4, $5)
          RETURNING *`,
        [name, fromAddress, subject, html, plaintext])
        .catch( error => {
          throw new ConfirmedError(400, 14, "Error creating Campaign", error);
        })
        .then( result => {
          toReturn = new Campaign(result.rows[0]);

          // add only users with expired subscription (cancelled/lapsed)
          return CampaignEmail.addLockdownCancelledSubscriptionEmailsToCampaign(toReturn)
        })
        .then( result => {
          return toReturn;
        });
  }

  static createNeverSubscribed(name, fromAddress, subject, html, plaintext) {
    let toReturn;

    return Database.query(
        `INSERT INTO campaigns(name, from_address, subject, html, plaintext)
          VALUES($1, $2, $3, $4, $5)
          RETURNING *`,
        [name, fromAddress, subject, html, plaintext])
        .catch( error => {
          throw new ConfirmedError(400, 14, "Error creating Campaign", error);
        })
        .then( result => {
          toReturn = new Campaign(result.rows[0]);

          // add only users with expired subscription (cancelled/lapsed)
          return CampaignEmail.addLockdownNeverSubscribedEmailsToCampaign(toReturn)
        })
        .then( result => {
          return toReturn;
        });
  }

}

module.exports = Campaign;

// Models - Refer after export to avoid circular/incomplete reference
const CampaignEmail = require("./campaign-email-model.js");
