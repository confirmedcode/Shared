const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const moment = require("moment");
const aws = require("aws-sdk");
const s3 = new aws.S3({ apiVersion: "2006-03-01" });

const SURICATA_BUCKET = process.env.SURICATA_BUCKET;

function getRuleFile(filename) {
  return s3.getObject({
      Bucket: SURICATA_BUCKET, 
      Key: filename
  }).promise()
  .then(object => {
    return new RuleFile(filename, object.Body);
  })
  .catch(error => {
    return new RuleFile(filename, "", error);
  });
}

class RuleFile {
  
  constructor(filename, body, error = null) {
    this.filename = filename;
    this.content = body.toString("utf-8");
    this.error = error;
  }
  
  static getAll() {
    var rules = [];
    return getRuleFile("drop.conf")
    .then(ruleFile => {
      rules.push(ruleFile);
      return getRuleFile("enable.conf");
    })
    .then(ruleFile => {
      rules.push(ruleFile);
      return getRuleFile("disable.conf");
    })
    .then(ruleFile => {
      rules.push(ruleFile);
      return getRuleFile("modify.conf");
    })
    .then(ruleFile => {
      rules.push(ruleFile);
      return getRuleFile("confirmed.rules");
    })
    .then(ruleFile => {
      rules.push(ruleFile);
      return getRuleFile("update.yaml");
    })
    .then(ruleFile => {
      rules.push(ruleFile);
      return rules;
    });
  }
  
  static save(filename, content) {
    return s3.putObject({
      Body: content, 
      Bucket: SURICATA_BUCKET,
      Key: filename,
      ACL: "public-read"
    }).promise();
  }
  
  // static newBannedHost(host) {
  //   return Database.query(
  //     `SELECT nextval('suricata_rules_id_seq');`,
  //     [])
  //   .catch( error => {
  //     throw new ConfirmedError(500, 99, "Error getting suricata id sequence avlue: " + error);
  //   })
  //   .then( val => {
  //     let seq = parseInt(val.rows[0].nextval);
  //     let rule1sid = BASE_BANNED_HOST_SID + seq;
  //     let rule2sid = BASE_BANNED_HOST_SID + seq + 1;
  //     let rule3sid = BASE_BANNED_HOST_SID + seq + 2;
  //     let rule1 = `reject tls $CLIENT_NET any -> any 443 ( msg: "TLS SNI ${host}"; \\
  //       tls_sni; content: "${host}"; \\
  //       sid:${rule1sid};)`;
  //     let rule2 = `reject dns $CLIENT_NET any -> any any (msg: "DNS ${host}"; \\
  //       dns_query; content: "${host}"; \\
  //       sid:${rule2sid};)`;
  //     let rule3 = `reject http $CLIENT_NET any -> any 80 (msg: "HTTP ${host}"; \\
  //       content:"${host}"; http_host; \\
  //       sid:${rule3sid};)`;
  //     return Database.query(
  //       `INSERT INTO suricata_rules(description, rule)
  //       VALUES($1, $2), ($3, $4), ($5, $6)`,
  //       [host + " - Ban1", rule1,
  //        host + " - Ban2", rule2,
  //        host + " - Ban3", rule3])
  //   })
  //   .catch( error => {
  //     throw new ConfirmedError(500, 99, "Error inserting banned host rules: " + error);
  //   })
  // }
  
}

module.exports = RuleFile;