const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");

class PartnerSnapshot {
  
  constructor(row) {
    if (!row) {
      throw new ConfirmedError(500, 999, "Error creating partner snapshot: Null partner snapshot.");
    }
    this.id = row.id || -1;
    this.createDate = new Date(row.create_date);
    this.partnerCode = row.partner_code;
    this.summary = row.summary ? JSON.parse(row.summary) : JSON.parse("{}");
    this.campaigns = row.campaigns ? JSON.parse(row.campaigns) : JSON.parse("{}");
  }
  
  save() {
    return Database.query(
      `INSERT INTO partner_snapshots
      (
        create_date,
        partner_code,
        summary,
        campaigns
      )
      VALUES($1, $2, $3, $4)
      RETURNING *`,
      [this.createDate, this.partnerCode, this.summary, this.campaigns])
    .catch( error => {
      throw new ConfirmedError(500, 14, "Error saving snapshot", error);
    })
    .then( result => {
      return new PartnerSnapshot(result.rows[0]);
    });
  }
  
  static delete(id) {
    return Database.query(
      `DELETE FROM partner_snapshots
      WHERE id = $1
      RETURNING *`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error deleting snapshot: ", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such snapshot.");
        }
        return new PartnerSnapshot(result.rows[0]);
      });
  }
  
  static getWithCode(partnerCode) {
    return Database.query(
      `SELECT *
        FROM partner_snapshots
        WHERE partner_code = $1
        ORDER BY create_date`,
      [partnerCode])
    .catch( error => {
      throw new ConfirmedError(500, 14, "Error listing partner snapshots", error);
    })
    .then( result => {
      var partnerSnapshots = [];
      result.rows.forEach(row => {
        partnerSnapshots.push(new PartnerSnapshot(row));
      });
      return partnerSnapshots;
    });
  }

  static list() {
    return Database.query(
      `SELECT *
        FROM partner_snapshots
        ORDER BY create_date`,
      [])
    .catch( error => {
      throw new ConfirmedError(500, 14, "Error listing partner snapshots", error);
    })
    .then( result => {
      var partnerSnapshots = [];
      result.rows.forEach(row => {
        partnerSnapshots.push(new PartnerSnapshot(row));
      });
      return partnerSnapshots;
    });
  }

}

module.exports = PartnerSnapshot;