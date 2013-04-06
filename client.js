#!/usr/bin/env node

var optimist = require('optimist')
  , command = require('./lib/command');

var argv = optimist
    .usage(command.help())
    .default({ u: 'http://127.0.0.1:8081'})
    .describe('u', 'The base URL of the repo server (e.g. http://repo.dailymail.co.uk:8080)')
    .alias('u', 'url')
    .demand(['u'])
    .argv;

if (argv.h) {
  optimist.showHelp();
  process.exit(0);
}

// Convert the arguments into commands and create a client command object
var commandName = argv._[0],    
    command = command.init({url: argv.url, params: argv._.slice(1,argv._.length)});

// Execute the command if it exists.
command[commandName] ? command[commandName]() : optimist.showHelp();

