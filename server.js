#!/usr/bin/env node

var nconf = require('nconf')
  , restify = require('restify')
  , fs = require('fs')
  , tar = require('tar')
  , zlib = require('zlib')
  , path = require('path')
  , rimraf = require('rimraf')
  , mkdirp = require('mkdirp')
  , semver = require('semver')
  , Mustache = require('mustache')
  , optimist = require('optimist')
  , _ = require('lodash')
  , winston = require('winston')
  , socketio = require('socket.io');

// Configure nconf
nconf.argv()
     .file({ file: './conf/' + (process.env.NODE_ENV || 'development') + '.json' });

// Configure winston
var log = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ colorize: 'true', level: nconf.get('loglevel')}),
    new (winston.transports.File)({ filename: './logs/server.log', level: nconf.get('loglevel')})
  ]
});

// ----------------------------------------------------------------------------
// options parsing
// ----------------------------------------------------------------------------

var url = "http://" + nconf.get('host') + ":" + nconf.get('port'),
    externalUrl = "http://" + nconf.get('externalUrl'),
    argv = optimist
    .usage('Number 5 is alive!\nUsage: $0')    
    .default({ d : path.join(process.cwd(), 'data'), p : nconf.port, s: nconf.host })
    .alias('d', 'data')
    .alias('p', 'port')
    .alias('h', 'help')    
    .alias('s', 'servername')
    .describe('d', 'Directory to store template data')
    .describe('p', 'What port should I listen on?')
    .describe('s', 'What is my server name?')
    .argv;

if (argv.h) {
  optimist.showHelp();
  process.exit(0);
}


// ----------------------------------------------------------------------------
// server wireup
// ----------------------------------------------------------------------------

var server = restify.createServer();
server.use(restify.queryParser());


// ----------------------------------------------------------------------------
// simple web sockets
// ----------------------------------------------------------------------------

var io = socketio.listen(server), sockets = [];
io.set('log level', 1);
io.sockets.on('connection', function (socket) {
  sockets.push(socket);
});

var notifyPackage = function(data) {
  _.map(sockets, function(socket) {
      socket.emit('package', data);
  });
}

// ----------------------------------------------------------------------------
// data initialization
// ----------------------------------------------------------------------------

var Data = require('./lib/data');
var Combinator = require('./lib/combinator');

var data = new Data({ dataDirectory: argv.data, url: externalUrl, notify: notifyPackage, sortOrder: nconf.get('sortOrder'), log: log}), combinator;

data.init(function (err) {
  data.reloadPackages(function (err) {
    if (err) throw err;
    afterInitialised();
  });
});

function afterInitialised() {  
  
  // Setup the combinator
  combinator = new Combinator(data, {url: externalUrl, log: log}); 

  // Start the server
  server.listen(nconf.get('port'), nconf.get('host'), function() {  
    console.log('\r\n' + require('./lib/logo').join('\r\n') + '\r\n');  
    console.log('Repo listening at ' + url.green + ' [' + externalUrl.blue + ']');
  });

}

server.get(/\/ui\/?.*/, restify.serveStatic({
  directory: '.'
}));

server.get('/', function (req, res, next) {
  res.statusCode = 301;
  res.header('Location', '/ui/index.html');
  res.end();  
});

server.put('/api/package/:name/:version', function (req, res, next) {

  var name = req.params.name;
  var version = req.params.version;
  var rand = Math.floor(Math.random()*4294967296).toString(36);
  var tempPackageFile = path.join(argv.data, "temp", rand + name + "-" + version + ".tgz");

  log.debug('Start upload for package ' + name + ' @ ' + version);

  // write the tar file. Don't combine the streamed gzip and untar on upload just yet...
  req
    .on('end', function () { 
      data.addPackage(tempPackageFile, name, version, function (err) {
        if (err) {
          log.error("Error adding package from upload: " + (err.message || err));
          fs.unlink(tempPackageFile);
          return next(err);
        }
        fs.unlink(tempPackageFile);
        log.debug('Completed upload for package ' + name + ' @ ' + version);
        res.send(200);
      });
    })
    .on('error', function (err) {
      log.error("Unexpected error when accepting package upload: " + (err.message || err));
      fs.unlink(tempPackageFile);
      res.send(err, 500);
    })
    .pipe(fs.createWriteStream(tempPackageFile));
    
});

server.del('/api/package/:name/:version', function (req, res, next) {
  var name = req.params.name;
  var version = req.params.version;
  log.debug('DELETED package ' + name + ' @ ' + version);
  data.deletePackage(name, version, function (err) {
    if (err) {
      log.error("Error deleting package " + name + "@" + version + ": " + (err.message || err));
      return next(err);
    }
    res.send(200);
  });
});

server.post('/api/package/:name/live/:version', function (req, res, next) {
  var name = req.params.name;
  var version = req.params.version;
  log.debug('Updating live version for package ' + name + ' TO ' + version);
  data.setLiveVersion(name, version, function (err) {
    if (err) {
      log.error("Error updating live versios for package " + name + "@" + version + ": " + (err.message || err));
      return next(err);
    }
    res.send(200);
  });
});

server.get('/api/versions/:name', function (req, res) {
  var name = req.params.name;
  log.debug('Requested version list for ' + name);
  res.send(data.whichVersions(name));
});


server.get('/api/index', function (req, res) {
  log.debug('Index for all packages'); 
  res.send(data.index());
});

server.get('/api/index/type/:type', function (req, res) { 
  log.debug('Index by type for ' + req.params.type); 
  res.send(data.indexByType(req.params.type));
});

server.get('/api/index/search/:search', function (req, res) {  
  log.debug('Index search for ' + req.params.search);
  res.send(data.indexBySearch(req.params.search));
});

server.get('/api/info/:name', function (req, res) {
  var name = req.params.name;  
  var meta = data.packageMeta(name);
  log.debug('Requested info for ' + name);
  if (!meta) return res.send(404);
  else return res.send(meta);
});

server.get('/api/package/:name/:version', function (req, res) {

  var name = req.params.name;
  var version = (req.params.version == 'latest' ? data._findLatest(name) : req.params.version);
  log.debug('Downloaded package ' + name + ' @ ' + version );
  returnPackage(name, version, res);
  
});

server.get('/js/:key', function (req, res) {

  var key = req.params.key, 
      latest = req.params.latest;

  log.debug('JS ' + key + ' & ' + (latest ? 'latest' : 'live'));

  res.contentType = 'application/javascript'; // Lookup  
  combinator.compressJs(key, latest ? 'latest' : 'live', res, function(err, js) {
    if(err) return res.send(err);
    res.end(js.code);  
  });

});

server.get('/css/:key', function (req, res) {
  
  var key = req.params.key, 
      latest = req.params.latest;

  log.debug('CSS ' + key + ' & ' + (latest ? 'latest' : 'live'));

  res.contentType = 'application/css'; // Lookup  
  combinator.compressCss(key, latest ? 'latest' : 'live', res, function(err, css) {
    if(err) return res.send(err);
    res.end(css);
  }); 
  
});

server.get('/jsmap/:key', function (req, res) {
  var key = req.params.key,
      latest = req.params.latest;

  log.debug('JS Source Map ' + key + ' & ' + (latest ? 'latest' : live));

  res.contentType = 'application/javascript'; // Lookup
  combinator.compressJs(key, latest ? 'latest' : 'live', function(err, js) {
    if(err) return res.send(err);
    res.end(js.map);  
  });

});

server.get(/^\/(src)\/([a-zA-Z0-9_\.~-]+)\/([0-9_\.~-]+)\/(.*)/, function (req, res) {

  var name = req.params[1];
  var version = req.params[2];
  var asset = req.params[3];

  log.debug('Request for asset ' + name + ' @ ' + version + ': '  + asset);

  returnPackageAsset(name, version, asset, res);
  
});

server.get('/preview/:name', function(req, res) {

  var name = req.params.name;
  var version = data._findLatest(name);
  var template = req.params.name;

  log.debug('Showing ' + name + ' @ ' + version + ' using '  + template + ' template');
  
  var top = Mustache.compile(fs.readFileSync('./templates/top.html').toString())({url: externalUrl, name: name, version: version}),
      bottom = Mustache.compile(fs.readFileSync('./templates/bottom.html').toString())({url: externalUrl, name: name, version: version});

  data.renderPackage(name, version, template, function(err, html) {
    if(err) return res.end(err.message);
    res.end(top + html + bottom)    
  })

})

server.get('/preview/:name/:version/:template', function(req, res) {

  var name = req.params.name;
  var version = req.params.version;
  var template = req.params.template;

  log.debug('Showing ' + name + ' @ ' + version + ' using '  + template + ' template');
  
  var top = Mustache.compile(fs.readFileSync('./html/top.html').toString())({url: externalUrl, name: name, version: version}),
    bottom = Mustache.compile(fs.readFileSync('./html/bottom.html').toString())({url: externalUrl, name: name, version: version});

  data.renderPackage(name, version, template, function(err, html) {
    if(err) return res.end(err.message);
    res.end(top + html + bottom)
  });

})


function returnPackageAsset (name, version, asset, res) {
  
  var filename = path.basename(asset);

  res.contentType = 'application/x-compressed'; // Lookup
  res.header( "Content-Disposition", "filename=" + filename );

  data.openAssetStream(name, version, asset, function (err, stream) {
    if (err) {
      console.error("Error streaming asset: " + (err.message || err));
      res.send(err, 500);
    }
    stream
      .pipe(res)
      .on('error', function (err) {
        console.dir(err);
        res.send(err, 500);
      });
  })

}



function returnPackage (name, version, res) {
  
  var filename = name + '-' + version + '.tgz';

  res.contentType = 'application/x-compressed'; // Lookup
  res.header( "Content-Disposition", "filename=" + filename );

  data.openPackageStream(name, version, function (err, stream) {
    if (err) {
      console.error("Error streaming package: " + (err.message || err));
      res.send(err, 500);
    }
    stream
      .pipe(res)
      .on('error', function (err) {
        console.dir(err);
        res.send(err, 500);
      });
  })

}
