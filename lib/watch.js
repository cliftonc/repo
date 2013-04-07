
var optimist = require('optimist')
  , fs = require('fs')
  , path = require('path')
  , util = require('util');

module.exports = function(callback) {

	var nodeVersion = process.version.split("."),
    	isWindowsWithoutWatchFile = process.platform === 'win32' && parseInt(nodeVersion[1]) <= 6,
    	fileExtensionPattern =  new RegExp("^.*\.(js|css|sass|scss|html|json)$"),
    	watchItems = ["."];

	watchItems.forEach(function (watchItem) {
    watchItem = path.resolve(watchItem);
    util.debug("Watching directory '" + watchItem + "' for changes.");
    findAllWatchFiles(watchItem, function(f) {
	      watchGivenFile( f );
    });
  });

	/**
	 * Liberally borrowed from node supervisor
	 */
	function watchGivenFile (watch) {
	  fs.watchFile(watch, { persistent: true, interval: 100 }, callback);
	}

	function findAllWatchFiles (dir, cb) {
	  dir = path.resolve(dir);  
	  fs.stat(dir, function(err, stats){
	    if (err) {
	      util.error('Error retrieving stats for file: ' + dir);
	    } else {
	      if (stats.isDirectory()) {
	        if (isWindowsWithoutWatchFile) cb(dir);
	        fs.readdir(dir, function(err, fileNames) {
	          if(err) {
	            util.error('Error reading path: ' + dir);
	          }
	          else {
	            fileNames.forEach(function (fileName) {
	              findAllWatchFiles(path.join(dir, fileName), cb);
	            });
	          }
	        });
	      } else {
	        if (!isWindowsWithoutWatchFile && dir.match(fileExtensionPattern)) {
	          cb(dir);
	        }
	      }
	    }
	  });
	};

}