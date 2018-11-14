const ConfirmedError = require("../error");
const Logger = require("../logger");

const AWS = require("aws-sdk");
const cloudwatchlogs = new AWS.CloudWatchLogs();

module.exports = {
  
  writeToLogs: (logGroup, logStream, message) => {
    // Get the latest sequence token
    return cloudwatchlogs.describeLogStreams( {
      logGroupName: logGroup,
      logStreamNamePrefix: logStream
    }).promise()
    .catch( error => {
      throw new ConfirmedError(400, 9999, "Error getting Log Streams: " + error); 
    })
    .then( data => {
    // Write to Cloudwatch Logs
      return cloudwatchlogs.putLogEvents( {
        logEvents: [ {
          message: message,
          timestamp: (new Date()).getTime()
        } ],
        logGroupName: logGroup,
        logStreamName: logStream,
        sequenceToken: data.logStreams[0].uploadSequenceToken
      }).promise();
    })
    .catch( error => {
      throw new ConfirmedError(400, 9999, "Error logging message to Cloudwatch Logs: " + error); 
    })
  }
  
}
