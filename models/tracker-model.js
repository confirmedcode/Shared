const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");

class Tracker {
  
  constructor(row) {
    if (!row) {
      throw new ConfirmedError(400, 999, "Error creating tracker: Null row.");
    }
    this.id = row.id;
    this.name = row.name;
    this.displayName = row.display_name;
    this.tagline = row.tagline;
    this.categories = row.categories;
    this.connections = row.connections;
    this.collectedData = row.collected_data;
  }
  
  static getWithName(name) {
    var tracker;
    return Database.query(
      `SELECT * FROM trackers
      WHERE name = $1
      LIMIT 1`,
      [name])
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error getting tracker", error);
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(404, 99, "Tracker Not Found");
        }
        return new Tracker(result.rows[0]);
      })
  }
  
  static getAll() {
    return Database.query(
      `SELECT * FROM trackers`
      )
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error getting trackers", error);
      })
      .then( result => {
        var trackers = [];
        result.rows.forEach(tracker => {
          trackers.push(new Tracker(tracker));
        })
        return trackers;
      })
  }
  
  static create(name, displayName, tagline, categories, connections, collectedData) {
    return Database.query(
      `INSERT INTO trackers(name, display_name, tagline, categories, connections, collected_data)
      VALUES($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [name, displayName, tagline, categories, connections, collectedData])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error creating Tracker", error);
    })
    .then( result => {
      return new Tracker(result.rows[0]);
    });
  }
  
  static update(id, name, displayName, tagline, categories, connections, collectedData) {
    return Database.query(
      `UPDATE trackers
        SET name = $2,
            display_name = $3,
            tagline = $4,
            categories = $5,
            connections = $6,
            collected_data = $7
        WHERE
          id = $1
        RETURNING *`,
      [id, name, displayName, tagline, categories, connections, collectedData])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error updating Tracker", error);
    })
    .then( result => {
      return new Tracker(result.rows[0]);
    });
  }
  
  static deleteById(id) {
    return Database.query(
      `DELETE
        FROM trackers
        WHERE id = $1
      RETURNING *`,
      [id])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error deleting tracker", error);
    })
    .then( result => {
      if (result.rows.length === 0) {
        throw new ConfirmedError(401, 2, "No trackers deleted.");
      }
      return true;
    })
  }
  
}

module.exports = Tracker;