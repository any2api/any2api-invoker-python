var async = require('async');
var _ = require('lodash');
var path = require('path');

var access = require('any2api-access');
var util = require('any2api-util');



module.exports = util.createInvoker({
  accessModule: access,
  gatherParameters: [ { name: 'cmd' } ],
  invoke: function(ctx, callback) {
    if (!ctx.unmappedParameters.cmd) return callback(new Error('cmd parameter missing'));

    var install = function(callback) {
      var installCommand = [
        'if type apt-get > /dev/null; then sudo apt-get -y update && sudo apt-get -y install curl git; fi',
        'if type yum > /dev/null; then sudo yum -y install curl git; fi',
        //'export PYENV_ROOT="/opt/pyenv"',
        'curl -L https://raw.githubusercontent.com/yyuu/pyenv-installer/master/bin/pyenv-installer | bash' // sudo -E bash
        //'echo \'export PYENV_ROOT="$HOME/.pyenv"\' >> ~/.bash_profile',
        //'echo \'export PATH="$PYENV_ROOT/bin:$PATH"\' >> ~/.bash_profile',
        //'echo \'eval "$(pyenv init -)"\' >> ~/.bash_profile',
        //'echo \'eval "$(pyenv virtualenv-init -)"\' >> ~/.bash_profile',
        //'source ~/.bash_profile'
      ].join(' && ');

      async.series([
        function(callback) {
          ctx.access.exec({
            command: installCommand,
            env: ctx.invokerConfig.env,
            encodingStdout: ctx.invokerConfig.encoding_stdout,
            encodingStderr: ctx.invokerConfig.encoding_stderr
          }, ctx.accessExecCallback(callback));
        }
      ], callback);
    };

    var run = function(callback) {
      var runCommand = [
        //'export PYENV_ROOT="/opt/pyenv"',
        //'export PYENV_ROOT="$HOME/.pyenv"',
        'export PATH="$PYENV_ROOT/bin:$PATH"',
        'eval "$(pyenv init -)"',
        'eval "$(pyenv virtualenv-init -)"',
        'pyenv install -s ' + ctx.invokerConfig.version,
        'pyenv rehash',
        'pyenv global ' + ctx.invokerConfig.version
      ];

      if (ctx.invokerConfig.virtualenv) {
        runCommand.push('pyenv virtualenv -f ' + ctx.invokerConfig.version + ' ' + ctx.invokerConfig.virtualenv);
        runCommand.push('pyenv activate ' + ctx.invokerConfig.virtualenv);
      }

      if (!ctx.invokerConfig.skip_requirements) {
        runCommand.push('pip install -r $INSTANCE_PATH/requirements.txt');
        runCommand.push('pyenv rehash');
      }

      runCommand.push('echo "' + ctx.invokerConfig.stdin + '" | ' + ctx.unmappedParameters.cmd);
      runCommand = runCommand.join(' && ');

      async.series([
        //async.apply(ctx.access.remove, { path: ctx.instancePath }),
        async.apply(ctx.access.mkdir, { path: ctx.instancePath }),
        async.apply(ctx.access.mkdir, { path: ctx.invokerConfig.cwd }),
        function(callback) {
          if (!ctx.executablePath) return callback();

          ctx.access.copyDirToRemote({ sourcePath: ctx.executablePath, targetPath: ctx.instancePath }, callback);
        },
        function(callback) {
          ctx.access.exists({ path: path.join(ctx.instancePath, 'requirements.txt') }, function(err, exists) {
            if (err || exists) return callback(err);

            ctx.access.writeFile({ path: path.join(ctx.instancePath, 'requirements.txt'), content: ctx.invokerConfig.requirements || '' }, callback);
          });
        },
        function(callback) {
          ctx.access.exec({
            command: runCommand,
            env: ctx.invokerConfig.env,
            //stdin: ctx.invokerConfig.stdin || '',
            cwd: ctx.invokerConfig.cwd,
            encodingStdout: ctx.invokerConfig.encoding_stdout,
            encodingStderr: ctx.invokerConfig.encoding_stderr
          }, ctx.accessExecCallback(callback));
        }
      ], callback);
    };

    ctx.invokerConfig.env.PYENV_ROOT = ctx.invokerConfig.env.PYENV_ROOT || '/opt/pyenv';
    ctx.invokerConfig.version = ctx.invokerConfig.version || '2.7.8';

    try {
      if (!_.isEmpty(ctx.invokerConfig.args)) {
        ctx.unmappedParameters.cmd = _.template(ctx.unmappedParameters.cmd)(ctx.invokerConfig.args);
      }
    } catch (err) {
      return callback(new Error('error while building command using args: ' + err.message));
    }

    async.series([
      function(callback) {
        ctx.access.exists({ path: ctx.invokerConfig.env.PYENV_ROOT }, function(err, exists) {
          if (err) callback(err);
          else if (!exists) install(callback);
          else callback();
        });
      },
      async.apply(run)
    ], callback);
  }
});
