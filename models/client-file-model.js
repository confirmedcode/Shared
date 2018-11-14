const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const moment = require("moment");
const aws = require("aws-sdk");
const s3 = new aws.S3({ apiVersion: "2006-03-01" });
const fs = require("fs-extra");
const Secure = require("../utilities/secure.js");

const CLIENT_BUCKET = process.env.CLIENT_BUCKET;
const ONE_MINUTE = 60 * 1000;

var lastCheckedTime = null;
var clientUrls = null;

class ClientFile {
  
  constructor(key, date = new Date(), size = 0) {
    this.key = key;
    var split = key.split("/");
    this.type = split[0].toLowerCase();
    this.id = split[1];
    this.percent = split[2];
    this.filename = split[3];
    this.modified = moment(date).format("MM/DD/YY h:mm:ss A");
    this.size = size;
  }

  static fromS3Object(object) {
    return new ClientFile(object.Key, object.LastModified, object.Size);
  }
  
  static uploadToS3(type, file) {
    // Upload to CLIENT_BUCKET with format /<mac-update|mac-app>/<uuid>/0/<filename>
    return fs.readFile(file.path)
    .then(data => {
      return s3.putObject({
          Body: data, 
          Bucket: CLIENT_BUCKET,
          Key: type + "/" + Secure.randomString(20) + "/" + "0" + "/" + file.originalname,
          ACL: "public-read"
        }).promise();
    });
  }
  
  static getAll() {
    return s3.listObjectsV2({ Bucket: CLIENT_BUCKET }).promise()
    .then(result => {
      var map = {
        "mac-app": [],
        "mac-update": [],
        "windows-app": [],
        "windows-update": []
      };
      result.Contents.forEach( (object) => {
        var client = ClientFile.fromS3Object(object);
        map[client.type].push(client);
      });
      return map;
    });
  }
  
  static getUrl(type) {
    // If checked less than one minute ago, then return it.
    if (lastCheckedTime != null && clientUrls != null && ((new Date) - lastCheckedTime) < ONE_MINUTE) {
      Logger.info("cached urls");
      return Promise.resolve(pickRandomUrl(type));
    }
    Logger.info("not cached or cache expired, rebuilding client url dictionary");
    // Otherwise update the client url dictionary and then return a random one.
    return ClientFile.getAll()
    .then( allClients => {
      var newClientUrls = {
        "mac-app": [],
        "mac-update": [],
        "windows-app": [],
        "windows-update": []
      };
      Object.keys(allClients).forEach( (clientType) => {
        allClients[clientType].forEach( (client) => {
          var p = parseInt(client.percent);
          for (var i = 0; i < p; i++) {
            newClientUrls[clientType].push("https://s3.amazonaws.com/" + CLIENT_BUCKET + "/" + client.key);
          }
        });
      });
      Object.keys(allClients).forEach( (clientType) => {
        if (newClientUrls[clientType].length != 100) {
          var padUrl = newClientUrls[clientType][0];
          Logger.error(`Client type ${clientType} only has ${allClients[clientType].length} entries -- padding with ${padUrl}`);
          for (var i = 0; i < 100 - newClientUrls[clientType].length; i++) {
            newClientUrls[clientType].push(padUrl);
          }
        }
      });
      clientUrls = newClientUrls;
      lastCheckedTime = new Date();
      return pickRandomUrl(type);
    });
  }

  changePercentage(newPercentage) {
    if (newPercentage == this.percent) {
      Logger.info("Same percentage, not changing.");
      return true;
    }
    return s3.copyObject({
      Bucket: CLIENT_BUCKET,
      CopySource: CLIENT_BUCKET + "/" + this.key,
      Key: this.type + "/" + this.id + "/" + newPercentage + "/" + this.filename,
      ACL: "public-read"
    }).promise()
    .then( result => {
      return s3.deleteObject({
        Bucket: CLIENT_BUCKET,
        Key: this.key
      }).promise();
    });
  }
  
}

function pickRandomUrl(type) {
  var randomIndex = Math.floor(Math.random() * 100); // random number 0 to 99
  var url = clientUrls[type][randomIndex];
  if (url == undefined) {
    throw new ConfirmedError(500, 80, "Url Index Out of Bounds: " + randomIndex);
  } 
  return url;
}

module.exports = ClientFile;