var chai = require('chai');
var expect = chai.expect;
var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var util = require('any2api-util');

var timeout = 1000 * 60 * 15; // 15 minutes

var invokerPath = path.join(__dirname, '..', '..');
var specPathScriptPy = path.join(__dirname, 'scriptpy-apispec.json');

var apiSpecScriptPy = {
  "executables": {
    "scriptpy": {
      "parameters_schema": {
        "input_file": {
          "type": "string",
          "mapping": "file",
          "file_path": "./input.txt"
        }
      },
      "results_schema": {
        "output_file": {
          "type": "string",
          "mapping": "file",
          "file_path": "./output.txt"
        }
      },
      "path": ".",
      "invoker_name": "python"
    }
  },
  "invokers": {
    "python": {
      "path": invokerPath,
      "expose": true
    }
  },
  apispec_path: specPathScriptPy
};

var runScriptPy = {
  parameters: {
    input_file: 'some input through a file',
    invoker_config: {
      env: {
        FOO: 'some input through env'
      },
      stdin: 'hello world',
      cmd: 'python script.py foo=bar',
      requirements: 'requests==2.5.0\nPyYAML==3.11\n',
      access: 'local'
    }
  }
};



var cleanup = function(done) {
  async.series([
    async.apply(fs.remove, specPathScriptPy),
    async.apply(fs.remove, path.join(invokerPath, 'node_modules'))
  ], done);
};



describe('script.py', function() {
  this.timeout(timeout);

  before(cleanup);

  before(function(done) {
    fs.writeFile(specPathScriptPy, JSON.stringify(apiSpecScriptPy), 'utf8', done);
  });

  it('prepare buildtime', function(done) {
    util.prepareBuildtime({ apiSpec: apiSpecScriptPy,
                            executable_name: 'scriptpy' }, function(err) {
                              if (err) throw err;
                              
                              done();
                            });
  });

  it('prepare executable', function(done) {
    util.prepareExecutable({ apiSpec: apiSpecScriptPy,
                             executable_name: 'scriptpy' }, function(err, updatedSpec) {
                               if (err) throw err;

                               apiSpecScriptPy = updatedSpec;

                               expect(updatedSpec.executables.scriptpy.prepared).to.be.true;

                               done();
                             });
  });

  it('prepare runtime', function(done) {
    util.prepareRuntime({ apiSpec: apiSpecScriptPy,
                          executable_name: 'scriptpy' }, function(err) {
                            if (err) throw err;
                            
                            done();
                          });
  });

  it('invoke executable', function(done) {
    util.invokeExecutable({ apiSpec: apiSpecScriptPy,
                            executable_name: 'scriptpy',
                            run: runScriptPy }, function(err, run) {
                              if (err) throw err;

                              expect(run.finished).to.exist;

                              console.log(run);

                              done();
                            });
  });

  after(cleanup);
});
