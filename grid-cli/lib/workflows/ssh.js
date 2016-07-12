'use strict';

const async        = require('async');
const fs           = require('fs');
const path         = require('path');
const chalk        = require('chalk');
const shelljs      = require('shelljs');
const keygen       = require('ssh-keygen2');
const exec         = require('child_process').exec;
const sshexec      = require('ssh-exec');
const Common       = require('../common.js');

var SSH = {
  /**
   * Use the utility `ssh-copy-id` to copy local public key to
   * remote server
   *
   * @param {String} hostfile file containing a list of server (format: user:ip)
   * @param {String} [custom_key="$HOME/.ssh/id_rsa.pub"] optionnal path of a custom ssh key
   * @param {Object} opts object
   * @param {String} opts.only IP to copy key only
   */
  copy_public_key : function(hostfile, custom_key, opts) {
    Common.parseHostfile(hostfile)
      .then(function(content) {
      return new Promise((resolve, reject) => {
        var ret = [];

        var hosts = content.trim().split('\n');

        var ssh_copy_id = path.join(__dirname, '..', 'lib', 'ssh-copy-id');

        async.forEachLimit(hosts, 1, (host, next) => {
          var ip = host.split(':')[1];
          var user = host.split(':')[0];

          if (opts.only && opts.only != ip) {
            console.log('---> Skipping %s', ip);
            return next();
          }
          console.log(chalk.blue.bold('===> Copying key to : %s@%s'), user, ip);

          var cmd = ssh_copy_id;

          if (custom_key)
            cmd += ' -i ' + custom_key;

          cmd += ' ' + user + '@' + ip;

          console.log(cmd);
          ret.push(cmd);

          shelljs.exec(cmd, function(code, stdout, stderr) {
            next();
          });
        }, e => {
          if (e) return reject(e);
          return resolve(ret);
        });
      });
    })
  },
  /**
   * Provision a node via SSH
   * 1/ SCP the local install.sh script
   * 2/ Run install.sh (install Node.js+PM2+Gridcontrol)
   *
   * @param {String} username username to connect via ssh
   * @param {String} ip ip to connect to
   * @param {String} namespace grid name
   * @param {Object} opts
   * @param {String} [opts.key="$HOME/.ssh/id_rsa.pub"] key to connect with
   */
  provision_target : function(username, ip, namespace, opts) {
    return new Promise((resolve, reject) => {
      var scp_copy_command;
      var strssh = username + '@' + ip;

      if (opts.key)
        scp_copy_command = 'scp -i ' + opts.key + ' ' + __dirname + '/../lib/install.sh ' + strssh + ':/tmp';
      else
        scp_copy_command = 'scp ' + __dirname + '/../lib/install.sh ' + strssh + ':/tmp';

      var child = shelljs.exec(scp_copy_command);

      console.log(chalk.bold('Copying install script:'), chalk.italic.grey(scp_copy_command));

      shelljs.exec(scp_copy_command, function(code, stdout, stderr) {
        if (code != 0) return reject(new Error(stderr));
        console.log(chalk.bold.green('✓ Install script copied successfully'));
        return resolve();
      });
    }).then(function() {
      return new Promise((resolve, reject) => {
        var install_script = "PS1='$ ' source ~/.bashrc; cat /tmp/install.sh | GRID=" + namespace + " bash"

        var ssh_opts = {
          user : username,
          host : ip
        };

        if (opts.key) {
          ssh_opts.key = opts.key;
        }

        console.log(chalk.bold('Connecting to remote and starting install script'));
        var stream = sshexec(install_script, ssh_opts);

        stream.on('data', function(dt) {
          process.stdout.write(dt.toString());
        });

        stream.on('warn', function(dt) {
          process.stderr.write(dt.toString());
        });

        stream.on('error', function(dt) {
          reject(dt);
        });

        stream.on('exit', function(e) {
          resolve(e)
        });
      });
    });
  },
  recover : function(hosts, gridname, opts) {
    console.log(chalk.bold('☢ Launching recovery for %s hosts'), hosts.length);
    console.log(chalk.bold('☢ Forcing grid name %s'), gridname);
    return new Promise((resolve, reject) => {
      async.forEachLimit(hosts, 1, function(host, next) {
        var cmd  = "PS1='$ ' source ~/.bashrc; GRID=" + gridname + " pm2 restart gridcontrol";
        var user = host.split(':')[0];
        var ip   = host.split(':')[1];

        var ssh_opts = {
          user : user,
          host : ip
        };

        if (opts.key) {
          ssh_opts.key = opts.key;
        }

        console.log(chalk.bold.blue('Operating on host %s:%s'), user, ip);

        sshexec(cmd, ssh_opts, function(err, stdout, stderr) {
          if (stdout)
            console.log(stdout);
          next();
        });

      }, function(err) {
        shelljs.exec('GRID=' + gridname + ' pm2 restart gridcontrol', function() {
          console.log(chalk.bold('Done.'));
          resolve();
        });
      });
    });

  },
  generate_keypair : function(name, cb) {
    return new Promise((resolve, reject) => {
      var opts = {
        type    : 'rsa',
        bits    : 2048,
        comment : 'grid-keys'
      };

      keygen(opts, function (err, keypair) {
        if (err) return reject(err);
        resolve(keypair);
      });
    });
  }
};

module.exports = SSH;