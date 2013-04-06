var path = require('path')
  , fs = require('fs')
  , path = require('path')
  , tar = require('tar')
  , zlib = require('zlib')
  , crypto = require('crypto')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , _ = require('lodash')
  , async = require('async')
  , readJson = require('read-package-json');

module.exports = Data;


function Data (opts) {
  opts = opts || {};

  // directories
  this._rootDir = opts.dataDirectory || path.join(process.cwd(), 'data');
  this._packagesDir = path.join(this._rootDir, 'packages');  
  this._srcDir = path.join(this._rootDir,'src');
  this._tempDir = path.join(this._rootDir, 'temp');

  this._packageMap = {}
};

Data.prototype.init = function (callback) {
  var self = this;
  async.series([
    function (cb) { mkdirp(self._packagesDir, cb) },
    function (cb) { mkdirp(self._srcDir, cb) },
    function (cb) { mkdirp(self._tempDir, cb) },
  ], callback);
}

//
// Load all package from the _packagesDir
//
Data.prototype.reloadPackages = function (callback) {
  var self = this;
  var concurrency = 25;

  var q = async.queue(function (file, cb) {
    self.loadPackage (file, cb);
  }, concurrency);

  fs.readdir(this._packagesDir, function (err, files) {
    files = (!files) ? [] : files.map(function(file) { return path.join(self._packagesDir, file) });
    if (files.length > 0)
      q.push(files);
    else
      callback.call();
  });

  if (callback) { q.drain = callback }
}

// Load the package data based on the extracted information in the src folder
Data.prototype.loadPackage = function (pathToPackage, callback) {

    var self = this;

    var packageNameAndVersion = path.basename(pathToPackage, '.tgz'),
        packageName = packageNameAndVersion.split('-')[0],
        packageVersion = packageNameAndVersion.split('-')[1],
        pJsonPath = path.join(self._srcDir, packageName, packageVersion, 'package.json');

    self._loadPackageJson(pJsonPath, null, null, callback);

}

//
// Load a package from a path - expand into src folder
//
Data.prototype.addPackage = function (pathToPackage, expectedName, expectedVersion, callback) {

  var self = this;

  if (typeof expectedName === 'function') {
    callback = expectedName;
    expectedName = expectedVersion = undefined;
  }

  // make a temp directory to extract each package
  self._makeTempDir(function (err, dir) {

    if (err) {
      console.error("Data.loadPackage: Failed to make directory " + dir);
      throw err;
    }

    // unzip and extract
    fs.createReadStream(pathToPackage)
      .pipe(zlib.createGunzip())
      .on('error', function (err) {
        console.error("Data.loadPackage: Error unzipping package " + pathToPackage)
        return callback && callback.call(undefined, err);
      })
      .pipe(tar.Extract({ path: dir }))
      .on('error', function (err) {
        console.error("Data.loadPackage: Error untarring package " + pathToPackage)
        return callback && callback.call(undefined, err);
      })
      .on('end', function () { 

        var pJsonPath = path.join(dir, 'package/package.json');

        self._loadPackageJson(pJsonPath, expectedName, expectedVersion, function(err, pjsonData, expectedPackagePath) {

          if(err) return callback && callback.call(undefined, err);

          // Move the src into the source folder and delete - ok out of band
          self._makeSrcDir(pjsonData.name, pjsonData.version, function(err, srcDir) {
              fs.unlink(pathToPackage) // delete the tgz
              self._mv(dir + '/package', srcDir);
              self._destroyDir(dir);
          });

          // is package under our _packagesDir?
          if (path.dirname(pathToPackage) === self._packagesDir) {
            // is it named as expected?
            if (expectedPackagePath === pathToPackage) {
              return callback && callback.call();
            }
            else {
              // move it
              return self._mv(pathToPackage, expectedPackagePath, callback);
            }
          }
          else {
            // copy it
            return self._cp(pathToPackage, expectedPackagePath, callback);
          }
        });
      })
  });
}

Data.prototype._loadPackageJson = function(pJsonPath, expectedName, expectedVersion, callback) {

    var self = this;

    readJson(pJsonPath, function (err, pjsonData) {

      if (err) {
        console.error("Data.loadPackage: Error loading package.json " + pJsonPath + ' for ' + dir);
        return callback && callback.call(undefined, err);
      }

      // TODO do something with the package.json data
      var name = pjsonData.name;
      var version = pjsonData.version;
      var expectedPackagePath = path.join(self._packagesDir, name + '-' + version + '.tgz');

      // check that the packaged we received is what we expect
      if (expectedName && expectedVersion && (expectedName !== name || expectedVersion !== version)) {
        return callback(new Error("Package rejected, expected " + expectedName + "@" + expectedVersion 
                                  + ", received " + name + "@" + version));
      }

      // TODO: do this after writes confirmed
      self._registerPackage(pjsonData, expectedPackagePath);          

      // We're now good to call back
      callback(null, pjsonData, expectedPackagePath);

    });

}

Data.prototype.deletePackage = function (name, version, callback) {
  var self = this;

  this._findPackage(name, version, function (error, pkg) {

    if (error) {
      return callback.call(undefined, error);
    }

    // delete the package
    fs.unlink(pkg.pathToPackage, function (error) {

      if (error) {
        return callback.call(undefined, error);
      }

      self._destroyDir(pkg.pathToPackageSrc, function(error) {

        if (error) {
          return callback.call(undefined, error);
        }

        var pkg = self._packageMap[name];
        var versions = pkg.versions || {};
        delete versions[version];

        // If we just deleted the last version, delete the package
        if(_.keys(self._packageMap[name].versions).length == 0) {            
            delete self._packageMap[name];
            self._destroyDir(path.join(self._srcDir, name), function(error) {});
        }

        callback.call(undefined, null);

      });
    })
  });
}

Data.prototype.openPackageStream = function (name, version, callback) {
  this._findPackage(name, version, function (error, pkg) {
    if (error) {
      callback.call(undefined, error);
    }
    else {
      callback.call(undefined, null, fs.createReadStream(pkg.pathToPackage));
    }
  });
}

// TODO make api async
Data.prototype.whichVersions = function (name) {
  var pkg = this._packageMap[name];
  var versions = pkg.versions || {};
  return (pkg) ? Object.keys(versions) : [];
}

// TODO make api async
Data.prototype.packageMeta = function (name) {

  var self = this;
  var pkg = _.clone(this._packageMap[name]);

  var versions = self.whichVersions(name).sort().reverse();
  var version = versions[0];
  
  pkg.version = version;  
  pkg.versionList = versions; 

  return pkg;

}

// TODO make api async
Data.prototype.index = function () {
  
  var self = this;
  var pkgNames = Object.keys(self._packageMap);

  return  self._indexList(pkgNames);

}

Data.prototype.indexByType = function (type, callback) {

  var self = this;
  var pkgNames = [];
  
  _.filter(self._packageMap, { 'type': type }).map(function(pkg) {
    pkgNames.push(pkg.name);
  })

  return  self._indexList(pkgNames);

}


Data.prototype._indexList = function (pkgNames) {

  var self = this;
  var list = [];

 pkgNames.forEach(function (name) {
    
    var versions = self.whichVersions(name).sort().reverse();
    var version = versions[0];
    var pkgVersions = Object.keys(self._packageMap[name].versions);
    var pkg = self._packageMap[name].versions[version];

    list.push({
      name: pkg.data.name,
      description: pkg.data.description,
      type: pkg.data.type || '',
      author: pkg.data.author,
      version: version,
      versions: versions
    });

  });

 return list;

}

Data.prototype._registerPackage = function (pjsonData, pathToPackage) {
  var self = this;
  var name = pjsonData.name;
  var version = pjsonData.version;
  var pkg = self._packageMap[name] = self._packageMap[name] || {};

  pkg.name = pjsonData.name;
  pkg.description = pjsonData.description;
  pkg.author = pjsonData.author;
  pkg.repository = pjsonData.repository;
  pkg.dependencies = pjsonData.dependencies;
  pkg.readme = pjsonData.readme;  
  pkg.type = pjsonData.type;
  pkg.versions = pkg.versions || {};  

  pkg.versions[version] = {
    data: pjsonData,
    pathToPackage: pathToPackage,
    pathToPackageSrc: path.join(self._srcDir, name, version)
  };
  
}

Data.prototype._findPackage = function (name, version, callback) {
  var pkg = this._packageMap[name];
  if (!pkg) return callback.call(undefined, new Error(name + " package not found"));
  var versions = pkg.versions || {};
  var pkgVersion = versions[version];
  if (!pkgVersion) return callback.call(undefined, new Error(name + "@" + version + " package not found"));
  var pathToPackage = pkgVersion.pathToPackage;
  if (!pathToPackage) return callback.call(undefined, new Error(name + "@" + version + " package missing"));
  return callback.call(undefined, null, pkgVersion);
}

Data.prototype._makeTempDir = function (callback) {
  var size = 16;
  var self = this;
  crypto.randomBytes(size, function(ex, buf) {
    var dir = path.join(self._tempDir, buf.toString('hex'));
    mkdirp(dir, function (err) { 
      callback (err, dir);
    });
  });
}

Data.prototype._makeSrcDir = function (packageName, packageVersion, callback) {
  var self = this;
  var dir = path.join(self._srcDir, packageName, packageVersion);
  mkdirp(dir, function (err) { 
      callback (err, dir);
  });
}

Data.prototype._destroyDir = function (dir, callback) {
  callback = callback || function (){}; 
  rimraf(dir, callback);
}

Data.prototype._cp = function (from, to, callback) {
  fs.createReadStream(from)
    .on('end', function () {
      return callback && callback.call();
    })
    .pipe(fs.createWriteStream(to))
    .on('error', callback);
}

Data.prototype._mv = function (from, to, callback) {
  fs.rename(from, to, callback);
}
