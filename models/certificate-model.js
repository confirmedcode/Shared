const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const Secure = require("../utilities/secure.js");

const CURRENT_SOURCE_ID = process.env.CURRENT_SOURCE_ID;
const AES_P12_KEY = process.env.AES_P12_KEY;

class Certificate {
  
  constructor(certificateRow) {
    if (!certificateRow) {
      throw new ConfirmedError(500, 999, "Error creating certificate: Null row.");
    }

    this.serial = certificateRow.serial;
    this.sourceId = certificateRow.source_id;
    this.userId = certificateRow.user_id;
    this.revoked = certificateRow.revoked;
    this.assigned = certificateRow.assigned;
    this.p12Encrypted = certificateRow.p12_encrypted;
  }
  
  get p12() {
    return Secure.aesDecrypt(this.p12Encrypted, AES_P12_KEY);
  }

  static getWithSourceAndUser(sourceId, userId) {
    return Database.query(
      `SELECT * FROM certificates
      WHERE source_id = $1 and user_id = $2
      LIMIT 1`,
      [sourceId, userId])
      .catch( error => {
        throw new ConfirmedError(500, 99, "Error getting certificate", error);
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(500, 99, "No such sourceId and userId");
        }
        return new Certificate(result.rows[0]);
      });
  }
  
  static checkRevoked(clientId) {
    return Database.query(
      `SELECT revoked FROM certificates
      WHERE user_id = $1 and source_id = $2
      LIMIT 1`,
      [clientId, CURRENT_SOURCE_ID])
      .catch( error => {
        throw new ConfirmedError(500, 99, "Error getting revocation of certificate: user: " + clientId + " source: " + CURRENT_SOURCE_ID, error);
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(500, 99, "No such clientId in revocation check");
        }
        return result.rows[0].revoked;
      });
  }
  
  static getUnassigned() {
    return Database.query(
      `UPDATE certificates 
      SET assigned = true
      WHERE source_id = $1 AND
        user_id IN
        (SELECT user_id
          FROM certificates
          WHERE source_id = $1 AND
            assigned = false
          LIMIT 1)
      RETURNING *`,
      [CURRENT_SOURCE_ID])
    .catch( error => {
      throw new ConfirmedError(500, 99, "Error getting unassigned certificate", error);
    })
    .then( result => {
      if (result.rowCount !== 1) {
        throw new ConfirmedError(500, 71, "Error getting unassigned certificate: no result.");
      }
      return new Certificate(result.rows[0]);
    });
  }
  
  static getCurrentActiveWithUserId(userId) {
    return Database.query(
      `SELECT * FROM certificates
      WHERE user_id=$1
        AND revoked=false
        AND source_id=$2
        AND assigned=true
      LIMIT 1`,
      [userId, CURRENT_SOURCE_ID])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting certificate", error); 
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(500, 71, "No active certificates for user and current source.");
        }
        return new Certificate(result.rows[0]);
      });
  }
  
}

module.exports = Certificate;