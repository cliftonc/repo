var path = require('path')
  , fs = require('fs')
  , path = require('path')
  , tar = require('tar')
  , zlib = require('zlib')
  , crypto = require('crypto')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , semver = require('semver')
  , _ = require('lodash')
  , async = require('async')
  , lunr = require('lunr')
  , Mustache = require('mustache')
  , readJson = require('read-package-json');

readJson.log.level = 'error';
module.exports = Data;

function Data (opts) {
  opts = opts || {};

  // directories
  this._rootDir = opts.dataDirectory || path.join(process.cwd(), 'data');
  this._packagesDir = path.join(this._rootDir, 'packages');  
  this._srcDir = path.join(this._rootDir,'src');
  this._liveDir = path.join(this._rootDir,'live');
  this._tempDir = path.join(this._rootDir, 'temp');
  this._idx = lunr(function () {
    this.field('name', { boost: 10 })
    this.field('description')
    this.field('readme')
    this.ref('name');
  })
  this._url = opts.url || '';
  this._sortOrder = opts.sortOrder;
  this._notify = opts.notify;
  this._packageMap = {}
  this._log = opts.log;
};

Data.prototype.init = function (callback) {
  var self = this;
  async.series([
    function (cb) { mkdirp(self._packagesDir, cb) },
    function (cb) { mkdirp(self._srcDir, cb) },
    function (cb) { mkdirp(self._liveDir, cb) },
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

    self._log.info('Loading package from json: ' + pJsonPath);

    self._loadPackageJson(pJsonPath, null, null, function(err, pjsonData, expectedPackagePath) {

      // TODO: do this after writes confirmed
      self._registerPackage(pjsonData, expectedPackagePath);          
      callback(err);

    });

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

        self._log.info('Loading package from json: ' + pJsonPath);

        self._loadPackageJson(pJsonPath, expectedName, expectedVersion, function(err, pjsonData, expectedPackagePath) {

          if(err) return callback && callback.call(undefined, err);

          // Move the src into the source folder and delete - ok out of band
          self._makeSrcDir(pjsonData.name, pjsonData.version, function(err, srcDir) {    

              fs.unlink(pathToPackage) // delete the tgz
              
              self._mv(dir + '/package', srcDir, function(err) {
                // Now we can register it
                self._registerPackage(pjsonData, expectedPackagePath); 
              });

              // Clean up
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
        console.error("Data.loadPackage: Error loading package.json " + pJsonPath + " " + err.message);
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

Data.prototype.openAssetStream = function (name, version, assetPath, callback) {
  this._findPackage(name, version, function (error, pkg) {
    if (error) {
      callback.call(undefined, error);
    }
    else {
      callback.call(undefined, null, fs.createReadStream(path.join(pkg.pathToPackageSrc, assetPath)));
    }
  });
}

// TODO make api async
Data.prototype.whichVersions = function (name) {
  var pkg = this._packageMap[name];
  var versions = pkg.versions || {};
  var pkgVersions = (pkg) ? Object.keys(versions) : [];
  return {
    versions: pkgVersions,
    latest: pkg.latest,
    live: pkg.live
  }
}

// TODO make api async
Data.prototype.packageMeta = function (name) {

  var self = this;
  var pkg = _.clone(this._packageMap[name]);

  var versions = self.whichVersions(name).versions.sort().reverse();
    
  pkg.versionList = versions; 

  return pkg;

}

// TODO make api async
Data.prototype.setLiveVersion = function (name, version, callback) {

  var self = this;
      pkg = self._packageMap[name],
      livePointer = path.join(self._liveDir, name);

  if(pkg.versions[version] || version == 'OFF' || version == 'N') {
    pkg.live = version;
    fs.writeFileSync(livePointer, version);
  } else {

    return callback(new Error('Couldnt find version ' + version + ' for that package;'));
  }
  
  return callback();

}

Data.prototype._sequencer = function(pkg) {

  var self = this;  
  var sortOrder = self._sortOrder;         
  var pkgType = pkg.type ? pkg.type : 'other';
  var order = parseFloat((sortOrder[pkgType] || sortOrder.other) + '.' + (pkg.sequence || 0));
  return order;

};

// TODO make api async
Data.prototype.getJS = function (liveOrLatest) {
  
  var self = this;
  var jsFiles = [];

  _.sortBy(self._packageMap, function(pkg) { return self._sequencer(pkg) }).map(function(pkg) {            

      var latest = pkg.versions[pkg[liveOrLatest]];    

      // Means that the package is disabled
      if(!latest) return;

      // Always get the latest            
      _.map(latest.data.js, function(js) {
        jsFiles.push(path.join(latest.pathToPackageSrc, js));
      });
    
  })

  return jsFiles;

}

Data.prototype.getCSS = function (liveOrLatest) {
  
  var self = this;
  var cssFiles = [];

  _.sortBy(self._packageMap,  function(pkg) { return self._sequencer(pkg) }).map(function(pkg) {            
      
      var latest = pkg.versions[pkg[liveOrLatest]];

      // Means that the package is disabled
      if(!latest) return;

      // Always get the latest            
      _.map(latest.data.css, function(css) {
        cssFiles.push(path.join(latest.pathToPackageSrc, css));
      });
    
  })

  return cssFiles;

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

Data.prototype.indexBySearch = function (search, callback) {

  var self = this;
  var pkgNames = [];
  
  var results = self._idx.search(search);
  _.map(results, function(result) {
    pkgNames.push(result.ref);
  });

  return  self._indexList(pkgNames);

}

Data.prototype._indexList = function (pkgNames) {

  var self = this;
  var list = [];

 pkgNames.forEach(function (name) {
    
    var pkgVersions = Object.keys(self._packageMap[name].versions);
    var latest = self._packageMap[name].latest;
    var live = self._packageMap[name].live;
    var pkg = self._packageMap[name].versions[latest];    

    list.push({
      name: pkg.data.name,
      description: pkg.data.description,
      type: pkg.data.type || '',
      author: pkg.data.author,
      image: (pkg.data.images ? pkg.data.images[0] : ''),
      css: (pkg.data.css ? 'Y' : 'N'),
      js: (pkg.data.js ? 'Y' : 'N'),
      html: (pkg.data.html ? 'Y' : 'N'),
      latest: latest,
      live: live
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
  pkg.sequence = pjsonData.sequence || 0;  
  pkg.versions = pkg.versions || {};
  pkg.latest = pkg.latest || '0.0.0';

  // Use semver to ensure we always know the latest version easily
  if(semver.gt(version, pkg.latest)) pkg.latest = version;

  // We also require pointers that let us manage which version is live
  var livePointer = path.join(self._liveDir, name), 
      liveVersion;

  try {
    liveVersion = fs.readFileSync(livePointer).toString();
  } catch (E) {
    fs.writeFileSync(livePointer, 'N'); // Default is that a package is off in live
    liveVersion = pkg.latest;
  }

  pkg.live = liveVersion;

  var pathToPackageSrc = path.join(self._srcDir, name, version);

  pkg.versions[version] = {
    data: pjsonData,
    pathToPackage: pathToPackage,
    pathToPackageSrc: pathToPackageSrc,
    templates: pjsonData.html ? self._compilePackageTemplates(pjsonData.html, pjsonData.partials, pathToPackageSrc) : {},
    templateData: pjsonData.data
  };

  // Index in lunr
  self._idx.add(pkg);

  self._log.info('Package registered: ' + name + ' @ ' + version);

  self._notify({name: name, version: version});
  
}

Data.prototype._compilePackageTemplates = function(templates, partials, pathToPackageSrc) {

  var compiled = {};
  compiled._partials = {};

  _.map(partials, function(partial) {
    try {
      var templateString = fs.readFileSync(path.join(pathToPackageSrc, partial)).toString();      
      compiled._partials[path.basename(partial,'.html')] = templateString;  
    } catch(E) {
      compiled._partials[path.basename(partial,'.html')] = E.message;
    }    
  });

  _.map(templates, function(template) {
    try {
      var templateString = fs.readFileSync(path.join(pathToPackageSrc, template)).toString();      
      compiled[path.basename(template,'.html')] = Mustache.compile(templateString);  
    } catch(E) {
      compiled[path.basename(template,'.html')] = E.message;
    }    
  })

  return compiled;

}

Data.prototype.renderPackage = function(name, version, templateName, callback) {  

  var self = this;
  self._findPackage(name, version, function(err, pkg) {

    if(err) return callback(err);

    var templateDataFile = path.join(pkg.pathToPackageSrc, pkg.templateData);

    pkg.templateData ? templateData = JSON.parse(fs.readFileSync(templateDataFile)) : templateData = {};

    var template = pkg.templates[templateName],
        partials = pkg.templates["_partials"];

    // Always add urls etc. as per the front end
    templateData._server = {
      url: self._url,      
      name: name,
      version: version,
      srcPath: path.join('/src', name, version),
      templateFile: pkg.templates[templateName]
    }


    if((typeof template == "function") && templateData) {
      callback(null, template(templateData, partials));
    } else {
      callback(new Error("Template " + templateName + " not found or no valid data. " + (typeof template != "function" ? "Template error: " + template : "")));
    }

  })


}

Data.prototype._findPackage = function (name, version, callback) {
  var pkg = this._packageMap[name];
  if (!pkg) return callback.call(undefined, new Error(name + " package not found"));
  var versions = pkg.versions || {};
  var pkgVersion = versions[version];
  if (!pkgVersion) return callback.call(undefined, new Error(name + "@" + version + " package version not found"));
  var pathToPackage = pkgVersion.pathToPackage;
  if (!pathToPackage) return callback.call(undefined, new Error(name + "@" + version + " package missing"));
  return callback.call(undefined, null, pkgVersion);
}

Data.prototype._findLatest = function (name) {
  
  var self = this;
  var pkg = this._packageMap[name];
  if (!pkg) return '-1';  
  var versions = self.whichVersions(name).versions.sort().reverse();
  var version = versions[0];    
  return version;
  
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

  // Always destroy first - seems a bit dangerous
  // Probably better to do some sort of update and rename for 
  // src dirs that already exist
  self._destroyDir(dir, function(err) {
    mkdirp(dir, function (err) { 
      callback (err, dir);
    });
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
