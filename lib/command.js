var fs = require('fs')
  , path = require('path')
  , util = require('util')
  , npm = require('npm')
  , pkginfo = require('pkginfo')(module)
  , request = require('request')
  , _ = require('lodash')
  , colors = require('colors')
  , tar = require('tar')
  , jf = require('jsonfile')
  , zlib = require('zlib')
  , rimraf = require('rimraf')
  , semver = require('semver')
  , mkdirp = require('mkdirp')
  , Table = require('cli-table')
  , Logo = require('./logo.js')
  , prompt = require('prompt')
  , Mustache = require('mustache');

prompt.start();

// Simple factory
module.exports = {
	helpInformation: [
	  "\r",
	  Logo.join('\r\n'),
	  "\r",
		"publish                    ".green + " --> ".grey + "publish the package in the current directory to the repository".cyan,
    "fetch [name] [version]     ".green + " --> ".grey + "fetch the package from the repository and extract in the current directory".cyan,
    "bump                       ".green + " --> ".grey + "bump the version number of the current package (x.x.+)".cyan,
    "index [type]               ".green + " --> ".grey + "get a list of all packages in this repository, optionally by type".cyan,
    "search [term]              ".green + " --> ".grey + "search by name, description and readme file".cyan,
		"info [name]                ".green + " --> ".grey + "get information on a specific package".cyan,		
		"versions [name]            ".green + " --> ".grey + "get information on a specific package".cyan,
		"live [name] [version]      ".green + " --> ".grey + "set a version of a package to the live version".cyan,
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
	this.url = opts.url + '/api';
  this.force = opts.force;
	this.params = opts.params;
}

/**
 * Return an index of all packages
 */
Command.prototype.index = function() {
	
	var self = this;
	var cmdUrl = self.url + '/index';  

  if(self.params[0]) {
      console.log('\r\nShowing by ALL packages ...\r'.green)
  }

	request({
    uri: cmdUrl,
    json: true
  }, self._printIndexCallback());

}

Command.prototype.type = function() {
  
  var self = this;
  if(!this.params[0]) return console.error('You need to provide a type')
  var cmdUrl = self.url + '/index/type/' + self.params[0];  

  if(self.params[0]) {
      console.log('\r\nShowing by type: '.green + self.params[0] + '\r')
  }

  request({
    uri: cmdUrl,
    json: true
  }, self._printIndexCallback());

}


Command.prototype.bump = function() {
  
  var self = this;
  
  var pkgJson = JSON.parse(fs.readFileSync("package.json"));

  var version = pkgJson.version || "0.0.0",
      versionSplit = version.split(".");

  if(versionSplit.length !== 3) console.log("Error - version appears invalid: " + version);

  var dot = versionSplit[2],
      dotPlusOne = parseInt(dot) + 1;

  versionSplit[2] = dotPlusOne;

  pkgJson.version = versionSplit.join('.');

  jf.writeFileSync("package.json", pkgJson);

  console.log('Version bumped OK'.green);

}


Command.prototype.search = function() {
  
  var self = this;
  if(!this.params[0]) return console.error('You need to provide a search term')

  var cmdUrl = self.url + '/index/search/' + self.params[0];      
  
  console.log('\r\nSearching for: '.green + self.params[0] + '\r')

  request({
    uri: cmdUrl,
    json: true
  }, self._printIndexCallback());

}

Command.prototype._printIndexCallback = function() {

    var self = this;

    return function(err, response, body) {
  
      if (err || body.message) return console.log('\rError: '.red + body.message + '\r');

      console.log('\r');

      // Output via cli table
      var table = new Table({
          head: ['Name', 'Latest', 'Live', 'Type', 'Description', 'HTML', 'CSS', 'JS']
        , colWidths: [30, 10, 10, 20, 80, 6, 6, 6]
      });

      _.map(body, function(package) {
        table.push([
            package.name, 
            package.latest, 
            package.live, 
            package.type || '', 
            package.description, 
            (package.html == 'Y' ? package.html.green : package.html.red), 
            (package.css == 'Y' ? package.css.green : package.css.red), 
            (package.js == 'Y' ? package.js.green : package.js.red)]
        );
      })

      console.log(table.toString());
      console.log('\r');

      process.exit(0);

    }
  
}

/**
 * Get info on a specific package
 */ 
Command.prototype.info = function() {
	
	var self = this;

  self._nameVersion();

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
		table.push({'Latest': body.latest});
    table.push({'Live': body.live});
		table.push({'Versions': body.versionList.join(', ')});			
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
  self._nameVersion();

  var name = this.params[0];
  if(!name) return console.error('You need to provide a package name')

  var printInfo = function(err, statusCode, body) {
  	if (err) throw err;
  	console.dir(body);
  	process.exit(0);
	}

	var cmdUrl = self.url + '/versions/' + name;
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
 * Get info on a specific package
 */ 
Command.prototype.live = function() {
  
  var self = this;
  if(!this.params[0]) return console.error('You need to provide a package name')
  if(!this.params[1]) return console.error('You need to provide a package version') // ALL not implemented

  var printInfo = function(err, response, body) {
    if (err) return console.dir(error); 
    console.log(response.statusCode == 200 ? 'OK'.green : 'ERROR '.red  + JSON.parse(body).message);   
    process.exit(0);
  }

  var cmdUrl = self.url + '/package/' + this.params[0] + '/live/' + this.params[1];
  request.post({
    uri: cmdUrl
  }, printInfo)

}

/**
 * Publish a specific template
 */
Command.prototype.publish = function() {

	var self = this;

  if(self.force) return doPublish();

  self.isLiveVersion(function(isLiveVersion, versionInfo) {

    if(isLiveVersion) {

      console.log("WARNING".red + " you cannot publish changes to the current live version, please create a new version or publish manually.")
      prompt.get({
          properties: {
            continue: {
              description: "Please type Y to continue".magenta
            }
          }
        }, function (err, result) {

          if(result.continue == 'y' || result.continue == 'Y') doPublish();

      });
    } else {
      doPublish();
    }

  })

  function doPublish() {
    npm.load({loglevel:'error'}, function (err) {
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
            console.log('Successfully published version ' + version + ' of ' + name + ': ' + packageUrl);
          }
          else {                    
            console.error('uh oh, something unexpected happened (' + resp.statusCode + ')');
          }
          fs.unlink(packageFile);        
        }));
      });
    });
  }


}

/**
 * Publish a specific template
 */
Command.prototype.isLiveVersion = function(callback) {

  var self = this;

  var packagejson = JSON.parse(fs.readFileSync('package.json'));
  var name = packagejson.name;
  var version = packagejson.version;

  var cmdUrl = self.url + '/versions/' + name;
  request({
    uri: cmdUrl,
    json: true
  }, function(err, response, body) {

    if(body && body.live == version) {
      callback(true, body)
    } else {
      callback(false, body);  
    }

  })

}

/**
 * Download and extract a package
 */ 
Command.prototype.fetch = function() {
  
  var self = this;
  if(!this.params[0]) return console.error('You need to provide a package name')
  if(!this.params[1]) self.params[1] = 'latest';

  var name = this.params[0],
      version = this.params[1],
      cmdUrl = self.url + '/package/' + name + '/' + version,
      dir = process.cwd(),      
      packageDir = process.cwd() + '/' + name,
      tempPackageFile = path.join(dir, name + "-" + version + ".tgz");

  rimraf(packageDir, function() {

    request({uri: cmdUrl})
      .on('end', function () { 
        
          fs.createReadStream(tempPackageFile)
            .pipe(zlib.createGunzip())
            .on('error', function (err) {
              console.error("Data.loadPackage: Error unzipping package " + pathToPackage)      
            })
            .pipe(tar.Extract({ path: dir }))
            .on('error', function (err) {
              console.error("Data.loadPackage: Error untarring package " + pathToPackage)      
            })
            .on('end', function () {
                fs.unlink(tempPackageFile);
                fs.rename(path.join(dir,'package'), path.join(dir,name), function(err) {
                  console.log('DONE');
                });               
            });

      })
      .on('error', function (err) {
        console.error("Unexpected error when downloading package: " + (err.message || err));      
      })
      .pipe(fs.createWriteStream(tempPackageFile));

  });


}

Command.prototype._nameVersion = function() {

  var name = this.params[0],
      version = this.params[1],
      packagejson;

  if(fs.existsSync('package.json')) {
     packagejson = JSON.parse(fs.readFileSync('package.json'));
  }    

  if(!name && packagejson) this.params[0] = packagejson.name;    
  if(!version && packagejson) this.params[1] = packagejson.version;    
  
}

Command.prototype.help = function() {
	return this.help.join('\n');
}


