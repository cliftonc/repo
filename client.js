#!/usr/bin/env node

var nconf = require('nconf')
  , optimist = require('optimist')
  , fs = require('fs')
  , path = require('path')
  , util = require('util')
  , command = require('./lib/command')
  , watch = require('./lib/watch');

// Configure nconf
nconf.argv()
     .file({ file: __dirname + '/conf/' + (process.env.NODE_ENV || 'development') + '.json' });

var url = "http://" + nconf.get('host') + ":" + nconf.get('port')
  , externalUrl = "http://" + nconf.get('externalUrl')
  , argv = optimist
    .usage(command.help())
    .default({ u: externalUrl, a: false})
    .describe('u', 'The base URL of the repo server (e.g. http://repo.dailymail.co.uk)')
    .alias('u', 'url')
    .demand(['u'])    
    .describe('a', 'Watch for changes and automatically publish this version to the repository.')
    .alias('a', 'auto')    
    .boolean('a')
    .describe('f', 'Force publish over the top of live versions without warning or confirmation - be v. careful.')
    .alias('f', 'force')    
    .boolean('f')
    .argv;

if (argv.h) {
  optimist.showHelp();
  process.exit(0);
}


// Convert the arguments into commands and create a client command object
var commandName = argv._[0],    
    command = command.init({url: externalUrl, force: argv.force, params: argv._.slice(1,argv._.length)});

// Execute the command if it exists.
if(argv.auto && commandName == 'publish') {  

 if(argv.force) return watch(function() { command['publish']() }); 

 // First we need to check if this version is the current live version
 command.isLiveVersion(function(isLiveVersion, versionInfo) {

    if(isLiveVersion) return console.log("WARNING".red + " you cannot automatically publish changes to the current live version, please create a new version or publish manually.")
    watch(function() { command['publish']() }); 

 });
 

} else {

  command[commandName] ? command[commandName]() : optimist.showHelp();

}
