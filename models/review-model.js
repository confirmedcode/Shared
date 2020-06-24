const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");

class Review {
  
  constructor(row) {
    if (!row) {
      throw new ConfirmedError(400, 999, "Error creating review: Null row.");
    }
    this.id = row.id;
    this.name = row.name;
    this.displayName = row.display_name;
    this.tagline = row.tagline;
    this.numTrackers = row.num_trackers;
    this.numAttempts = row.num_attempts;
    this.rating = row.rating;
    this.ratingReason = row.rating_reason;
    this.date = new Date(row.date);
    this.displayDate = this.date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    this.platforms = row.platforms;
    this.ranking = row.ranking;
    this.iconUrl = row.icon_url;
    this.disclaimer = row.disclaimer;
    this.dataRequiredInfo = row.data_required_info;
    this.screenshotUrl = row.screenshot_url;
    this.testMethod = row.test_method;
    this.testDescription = row.test_description;
    this.testOpen = row.test_open;
    this.testConsent = row.test_consent;
    this.testBackground = row.test_background;
    this.testNotes = row.test_notes;
    this.summaryUrl = row.summary_url;
    this.published = row.published;
  }

  static getWithName(name, includeUnpublished = false) {
    var review;
    return Database.query(
      `SELECT * FROM reviews
      WHERE name = $1 ${includeUnpublished ? '' : ' AND published = true' }
      LIMIT 1`,
      [name])
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error getting review", error);
      })
      .then( result => {
        if (result.rows.length !== 1) {
          throw new ConfirmedError(404, 99, "Review Not Found");
        }
        review = new Review(result.rows[0]);
        return Database.query(
          `SELECT * FROM trackers
          INNER JOIN reviews_trackers
          ON trackers.id = reviews_trackers.tracker_id AND reviews_trackers.review_id = $1`,
          [review.id])
        .catch( error => {
          throw new ConfirmedError(400, 99, "Error getting trackers", error);
        })
      })
      .then( result => {
        var trackers = [];
        result.rows.forEach(tracker => {
          trackers.push(new Tracker(tracker));
        })
        review.trackers = trackers;
        return review;
      })
  }
  
  static getAll(includeUnpublished = false, orderBy = "date") {
    return Database.query(
      `SELECT * FROM reviews
      ${includeUnpublished ? '' : 'WHERE published = true' }
      ORDER BY ${orderBy} DESC`)
      .catch( error => {
        throw new ConfirmedError(400, 99, "Error getting reviews", error);
      })
      .then( result => {
        var reviews = [];
        result.rows.forEach(review => {
          reviews.push(new Review(review));
        })
        return reviews;
      })
  }
  
  static getAllUsingTracker(trackerName) {
    return Database.query(
      `SELECT reviews.*
        FROM reviews 
          INNER JOIN reviews_trackers ON reviews_trackers.review_id = reviews.id
          INNER JOIN trackers ON reviews_trackers.tracker_id = trackers.id
        WHERE trackers.name = $1 AND published = true;`,
      [trackerName])
    .catch( error => {
      throw new ConfirmedError(400, 99, "Error getting reviews by tracker", error);
    })
    .then( result => {
      var reviews = [];
      result.rows.forEach(review => {
        reviews.push(new Review(review));
      })
      return reviews;
    })
  }
  
  static deleteById(id) {
    return Database.query(
      `DELETE
        FROM reviews
        WHERE id = $1
      RETURNING *`,
      [id])
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error deleting review", error);
    })
    .then( result => {
      if (result.rows.length === 0) {
        throw new ConfirmedError(401, 2, "No reviews deleted.");
      }
      return true;
    })
  }
  
  static create(name, displayName, tagline, numAttempts, rating, ratingReason, date, platforms, ranking, iconUrl, disclaimer, dataRequiredInfo, screenshotUrl, testMethod, testDescription, testOpen, testConsent, testBackground, testNotes, summaryUrl, published, trackerNames) {
    var review;
    var trackerIds = [];
    // check trackers exist
    return Database.query(
      `SELECT * FROM trackers WHERE name = ANY($1::text[])`,
      [trackerNames]
    )
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error validating Trackers existence", error);
    })
    .then( result => {
      trackerNames.forEach(trackerName => {
        var trackerExists = false
        result.rows.forEach(foundTrackerRow => {
          var trackerRowName = foundTrackerRow.name;
          if (trackerRowName.toLowerCase() == trackerName.toLowerCase()) {
            trackerIds.push(foundTrackerRow.id);
            trackerExists = true
          }
        })
        if (trackerExists == false) {
          throw new ConfirmedError(400, 99, "Tracker doesn't exist: " + trackerName)
        }
      })
      
      // made sure all trackers exist, add the review now
      return Database.query(
        `INSERT INTO reviews(name, display_name, tagline, num_trackers, num_attempts, rating, rating_reason, date, platforms, ranking, icon_url, disclaimer, data_required_info, screenshot_url, test_method, test_description, test_open, test_consent, test_background, test_notes, summary_url, published)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        RETURNING *`,
        [name, displayName, tagline, trackerNames.length, numAttempts, rating, ratingReason, date, platforms, ranking, iconUrl, disclaimer, dataRequiredInfo, screenshotUrl, testMethod, testDescription, testOpen, testConsent, testBackground, testNotes, summaryUrl, published])
      .catch( error => {
        throw new ConfirmedError(400, 14, "Error inserting Review", error);
      })
    })
    .then( result => {
      review = new Review(result.rows[0]);
      // add the tracker connections
      return review.setTrackers(trackerIds)
      .catch( error => {
        throw new ConfirmedError(400, 14, "Error setting trackers", error);
      })
    })
    
  }
  
  static update(id, name, displayName, tagline, numAttempts, rating, ratingReason, date, platforms, ranking, iconUrl, disclaimer, dataRequiredInfo, screenshotUrl, testMethod, testDescription, testOpen, testConsent, testBackground, testNotes, summaryUrl, published, trackerNames) {
    var review;
    var trackerIds = [];
    // check trackers exist
    return Database.query(
      `SELECT * FROM trackers WHERE name = ANY($1::text[])`,
      [trackerNames]
    )
    .catch( error => {
      throw new ConfirmedError(400, 14, "Error validating Trackers existence", error);
    })
    .then( result => {
      trackerNames.forEach(trackerName => {
        var trackerExists = false
        result.rows.forEach(foundTrackerRow => {
          var trackerRowName = foundTrackerRow.name;
          if (trackerRowName.toLowerCase() == trackerName.toLowerCase()) {
            trackerIds.push(foundTrackerRow.id);
            trackerExists = true
          }
        })
        if (trackerExists == false) {
          throw new ConfirmedError(400, 99, "Tracker doesn't exist: " + trackerName)
        }
      })
      
      // made sure all trackers exist, update the review now
      return Database.query(
        `UPDATE reviews
          SET name = $2,
              display_name = $3,
              tagline = $4,
              num_trackers = $5,
              num_attempts = $6,
              rating = $7,
              rating_reason = $8,
              date = $9,
              platforms = $10,
              ranking = $11,
              icon_url = $12,
              disclaimer = $13,
              data_required_info = $14,
              screenshot_url = $15,
              test_method = $16,
              test_description = $17,
              test_open = $18,
              test_consent = $19,
              test_background = $20,
              test_notes = $21,
              summary_url = $22,
              published = $23
          WHERE
            id = $1
          RETURNING *`,
        [id, name, displayName, tagline, trackerNames.length, numAttempts, rating, ratingReason, date, platforms, ranking, iconUrl, disclaimer, dataRequiredInfo, screenshotUrl, testMethod, testDescription, testOpen, testConsent, testBackground, testNotes, summaryUrl, published])
      .catch( error => {
        throw new ConfirmedError(400, 14, "Error updating Review", error);
      })
    })
    .then( result => {
      review = new Review(result.rows[0]);
      // add the tracker connections
      return review.setTrackers(trackerIds)
      .catch( error => {
        throw new ConfirmedError(400, 14, "Error setting trackers", error);
      })
    })
    
  }
  
  setTrackers(trackerIds) {
    let chain = Promise.resolve();
    // clear all trackers first
    chain = chain.then(() => {
      return Database.query(
        `DELETE
          FROM reviews_trackers
          WHERE review_id = $1
        RETURNING *`,
        [this.id])
      .catch( error => {
        throw new ConfirmedError(400, 14, "Error clearing Trackers for Review", error);
      })
    })
    // then add trackers
    for (const trackerId of trackerIds) {
      chain = chain
        .then(() => {
          return Database.query(
            `INSERT INTO reviews_trackers(review_id, tracker_id)
            VALUES($1, $2)
            RETURNING *`,
            [this.id, trackerId])
        })
        .catch( error => {
          throw new ConfirmedError(400, 14, "Error associating tracker with review", error);
        })
    }
    return chain;
  }
  
}

module.exports = Review;

// Models - Refer after export to avoid circular/incomplete reference
const Tracker = require("./tracker-model.js");