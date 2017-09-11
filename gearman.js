var SureliaError = require("./error");
var user = require("./user");
var config = require("./config");
var gearmanode = require("gearmanode");
var mongoose = require("mongoose");
var sqlite3 = require("sqlite3");
var os = require("os");
var _ = require("lodash");

mongoose.connect(config.db)
var worker = gearmanode.worker({servers: config.gearmand});

var stringifyDate = function(date) {
  return date.getFullYear() + "-" +
    ((date.getMonth() + 1) < 10 ? "0" : "") +
    (date.getMonth() + 1) + "-" +
    (date.getDate() < 10 ? "0" : "") +
    date.getDate();
}

worker.addFunction("statProcessMailbox", function(job) {
  var spawn = require("child_process").spawn,
      mta = spawn("pidof", ["qmail-send"]),
      imap = spawn("pidof", ["dovecot"]),
      smtp = spawn("pidof", ["tcpserver"]);

  var states = {};

  imap.on('close', function (code) {
    if (code == 1) {
      states["imap"] = "not running";
      check();
    } else {
      states["imap"] = "running";
      check();
    }
  });

  smtp.on('close', function (code) {
    if (code == 1) {
      states["smtp"] = "not running";
      check();
    } else {
      states["smtp"] = "running";
      check();
    }
  });

  mta.on('close', function (code) {
    if (code == 1) {
      states["mta"] = "not running";
      check();
    } else {
      states["mta"] = "running";
      check();
    }
  });

  var check = function() {
    if (states.mta &&
        states.imap &&
        states.smtp) {
      job.workComplete(JSON.stringify({result: states}));
    }
  }

});


worker.addFunction("statOS", function(job) {
  var retval = {
    name: os.type(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    load: os.loadavg(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus(),
    networkInterfaces: os.networkInterfaces(),

  }
  job.workComplete(JSON.stringify({result: retval}));
});

worker.addFunction("statTopReceiver", function(job) {
  var payload = {};
  if (job.payload && job.payload.length > 0) {
    payload = JSON.parse(job.payload.toString());
  }
  var startDate = new Date(), endDate = new Date(startDate);

  startDate.setYear(2000);

  if (payload.startDate) {
    startDate = new Date(payload.startDate);
  }
  if (payload.endDate) {
    endDate = new Date(payload.endDate);
  }

  var db = new sqlite3.Database(config.stat);
  var retval = [];

  db.serialize(function() {
    var start = stringifyDate(startDate);
    var end = stringifyDate(endDate);

    var query = "select eto, sum(size) as size from stat where target=0 and strftime('%Y-%m-%d', start) between '" + start + "' and '" + end + "' group by eto order by size desc limit 20";
    console.log(query);
    db.each(query, function(err, row) {
      retval.push({
        address: row.eto.replace(config.statStripEmail, ""),
        size: row.size
      });
    }, function() {
      db.close();
      job.workComplete(JSON.stringify({result: retval}));
    });
  });
});

worker.addFunction("statTopFailures", function(job) {
  var payload = {};
  if (job.payload && job.payload.length > 0) {
    payload = JSON.parse(job.payload.toString());
  }
  var startDate = new Date(), endDate = new Date(startDate);

  startDate.setYear(2000);

  if (payload.startDate) {
    startDate = new Date(payload.startDate);
  }
  if (payload.endDate) {
    endDate = new Date(payload.endDate);
  }

  var db = new sqlite3.Database(config.stat);
  var retval = [];

  db.serialize(function() {
    var start = stringifyDate(startDate);
    var end = stringifyDate(endDate);

    var query = "select eto, sum(retries) as retries from stat where target=0 and strftime('%Y-%m-%d', start) between '" + start + "' and '" + end + "' group by eto order by retries desc limit 20";
    console.log(query);
    db.each(query, function(err, row) {
      retval.push({
        address: row.eto.replace(config.statStripEmail, ""),
        retries: row.retries
      });
    }, function() {
      db.close();
      job.workComplete(JSON.stringify({result: retval}));
    });
  });
});

/**
 * @param startDate start date of the stat, default is 1st of January of the current year (optional)
 * @param endDate start date of the stat, default is today (optional)
 * @param domainName the name of the domain, default is the domain name set in config.statDomain, or if it is an array the first entry in that statDomain array. If the statDomain is an array and the provided domain is not in the array, it will reject the provided domain name and using the default domain name instead.
 */
worker.addFunction("statIncomingCounter", function(job) {
  var payload = {};
  if (job.payload && job.payload.length > 0) {
    payload = JSON.parse(job.payload.toString());
  }
  var startDate = new Date(), endDate = new Date(startDate);

  startDate.setDate(1);
  startDate.setMonth(0);

  if (payload.startDate) {
    startDate = new Date(payload.startDate);
  }
  if (payload.endDate) {
    endDate = new Date(payload.endDate);
  }

  var domainName;
  // default values
  if (Array.isArray(config.statDomain)) {
    domainName = config.statDomain[0];
  } else {
    domainName = config.statDomain;
  }

  if (payload.domainName) {
    if (Array.isArray(config.statDomain)) {
      // check if it is specified in statDomain, otherwise reject it
      if (_.contains(config.statDomain, payload.domainName)) {
        domainName = payload.domainName;
      } // else will use default value
    } // else will use default value
  }
  var db = new sqlite3.Database(config.stat);
  var retval = [];

  db.serialize(function() {
    var start = stringifyDate(startDate);
    var end = stringifyDate(endDate);

    var query = "select count(1) count from stat where eto like '%@" + domainName + "' and strftime('%Y-%m-%d', start) between '" + start + "' and '" + end + "' ";
    console.log(query);
    db.each(query, function(err, row) {
      db.close();
      job.workComplete(JSON.stringify({result: row}));
    });
  });
});

/**
 * @param startDate start date of the stat, default is 1st of January of the current year (optional)
 * @param endDate start date of the stat, default is today (optional)
 * @param domainName the name of the domain, default is the domain name set in config.statDomain, or if it is an array the first entry in that statDomain array. If the statDomain is an array and the provided domain is not in the array, it will reject the provided domain name and using the default domain name instead.
 */
worker.addFunction("statOutgoingCounter", function(job) {
  var payload = {};
  if (job.payload && job.payload.length > 0) {
    payload = JSON.parse(job.payload.toString());
  }
  var startDate = new Date(), endDate = new Date(startDate);

  startDate.setDate(1);
  startDate.setMonth(0);

  if (payload.startDate) {
    startDate = new Date(payload.startDate);
  }
  if (payload.endDate) {
    endDate = new Date(payload.endDate);
  }
  var domainName;
  // default values
  if (Array.isArray(config.statDomain)) {
    domainName = config.statDomain[0];
  } else {
    domainName = config.statDomain;
  }

  if (payload.domainName) {
    if (Array.isArray(config.statDomain)) {
      // check if it is specified in statDomain, otherwise reject it
      if (_.contains(config.statDomain, payload.domainName)) {
        domainName = payload.domainName;
      } // else will use default value
    } // else will use default value
  }

  var db = new sqlite3.Database(config.stat);
  var retval = [];

  db.serialize(function() {
    var start = stringifyDate(startDate);
    var end = stringifyDate(endDate);

    var query = "select count(1) count from stat where efrom like '%@" + domainName + "' and strftime('%Y-%m-%d', start) between '" + start + "' and '" + end + "' ";
    console.log(query);
    db.each(query, function(err, row) {
      db.close();
      job.workComplete(JSON.stringify({result: row}));
    });
  });
});




worker.addFunction("statTopRemoteFailures", function(job) {
  var payload = {};
  if (job.payload && job.payload.length > 0) {
    payload = JSON.parse(job.payload.toString());
  }
  var startDate = new Date(), endDate = new Date(startDate);

  startDate.setYear(2000);

  if (payload.startDate) {
    startDate = new Date(payload.startDate);
  }
  if (payload.endDate) {
    endDate = new Date(payload.endDate);
  }

  var db = new sqlite3.Database(config.stat);
  var retval = [];

  db.serialize(function() {
    var start = stringifyDate(startDate);
    var end = stringifyDate(endDate);

    var query = "select eto, sum(retries) as retries from stat where target=1 and retries > 0 and strftime('%Y-%m-%d', start) between '" + start + "' and '" + end + "' group by eto order by retries desc limit 20";
    console.log(query);
    db.each(query, function(err, row) {
      retval.push({
        address: row.eto.replace(config.statStripEmail, ""),
        retries: row.retries
      });
    }, function() {
      db.close();
      job.workComplete(JSON.stringify({result: retval}));
    });
  });
});



worker.addFunction("setPassword", function(job) {
  console.log('setPassword');
  // The payload should a stringified flat object
  var str = job.payload.toString('utf8').split('}')[0] + '}';
  try {
    var payload = JSON.parse(str);
    user.setPassword([payload.username, payload.oldPassword, payload.newPassword], function(result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      console.log(result);
      job.workComplete(JSON.stringify({result: result}));
    });
  } catch (e) {
    console.log("Job failed");
    console.log(e);
    console.log(job.payload.toString('utf8'));
    job.workComplete(JSON.stringify({result: false, error: e}));
  }
});

worker.addFunction("resetPassword", function(job) {
  console.log('resetPassword');
  // The payload should a stringified flat object
  var str = job.payload.toString('utf8').split('}')[0] + '}';
  try {
    var payload = JSON.parse(str);
    user.resetPassword([payload.username], function(result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      console.log(result);
      job.workComplete(JSON.stringify({result: result}));
    });
  } catch (e) {
    console.log("Job failed");
    console.log(e);
    console.log(job.payload.toString('utf8'));
    job.workComplete(JSON.stringify({result: false, error: e}));
  }
});


worker.addFunction("profile", function(job) {
  var payload = JSON.parse(job.payload.toString());
  try {
    user.profile([payload.username], function(result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      console.log(result);
      job.workComplete(JSON.stringify({result: result}));
    });
  } catch (e) {
    job.workComplete(JSON.stringify({result: false, error: e}));
  }
});

worker.addFunction("updateAlias", function(job) {
  var payload = {};
  try {
    payload = JSON.parse(job.payload.toString());
  } catch (err) {
    console.log("invalid payload JSON");
  }
  if (payload == null) {
      return job.workComplete(JSON.stringify({result: false, error: err}));
  }
  if (payload.data != null && payload.data.alias && payload.data.source) {
    user.updateAlias([payload.data.alias,payload.data.source], function(err, result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      if (err) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      job.workComplete(JSON.stringify({result: result}));
    });
  } else if (payload.data && !payload.data.source) {
    user.updateAlias([payload.data.alias,false], function(err, result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      if (err) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      job.workComplete(JSON.stringify({result: result}));
    });
  } else {
    return job.workComplete(JSON.stringify({result: false}));
  }
});

worker.addFunction("saLearn", function(job) {
  var payload = {};
  try {
    payload = JSON.parse(job.payload.toString());
  } catch (err) {
    console.log("invalid payload JSON");
  }
  if (payload == null) {
      return job.workComplete(JSON.stringify({result: false, error: err}));
  }
  if (payload != null && payload.type && payload.username && payload.messageId) {
   console.log(payload);
    var path = config.home + '/' + config.maildir + '/' + payload.username.split('@')[1] + '/' + payload.username;
    var spawn = require("child_process").spawn;
    var saLearn = spawn(__dirname + "/sa-learn.sh", [payload.type, payload.messageId, path]);
    var result = false;
    saLearn.stdout.on('data', function (data) {
      if (data.toString().indexOf('Learned') > -1) {
        result = true;
      }
    });
    saLearn.on('close', function () {
      job.workComplete(JSON.stringify({result: result}));
    });
  } else {
    return job.workComplete(JSON.stringify({result: false}));
  }
});
