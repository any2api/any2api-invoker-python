var pkg = require('./package.json');

var debug = require('debug')(pkg.name);
var path = require('path');
var async = require('async');
var _ = require('lodash');
var shortId = require('shortid');

var util = require('any2api-util');



util.readInput(null, function(err, apiSpec, params) {
  if (err) throw err;

  var config = params.invoker_config || {};

  if (!config.cmd) {
    console.error('invoker_config.cmd parameter missing');

    process.exit(1);
  }

  config.version = config.version || '2.7.8';
  config.access = config.access || 'local';
  config.stdin = config.stdin || '';

  var runParams = params._;
  delete params._;

  runParams.run_id = runParams.run_id || uuid.v4();

  if (!runParams.run_path) {
    console.error('_.run_path parameter missing');

    process.exit(1);
  }

  var executable = apiSpec.executables[runParams.executable_name];

  var origExecDir = path.resolve(apiSpec.apispec_path, '..', executable.path);
  var execDir = path.join('/', 'tmp', shortId.generate());

  var pyenvStatusFile = path.join('/', 'opt', 'pyenv_installed');

  var access;

  if (config.access === 'local') {
    access = require('any2api-access').Local(config);
  } else if (config.access === 'ssh') {
    access = require('any2api-access').SSH(config);
  } else {
    throw new Error('access \'' + config.access + '\' not supported');
  }

  var commands = {
    install: [
      'if type apt-get > /dev/null; then sudo apt-get -y update && sudo apt-get -y install curl git; fi',
      'if type yum > /dev/null; then sudo yum -y install curl git; fi',
      'curl -L https://raw.githubusercontent.com/yyuu/pyenv-installer/master/bin/pyenv-installer | sudo bash'
      //'echo \'export PYENV_ROOT="$HOME/.pyenv"\' >> ~/.bash_profile',
      //'echo \'export PATH="$PYENV_ROOT/bin:$PATH"\' >> ~/.bash_profile',
      //'echo \'eval "$(pyenv init -)"\' >> ~/.bash_profile',
      //'echo \'eval "$(pyenv virtualenv-init -)"\' >> ~/.bash_profile',
      //'source ~/.bash_profile'
    ].join(' && '),
    run: [
      'export HOME="/root"',
      'export PYENV_ROOT="$HOME/.pyenv"',
      'export PATH="$PYENV_ROOT/bin:$PATH"',
      'eval "$(pyenv init -)"',
      'eval "$(pyenv virtualenv-init -)"',
      'pyenv install ' + config.version,
      'pyenv rehash',
      'pyenv virtualenv ' + config.version + ' ' + runParams.run_id,
      'pyenv activate ' + runParams.run_id,
      'pip install -r requirements.txt',
      'echo "' + config.stdin + '" | ' + config.cmd
    ].join(' && ')
  };



  var install = function(done) {
    async.series([
      function(callback) {
        access.exec({ command: commands.install }, function(err, stdout, stderr) {
          if (stderr) console.error(stderr);
          if (stdout) console.log(stdout);

          if (err) {
            err.stderr = stderr;
            err.stdout = stdout;

            return callback(err);
          }

          callback();
        });
      },
      async.apply(access.writeFile, { path: pyenvStatusFile, content: 'installed' })
    ], done);
  };

  var run = function(done) {
    async.series([
      async.apply(access.remove, { path: execDir }),
      async.apply(access.mkdir, { path: path.join(execDir, '..') }),
      async.apply(access.copyDirToRemote, { sourcePath: origExecDir, targetPath: execDir }),
      function(callback) {
        access.exists({ path: path.join(execDir, 'requirements.txt') }, function(err, exists) {
          if (err || exists) return callback(err);

          access.writeFile({ path: path.join(execDir, 'requirements.txt'), content: config.requirements || '' }, callback);
        });
      },
      async.apply(util.writeParameters, { apiSpec: apiSpec,
                                          executable_name: runParams.executable_name,
                                          parameters: params,
                                          remotePath: execDir,
                                          access: access }),
      function(callback) {
        var options = { path: execDir };

        if (config.env) options.env = config.env;

        access.exec({ command: commands.run, options: options }, function(err, stdout, stderr) {
          if (stderr) console.error(stderr);
          if (stdout) console.log(stdout);

          if (err) {
            err.stderr = stderr;
            err.stdout = stdout;

            return callback(err);
          }

          callback();
        });
      },
      async.apply(util.collectResults, { apiSpec: apiSpec,
                                         executable_name: runParams.executable_name,
                                         localPath: runParams.run_path,
                                         remotePath: execDir,
                                         access: access })
    ], done);
  };



  async.series([
    function(callback) {
      access.exists({ path: pyenvStatusFile }, function(err, exists) {
        if (err) callback(err);
        else if (!exists) install(callback);
        else callback();
      });
    },
    async.apply(run)
  ], function(err) {
    async.series([
      async.apply(access.terminate)
    ], function(err2) {
      if (err) throw err;

      if (err2) console.error(err2);
    });
  });
});
