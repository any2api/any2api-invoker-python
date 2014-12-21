var pkg = require('../package.json');

var debug = require('debug')(pkg.name);
var path = require('path');
var async = require('async');
var _ = require('lodash');
var shortId = require('shortid');

var util = require('any2api-util');



module.exports = function(spec) {
  var obj = {};

  obj.invoke = function(args, done) {
    args = args || {};

    var apiSpec = args.apiSpec;
    if (!apiSpec) return done(new Error('API spec missing'));

    var params = args.parameters;
    if (!params) return done(new Error('parameters missing'));

    var config = params.invoker_config || {};

    if (!config.cmd) return done(new Error('invoker_config.cmd parameter missing'));

    config.version = config.version || '2.7.8';
    config.access = config.access || 'local';
    config.stdin = config.stdin || '';
    config.env = config.env || {};
    config.env.PYENV_ROOT = config.env.PYENV_ROOT || '/opt/pyenv';

    var runParams = params._;
    delete params._;

    runParams.run_id = runParams.run_id || uuid.v4();

    if (!runParams.run_path) return done(new Error('_.run_path parameter missing'));

    var executable = apiSpec.executables[runParams.executable_name];

    var origExecDir = path.resolve(apiSpec.apispec_path, '..', executable.path);
    var execDir = path.join('/', 'tmp', shortId.generate());

    var access;

    if (config.access === 'local') {
      access = require('any2api-access').Local(config);
    } else if (config.access === 'ssh') {
      access = require('any2api-access').SSH(config);
    } else {
      return done(new Error('access \'' + config.access + '\' not supported'));
    }

    var commands = {
      install: [
        'if type apt-get > /dev/null; then sudo apt-get -y update && sudo apt-get -y install curl git; fi',
        'if type yum > /dev/null; then sudo yum -y install curl git; fi',
        //'export PYENV_ROOT="/opt/pyenv"',
        'curl -L https://raw.githubusercontent.com/yyuu/pyenv-installer/master/bin/pyenv-installer | bash' // sudo -E bash
        //'echo \'export PYENV_ROOT="$HOME/.pyenv"\' >> ~/.bash_profile',
        //'echo \'export PATH="$PYENV_ROOT/bin:$PATH"\' >> ~/.bash_profile',
        //'echo \'eval "$(pyenv init -)"\' >> ~/.bash_profile',
        //'echo \'eval "$(pyenv virtualenv-init -)"\' >> ~/.bash_profile',
        //'source ~/.bash_profile'
      ].join(' && '),
      run: [
        //'export PYENV_ROOT="/opt/pyenv"',
        //'export PYENV_ROOT="$HOME/.pyenv"',
        'export PATH="$PYENV_ROOT/bin:$PATH"',
        'eval "$(pyenv init -)"',
        'eval "$(pyenv virtualenv-init -)"',
        'pyenv install -s ' + config.version,
        'pyenv rehash',
        'pyenv virtualenv -f ' + config.version + ' ' + runParams.run_id,
        'pyenv activate ' + runParams.run_id,
        'pip install -r requirements.txt',
        'echo "' + config.stdin + '" | ' + config.cmd
      ].join(' && ')
    };



    var install = function(done) {
      async.series([
        function(callback) {
          access.exec({ command: commands.install, env: config.env }, function(err, stdout, stderr) {
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);

            if (err) {
              err.stderr = stderr;
              err.stdout = stdout;

              return callback(err);
            }

            callback();
          });
        }
        //async.apply(access.writeFile, { path: pyenvStatusFile, content: 'installed' })
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
          access.exec({ command: commands.run, env: config.env, path: execDir }, function(err, stdout, stderr) {
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
        access.exists({ path: config.env.PYENV_ROOT }, function(err, exists) {
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
        //TODO merge err with err2 using VError
        if (err2) console.error(err2);

        done(err);
      });
    });
  };

  return obj;
};
