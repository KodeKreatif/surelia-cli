var SureliaError = require("./error");
var Base = require("./base");
var config = require("./config");
var fs = require("fs");
var schema = require("./schema");
var bknScrapper = require("bkn-scrapper");
var user = schema.User;
var domainModel = schema.Domain;
var exec = require('child_process').exec;
var genPass = require('generate-password');
var nodemailer = require('nodemailer');

var User = function() {
  this.name = "user";
}

User.prototype = new Base();
User.prototype.help = {};
User.prototype.help.addUser =
  "host user\n\tAdds a new user 'user' in 'host' domain";

User.prototype.addUser = function(args) {
  var host = args[0];
  var user = args[1];
  if (!(host && user)) {
    return SureliaError.invalidArgument("Must specify host and user.");
  }

  var dir = [config.home, config.maildir, host, user + "@" +host];
  var dirs = dir.join("/").split("/");
  var d = "";
  for (var i = 0; i < dirs.length-1; i ++) {
    d += "/" + dirs[i];
    try {
      fs.mkdirSync(d, 0700);
    }
    catch (e) {
      console.log(e);
    }
  }
  d += "/" + dirs[dirs.length - 1];
  exec("maildirmake " + d, function(){
    return true;
  });

}

User.prototype.setPassword = function(args, cb) {
  var username = args[0];
  var domain;
  var oldPassword = args[1];
  var newPassword = args[2];

  if (!(username && oldPassword && newPassword)) {
    return cb(SureliaError.invalidArgument("Must specify username and passwords."));
  }

  var u = username.split("@");
  if (u.length != 2) {
    return cb(SureliaError.invalidArgument("Incorrect username"));
  }

  username = u[0];
  domain = u[1];

  if (!(username && domain)) {
    return cb(SureliaError.invalidArgument("Must specify username and domain."));
  }

  var findDomain = function(domain, cb) {
    domainModel.findOne({name: domain}, function(err, domainData) {
      if (err) {
        return cb(SureliaError.internalError(err));
      }
      if (domainData == null) {
        return cb(SureliaError.invalidArgument("Unknown domain"));
      }
      cb(domainData._id);
    });
  };

  var findUser = function(username, domain, cb) {
    findDomain(domain, function(domainId) {
      user.findOne({username: username, domain: domainId}).exec(function(err, doc) {
        if (err) {
          return cb(SureliaError.internalError(err));
        }
        cb(doc);
      });
    });
  }

  console.log('Changing password for username : ' + username + ' at ' + domain);
  findUser(username, domain, function(doc) {
    if (doc && !(doc instanceof SureliaError)) {
      doc.auth(oldPassword, function(ok) {
        if (ok != true) {
          return cb(SureliaError.invalidData("oldPassword"));
        }

        var id = doc._id;
        doc.setPassword(newPassword, function(hash) {
          doc.update({$set: {hash: hash}}, function(err, saved) {
            if (err) {
              return cb(SureliaError.internalError(err));
            }

            return cb(saved == 1);

          });
        });
      });
    } else {
      return cb(false);
    }
  });
}

User.prototype.profile = function(args, cb) {
  var username = args[0];
  var domain;

  if (!(username)) {
    return cb(SureliaError.invalidArgument("Must specify username."));
  }

  var u = username.split("@");
  if (u.length != 2) {
    return cb(SureliaError.invalidArgument("Incorrect username"));
  }

  username = u[0];
  domain = u[1];

  if (!(username && domain)) {
    return cb(SureliaError.invalidArgument("Must specify username and domain."));
  }

  var findDomain = function(domain, cb) {
    domainModel.findOne({name: domain}, function(err, domainData) {
      if (err) {
        return cb(SureliaError.internalError(err));
      }
      if (domainData == null) {
        return cb(SureliaError.invalidArgument("Unknown domain"));
      }
      cb(domainData._id);
    });
  };

  var findUser = function(username, domain, cb) {
    findDomain(domain, function(domainId) {
      user.findOne({username: username, domain: domainId}).exec(function(err, doc) {
        if (err) {
          return cb(SureliaError.internalError(err));
        }
        cb(doc);
      });
    });
  }

  findUser(username, domain, function(doc) {
    if (doc) {
      if (doc.profile &&
        doc.profile.id &&
        doc.profile.name &&
        doc.profile.organization) {
        return cb(doc.profile);
      } else if (doc.profile &&
        doc.profile.id) {
        var bkn = new bknScrapper();
        bkn.getData(doc.profile.id, function(data) {
          var profile = {
            id: data.NIP,
            name: data.Nama,
            title: data.Jabatan,
            class: data["Golongan Ruang (TMT)"],
            organization: data["Instansi Kerja"],
            state: data["Kedudukan PNS"],
            oldId: data["NIP Lama"],
            lastEducation: data["Pendidikan Terakhir"],
            unit: data["Unit Kerja"],
            parentUnit: data["Unit Kerja Induk"],
          }

          doc.update({$set: { profile: profile }}, function(err, saved) {
            if (err) {
              return cb(SureliaError.internalError(err));
            }
            return cb(profile);
          });
        });
      } else {
        return cb("NO DATA");
      }
    } else {
      return cb(false);
    }
  });
}

/**
 * Update an alias of an address
 * Input: {String[]} args Function arguments
 *          args[0]: alias address
 *          args[1]: source address, if source is empty then remove the alias
 *
 * HOME and MAILDIR are the home and maildir values in config.js respectively
 *
 * source is made of sourceUsername + @ + sourceDomain
 * alias is made of aliasUsername + @ + aliasDomain
 *
 * This function makes symbolic links from source mailbox to alias mailbox
 * source mailbox:
 * /HOME/MAILDIR/sourceDomain/sourceUsername@sourceDomain
 * alias symlink:
 * /HOME/MAILDIR/aliasDomain/aliasUsername@aliasDomain
 *
 * If no source is specified, then we remove the alias symlink
*/
User.prototype.updateAlias = function(args, cb) {
  var alias = args[0];
  var source = args[1];
  var domain;

  var u = alias.split("@");
  if (u.length != 2) {
    return cb(SureliaError.invalidArgument("Incorrect alias"));
  }

  var aliasUsername = u[0];
  var aliasDomain = u[1];

  var aliasDir = [config.home, config.maildir, aliasDomain, aliasUsername + "@" + aliasDomain];

  if (!source) {
    // No source means deletion
    fs.unlinkSync(aliasDir.join("/"));
    return cb(null);
  }

  var u = source.split("@");
  if (u.length != 2) {
    return cb(SureliaError.invalidArgument("Incorrect source"));
  }

  var sourceUsername = u[0];
  var sourceDomain = u[1];
  var sourceDir = [config.home, config.maildir, sourceDomain, sourceUsername + "@" + sourceDomain];

  fs.symlinkSync(sourceDir.join("/"), aliasDir.join("/"));

  return cb(null);
}

User.prototype.resetPassword = function(args, cb) {
  var username = args[0];
  var domain;
  var newPassword = genPass.generate({
      length: 15,
      excludeSimilarCharacters: true,
      numbers: true
  });

  if (!(username)) {
    return cb(SureliaError.invalidArgument("Must specify username."));
  }

  var u = username.split("@");
  if (u.length != 2) {
    return cb(SureliaError.invalidArgument("Incorrect username"));
  }

  username = u[0];
  domain = u[1];

  if (!(username && domain)) {
    return cb(SureliaError.invalidArgument("Must specify username and domain."));
  }

  var findDomain = function(domain, cb) {
    domainModel.findOne({name: domain}, function(err, domainData) {
      if (err) {
        return cb(SureliaError.internalError(err));
      }
      if (domainData == null) {
        return cb(SureliaError.invalidArgument("Unknown domain"));
      }
      cb(domainData._id);
    });
  };

  var findUser = function(username, domain, cb) {
    console.log('findUser');
    console.log(username);
    console.log(domain);
    findDomain(domain, function(domainId) {
      user.findOne({username: username, domain: domainId}).exec(function(err, doc) {
        if (err) {
          return cb(SureliaError.internalError(err));
        }
        if (!doc) {
          return cb(SureliaError.invalidArgument("Unknown username"));
        }
        console.log(doc);
        if (doc.profile && doc.profile.email) {
          cb(doc);
        } else {
          return cb(null);
        }
      });
    });
  }

  console.log('Reset password for username : ' + username + ' at ' + domain);
  findUser(username, domain, function(doc) {
    if (doc && !(doc instanceof SureliaError)) {
      var id = doc._id;
      doc.setPassword(newPassword, function(hash) {
        doc.update({$set: {hash: hash}}, function(err, saved) {
          if (err) {
            return cb(SureliaError.internalError(err));
          }

          var transporter = nodemailer.createTransport(config.smtpTransport);
          var mailOptions = {
            from: '"Administrator PNSMail" <no-reply@pnsmail.go.id>',
            to: doc.profile.email,
            subject: 'Sandi Anda telah diganti',
            text: 'Sandi akun ' + username + '@' + domain +' telah diganti menjadi\n\n   ' + newPassword + '\n\nSetelah login, silakan langsung ganti sandi ini.\nTerima kasih,\nAdministrator PNSMail'
          };

          // Don't wait for it to be sent
          transporter.sendMail(mailOptions, function(error, info){
            if(error){
              return console.log(error);
            }
            console.log('Message sent: ', mailOptions, info.response);
          });

          return cb(saved == 1);
        });
      });
    } else {
      return cb(false);
    }
  });
}


module.exports = new User();
