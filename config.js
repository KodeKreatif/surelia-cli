var config = {
  db : "mongodb://localhost/pnsmailAdmin",
  home: "/tmp/home",
  maildir: "maildir",
  gearmand: [
  { host: "localhost" }
  ],
  stat : "/tmp/stat.db",
  statStripEmail : "sureliabox-pnsmail-"
}

module.exports = config;
