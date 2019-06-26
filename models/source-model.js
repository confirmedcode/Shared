const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

// Utilities
const Database = require("../utilities/database.js");
const Exec = require("../utilities/exec.js");
const Secure = require("../utilities/secure.js");
const handlebars = require("handlebars");
const path = require("path");
const klaw = require("klaw");
const fs = require("fs-extra");
const aws = require("aws-sdk");
const ssm = new aws.SSM();

const DOMAIN = process.env.DOMAIN;
const ENVIRONMENT = process.env.ENVIRONMENT;
const CA_PASSWORD = process.env.CA_PASSWORD;
const SOURCES_DIR = path.join(".", "..", "sources");
const AES_P12_KEY = process.env.AES_P12_KEY;
const CLIENT_OPENSSL_CONF_PATH = path.join(".", "templates", "openssl-client.cnf");
const SOURCE_OPENSSL_CONF_PATH = path.join(".", "templates", "openssl-source.cnf");
const CURRENT_SOURCE_ID_PARAMETER_PATH = "/" + ENVIRONMENT + "/COMMON/CURRENT_SOURCE_ID";

class Source {
  
  constructor(id, createDate, isCurrent) {
    this.id = id;
    this.isCurrent = isCurrent;
    this.createDate = createDate;
    this.createDateString = new Intl.DateTimeFormat("en-US", {year: "numeric", month: "short", day: "numeric"}).format(createDate);
  }

  static getCurrentSourceId() {
    if (ENVIRONMENT === "LOCAL") {
      return Promise.resolve(process.env.CURRENT_SOURCE_ID);
    }
    else {
      return ssm.getParameter({ Name: CURRENT_SOURCE_ID_PARAMETER_PATH }).promise()
      .then(result => {
        return result.Parameter ? result.Parameter.Value : null;
      })
      .catch( error => {
        Logger.error("Couldn't get CURRENT_SOURCE_ID: " + error);
        return null;
      });
    }
  }
  
  static setCurrent(id) {
    if (ENVIRONMENT === "LOCAL") {
      return Promise.resolve();
    }
    else {
      return ssm.putParameter({ Name: CURRENT_SOURCE_ID_PARAMETER_PATH, Type: "String", Value: id, Overwrite: true }).promise()
      .then(result => {
        return true;
      })
      .catch( error => {
        throw new ConfirmedError(500, 99, "Couldn't set CURRENT_SOURCE_ID: " + error);
      });
    }
  }
  
  static getUnassignedCertificatesCount(id) {
    return Database.query(
      `SELECT count(*) FROM certificates
      WHERE assigned=false AND source_id=$1`,
      [id])
      .catch( error => {
        throw new ConfirmedError(500, 26, "Error getting unassigned certificates count: " + error); 
      })
      .then( result => {
        return result.rows[0].count;
      });
  }
  
  static getSources() {
    return module.exports.getCurrentSourceId()
      .then(currentSourceId => {
        return getSourceDirectories()
          .then(items => {
            var sources = [];
            items.forEach((item) => {
              if (path.basename(item.path) !== "MOUNTED" && path.basename(item.path) !== "sources") {
                var source = new Source(path.basename(item.path),
                                        new Date(item.stats.ctime),
                                        path.basename(item.path) === currentSourceId);
                sources.push(source);
              }
            });
            return sources;
          });
      });
  }
  
  static getServerCertificate(id) {
    const newSourceDir = path.join(SOURCES_DIR, id);
    const caDir = path.join(newSourceDir, "ca");
    const caCertificateFile = path.join(caDir, "cacert.pem");
    const serverDir = path.join(newSourceDir, "server");
    const serverKeyFile = path.join(serverDir, "serverkey.pem");
    const serverCertificateFile = path.join(serverDir, "servercert.pem");
    var toReturn = {
      cacert: "",
      servercert: "",
      serverkey: ""
    };
    return fs.readFile(caCertificateFile, "utf-8")
    .then(cacert => {
      toReturn.cacert = cacert;
      return fs.readFile(serverKeyFile, "utf-8");
    })
    .then(serverkey => {
      toReturn.serverkey = serverkey;
      return fs.readFile(serverCertificateFile, "utf-8");
    })
    .then(servercert => {
      toReturn.servercert = servercert;
      return toReturn;
    })
    .catch(error => {
      throw new ConfirmedError(500, 99, "Unable to get Server Certificate: " + error);
    });
  }
  
  static generateCertificates(sourceId, num) {
    module.exports.generateCertificate(sourceId, 0, num);
    return true;
  }
  
  static generateCertificate(sourceId, count, total) {
    if (count >= total) {
      Logger.info("Certificate generation complete.");
      return true;
    }
    Logger.info("Generating certificate " + count + " of " + total);
    const sourceDir = path.resolve(path.join(SOURCES_DIR, sourceId));
    const ecparamFile = path.join(sourceDir, "prime256v1.pem");
    const caDir = path.join(sourceDir, "ca");
    const caCertificateFile = path.join(caDir, "cacert.pem");
    const tempDir = path.join(sourceDir, "temp");
    const clientOpensslConfFile = path.join(tempDir, "client-openssl.cnf");
    const clientPrivateKeyFile = path.join(tempDir, "client.key");
    const clientCertificateRequestFile = path.join(tempDir, "client.req");
    const clientCertificateFile = path.join(tempDir, "client.crt");
    const clientUnencryptedP12File = path.join(tempDir, "unencrypted-key.p12");
    const certificateId = Secure.generateCertificateId();
    var certificateSerial = null;
    // Save certificate serial
    return fs.readFile(path.join(sourceDir,"database", "serial"), "utf8")
    .then(serial => {
      certificateSerial = serial.trim();
    // Generate Client Openssl Conf
      return fs.readFile(CLIENT_OPENSSL_CONF_PATH, "utf-8")
      .then(conf => {
        var template = handlebars.compile(conf);
        return template({
          sourceId: sourceId,
          domain: DOMAIN,
          certificateId: certificateId
        });
      })
      .then(clientConf => {
        return fs.outputFile(clientOpensslConfFile, clientConf);
      })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate client openssl conf: " + error);
      });
    })
    // Generate Client Certificate Request
    .then(success => {
      Logger.info("Generating Client Certificate Request");
      return Exec.exec("openssl",
      ["req", "-utf8", "-new",
        "-newkey", "ec:" + ecparamFile,
        "-config", clientOpensslConfFile,
        "-keyout", clientPrivateKeyFile,
        "-out", clientCertificateRequestFile,
        "-nodes",
        "-passin", "pass:" + CA_PASSWORD,
        "-subj", "/CN=" + certificateId,
        "-batch"],
      { cwd: sourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate client certificate request: " + error);
      });
    })
    // Generate Client Certificate
    .then(success => {
      Logger.info("Generating Client Certificate");
      return Exec.exec("openssl",
      ["ca", "-utf8",
        "-in", clientCertificateRequestFile,
        "-out", clientCertificateFile,
        "-config", clientOpensslConfFile,
        "-days", "3650",
        "-batch",
        "-passin", "pass:" + CA_PASSWORD,
        "-subj", "/CN=" + certificateId],
      { cwd: sourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate client certificate: " + error);
      });
    })
    // Generate Client P12
    .then(success => {
      Logger.info("Generating Client P12");
      return Exec.exec("openssl",
      ["pkcs12",
        "-in", clientCertificateFile,
        "-inkey", clientPrivateKeyFile,
        "-export",
        "-name", certificateId,
        "-out", clientUnencryptedP12File,
        "-certfile", caCertificateFile,
        "-passout", "pass:"],
      { cwd: sourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate client P12: " + error);
      });
    })
    // Encrypt the P12 and write it to database
    .then(success => {
      if (!certificateSerial) {
        throw new ConfirmedError(500, 99, "Unable to get certificate serial.");
      }
      return fs.readFile(clientUnencryptedP12File);
    })
    // Insert into database certificates table
    .then(unencryptedP12 => {
      let b64string = Buffer.from(unencryptedP12).toString("base64");
      const p12Encrypted = Secure.aesEncrypt(b64string, AES_P12_KEY);
      return Database.query(
        `INSERT INTO certificates(serial, source_id, user_id, revoked, p12_encrypted)
        VALUES($1, $2, $3, $4, $5)
        RETURNING *`,
        [certificateSerial, sourceId, certificateId, false, p12Encrypted])
      .catch( error => {
        throw new ConfirmedError(500, 99, "Error inserting certificate: " + error);
      });
    })
    // Clear the temporary directory's files (including unencrypted P12)
    .then(success => {
      return fs.emptyDir(tempDir)
      .catch( error => {
        throw new ConfirmedError(500, 99, "Error clearing temp directory: " + error);
      });
    })
    // Recurse to next certificate
    .then(success => {
      module.exports.generateCertificate(sourceId, count + 1, total);
    })
    .catch(error => {
      Logger.error("Error creating certificate: " + error);
    });
  }
  
  static createWithId(id) {
    const newSourceDir = path.resolve(path.join(SOURCES_DIR, id));
    const opensslConfFile = path.join(newSourceDir, "openssl.cnf");
    const ecparamFile = path.join(newSourceDir, "prime256v1.pem");
    const caDir = path.join(newSourceDir, "ca");
    const caPrivateKeyFile = path.join(caDir, "cakey.pem");
    const caCertificateFile = path.join(caDir, "cacert.pem");
    const serverDir = path.join(newSourceDir, "server");
    const serverKeyFile = path.join(serverDir, "serverkey.pem");
    const serverCertificateRequestFile = path.join(serverDir, "servercert.req");
    const serverCertificateFile = path.join(serverDir, "servercert.pem");
    const tempDir = path.join(newSourceDir, "temp");
    const databaseDir = path.join(newSourceDir, "database");
    return fs.pathExists(newSourceDir)
    // Create the directory structure
    .then(exists => {
      Logger.info("Creating directory structure");
      if (exists) {
        throw new ConfirmedError(400, 99, "ID already exists. Choose a different ID.");
      }
      else {
        return fs.ensureDir(caDir)
        .then(fs.ensureDir(serverDir))
        .then(fs.ensureDir(tempDir))
        .then(fs.ensureFile(path.join(databaseDir, "index.txt")))
        .then(fs.outputFile(path.join(databaseDir, "serial"), "01"));
      }
    })
    // Generate OpenSSL config
    .then(success => {
      Logger.info("Generating OpenSSL Config");
      return fs.readFile(SOURCE_OPENSSL_CONF_PATH, "utf-8")
      .then(conf => {
        var template = handlebars.compile(conf);
        return template({
          sourceId: id,
          domain: DOMAIN
        });
      })
      .then(sourceConf => {
        return fs.outputFile(opensslConfFile, sourceConf);
      })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate source openssl conf: " + error);
      });
    })
    // Generate ecparam
    .then(success => {
      Logger.info("Generating ecparam");
      return Exec.exec("openssl",
        ["ecparam",
          "-name", "prime256v1",
          "-out", ecparamFile])
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate ecparam: " + error);
      });
    })
    // Build the CA pair
    .then(success => {
      Logger.info("Building CA Pair");
      return Exec.exec("openssl",
        ["req", "-utf8", "-new",
          "-newkey", "ec:" + ecparamFile,
          "-config", opensslConfFile,
          "-keyout", caPrivateKeyFile,
          "-out", caCertificateFile,
          "-x509", "-days", "3650",
          "-batch",
          "-passout", "pass:" + CA_PASSWORD],
          { cwd: newSourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate CA Pair: " + error);
      });
    })
    // Build the server pair - key and certificate request
    .then(success => {
      Logger.info("Building Server Pair");
      return Exec.exec("openssl",
        ["req", "-utf8", "-new",
          "-newkey", "ec:" + ecparamFile,
          "-config", opensslConfFile,
          "-keyout", serverKeyFile,
          "-out", serverCertificateRequestFile,
          "-nodes",
          "-passin", "pass:" + CA_PASSWORD,
          "-subj", "/CN=www-" + id + "." + DOMAIN,
          "-batch"],
          { cwd: newSourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate server pair request: " + error);
      });
    })
    // Build the server pair - certificate
    .then(success => {
      Logger.info("Building Server Certificate");
      return Exec.exec("openssl",
        ["ca", "-utf8",
          "-in", serverCertificateRequestFile,
          "-out", serverCertificateFile,
          "-outdir", serverDir,
          "-config", opensslConfFile,
          "-days", "3650",
          "-passin", "pass:" + CA_PASSWORD,
          "-subj", "/CN=www-" + id + "." + DOMAIN,
          "-batch"],
          { cwd: newSourceDir })
      .catch(error => {
        throw new ConfirmedError(500, 99, "Unable to generate server pair cert: " + error);
      });
    })
    .catch(error => {
      Logger.error("Error creating source: " + error);
    });
  }
  
}

function getSourceDirectories() {
  const items = [];
  return new Promise( (fulfill, reject) => {
    klaw(SOURCES_DIR, { depthLimit: 0 })
    .on("data", item => {
      items.push(item);
    })
    .on("error", (error, item) => {
      reject(new ConfirmedError(500, 99, "Path Walk - " + item.path + " - " + error));
    })
    .on("end", () => {
      fulfill(items);
    });
  });
}

module.exports = Source;

// Models - Refer after export to avoid circular/incomplete reference
const User = require("./user-model.js");