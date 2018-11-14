const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const path = require("path");
const exec = require("child_process").execFile;

module.exports = {
  
  exec: (file, args, options) => {
    var child = exec(file, args, options);
    child.stdout.on("data", function (data) {
      Logger.info(file + " - " + data.trim());
    });
    child.stderr.on("data", function (data) {
      Logger.info(file + " - " + data.trim());
    });
    child.on("close", function (code) {
      Logger.info(file + " - Exit Code: " + code);
    });
    return new Promise(function (resolve, reject) {
      child.addListener("error", reject);
      child.addListener("exit", resolve);
    });
  },
  
};