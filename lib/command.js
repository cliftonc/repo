var fs = require('fs')
  , util = require('util')
  , npm = require('npm')
  , pkginfo = require('pkginfo')(module)
  , request = require('request')
  , _ = require('lodash')
  , colors = require('colors')
  , Table = require('cli-table')
  , Mustache = require('mustache');

// Simple factory
module.exports = {
	helpInformation: [
	  "\r",
	  "Repository CLI".white,
	  "\r",
		"index [type]               ".green + " --> ".grey + "get a list of all packages in this repository, optionally by type".cyan,
		"info [name]                ".green + " --> ".grey + "get information on a specific package".cyan,		
		"versions [name]            ".green + " --> ".grey + "get information on a specific package".cyan,
		"delete [name] [version|ALL]".green + " --> ".grey + "delete a package (one or all versions)".cyan
	],
	help: function() {
		return this.helpInformation.join('\n');
	},
	init: function(opts) {
		return new Command(opts);	
	}	
}

// Command Registry
function Command(opts) {		
	this.url = opts.url;
	this.params = opts.params;
}

/**
 * Return an index of all packages
 */
Command.prototype.index = function() {
	
	var self = this;
	var cmdUrl = self.url + '/index' + (self.params[0] ? '/' + self.params[0] : '');

  var printIndex = function(err, statusCode, body) {
  	
  	if (err) throw err;  

  	console.log('\r');

  	// Output via cli table
		var table = new Table({
		    head: ['Name', 'Version', 'Type', 'Description']
		  , colWidths: [30, 10, 20, 80]
		});

  	_.map(body, function(package) {
  		table.push([package.name, package.version, package.type || '', package.description]);
  	})

  	console.log(table.toString());
  	console.log('\r');

  	process.exit(0);
	}

	request({
    uri: cmdUrl,
    json: true
  }, printIndex);


}

/**
 * Get info on a specific package
 */ 
Command.prototype.info = function() {
	
	var self = this;
	if(!this.params[0]) return console.error('You need to provide a package name')
	
  var printInfo = function(err, response, body) {
  	if (err) throw err;  	
  	if(response.statusCode !== 200) return console.log('ERROR '.red + (response.statusCode == 404 ? ' Unable to locate a package by that name' : 'Error'))
  	
		console.log('\r');

  	// Output via cli table
		var table = new Table({
		  colWidths: [30, 120]
		});

		// Row by row
		table.push({'Name': body.name});		
		table.push({'Type': body.type || ''});		
		table.push({'Description': body.description});	
		table.push({'Version': body.version});
		table.push({'Versions': body.versionList});			
		table.push({'Readme': body.readme});			

  	console.log(table.toString());
  	console.log('\r');

  	process.exit(0);
	}

	var cmdUrl = self.url + '/info/' + this.params[0];
  request({
    uri: cmdUrl,
    json: true
  }, printInfo)


}

/**
 * Get info on a specific package
 */ 
Command.prototype.versions = function() {
	
	var self = this;
	if(!this.params[0]) return console.error('You need to provide a package name')

	
  var printInfo = function(err, statusCode, body) {
  	if (err) throw err;
  	console.dir(body);
  	process.exit(0);
	}

	var cmdUrl = self.url + '/versions/' + this.params[0];
  request({
    uri: cmdUrl,
    json: true
  }, printInfo)

}

/**
 * Get info on a specific package
 */ 
Command.prototype.delete = function() {
	
	var self = this;
	if(!this.params[0]) return console.error('You need to provide a package name')
	if(!this.params[1]) return console.error('You need to provide a package version') // ALL not implemented

  var printInfo = function(err, response, body) {
  	if (err) return console.dir(error); 
  	console.log(response.statusCode == 200 ? 'DELETED'.green : 'ERROR '.red  + JSON.parse(body).message);		
  	process.exit(0);
	}

	var cmdUrl = self.url + '/package/' + this.params[0] + '/' + this.params[1];
  request.del({
    uri: cmdUrl
  }, printInfo)

}

/**
 * Publish a specific template
 */
Command.prototype.publish = function() {

	var self = this;

	npm.load(null, function (err) {
    if (err) throw err;
    npm.commands.pack([], function (err, data, a, b) {
      if (err) throw err;

      // as described here: https://npmjs.org/api/pack.html
      var packagejson = JSON.parse(fs.readFileSync('package.json'));
      var name = packagejson.name;
      var version = packagejson.version
      var packageFile = name + '-' + version + '.tgz';
      var packageUrl = self.url + '/package/' + name + '/' + version;  
      var packageLength = fs.statSync(packageFile).size;      
      fs.createReadStream(packageFile).pipe(request.put(packageUrl, function (err, resp, body) {
        if (err) throw err;
        if (resp.statusCode === 200) {
          console.error('successfully published version ' + version + ' of ' + name + ': ' + packageUrl);
        }
        else {                    
          console.error('uh oh, something unexpected happened (' + resp.statusCode + ')');
        }
        fs.unlink(packageFile);
        console.log("done")
      }));
    });
  })

}


Command.prototype.help = function() {
	return this.help.join('\n');
}


