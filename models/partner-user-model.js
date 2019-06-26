const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const Secure = require("../utilities/secure.js");

class PartnerUser {
  
  constructor(userRow) {
    if (!userRow) {
      throw new ConfirmedError(500, 999, "Error creating partner user: Null partner user.");
    }
    this.id = userRow.id;
    this.email = userRow.email;
    this.passwordHashed = userRow.password;
    this.partnerCode = userRow.partner_code;
  }
  
  changePassword(currentPassword, newPassword) {
    return this.assertPassword(currentPassword)
      .then( passwordMatches => {
        return Secure.hashPassword(newPassword);
      })
      .then(newPasswordHashed => {
        return Database.query(
          `UPDATE partner_users 
          SET password = $1
          WHERE email = $2
          RETURNING *`,
          [newPasswordHashed, this.email])
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

  assertPassword(password) {
    return Secure.assertPassword(this.passwordHashed, password);
  }
  
  getCurrentSnapshot() {
    return Partner.getWithCode(this.partnerCode)
      .then(partner => {
        return partner.getCurrentSnapshot();
      });
  }

  static list() {
    return Database.query(
      `SELECT * FROM partner_users`,
      [])
    .catch( error => {
      throw new ConfirmedError(500, 14, "Error listing users", error);
    })
    .then( result => {
      var partnerUsers = [];
      result.rows.forEach(row => {
        partnerUsers.push(new PartnerUser(row));
      });
      return partnerUsers;
    });
  }

  static create(email, password, partnerCode) {
    return PartnerUser.failIfEmailTaken(email)
      .then( success => {
        return Secure.hashPassword(password);
      })
      .then(passwordHashed => {
        return Database.query(
          `INSERT INTO partner_users(email, password, partner_code)
          VALUES($1, $2, $3)
          RETURNING *`,
          [email, passwordHashed, partnerCode]);
      })
      .catch( error => {
        throw new ConfirmedError(500, 14, "Error creating user", error);
      })
      .then( result => {
        return new PartnerUser(result.rows[0]);
      });
  }
  
  static delete(id) {
    return Database.query(
      `DELETE FROM partner_users
      WHERE id = $1
      RETURNING *`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error deleting partner user: ", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such user.");
        }
        return new PartnerUser(result.rows[0]);
      });
  }
  
  static getWithEmail(email) {
    return Database.query(
      `SELECT * FROM partner_users
      WHERE email = $1
      LIMIT 1`,
      [email])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Database error getting user: ", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such user.");
        }
        return new PartnerUser(result.rows[0]);
      });
  }
  
  static getWithEmailAndPassword(email, password) {
    return Database.query(
      `SELECT * FROM partner_users
      WHERE email = $1
      LIMIT 1`,
      [email])
      .catch( error => {
        throw new ConfirmedError(500, 7, "Error getting user by email", error);
      })
      .then( result => {
        if (result.rows.length === 0) {
          throw new ConfirmedError(401, 2, "No such user.");
        }
        var user = new PartnerUser(result.rows[0]);
        return user.assertPassword(password)
          .then( passwordMatch => {
            return user;
          });
      });
  }
  
  static failIfEmailTaken(email) {
    return Database.query(
      `SELECT * FROM partner_users
      WHERE email = $1
      LIMIT 1`,
      [email])
      .catch( error => {
        throw new ConfirmedError(500, 15, "Error checking if email already exists.", error);
      })
      .then( result => {
        if (result.rows.length === 1) {
          throw new ConfirmedError(400, 40, "That email is already registered. Please try signing in.");
        }
        return email;
      });
  }
  
}

module.exports = PartnerUser;

// Models - Refer after export to avoid circular/incomplete reference
const Partner = require("./partner-model.js");
const PartnerSnapshot = require("./partner-snapshot-model.js");