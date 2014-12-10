
var SureliaError = require("./error");
var user = require("./user");
var config = require("./config");
var gearmanode = require("gearmanode");
var mongoose = require("mongoose");
var sqlite3 = require("sqlite3");
var os = require("os");

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
  var payload = JSON.parse(job.payload.toString());
  try {
    user.setPassword([payload.username, payload.oldPassword, payload.newPassword], function(result){
      if (result instanceof SureliaError) {
        return job.workComplete(JSON.stringify({result: false, error: result}));
      }
      console.log(result);
      job.workComplete(JSON.stringify({result: result}));
    });
  } catch (e) {
    console.log("x");
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
    user.updateAlias([payload.data.source, payload.data.alias], function(err, result){
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
