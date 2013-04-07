/**
 * Combines and minifies JS and CSS
 */

var fs = require("fs"), 
	path = require("path"),
	ugly = require("uglify-js"),
	sass = require("node-sass"),
	cleanCSS = require("clean-css"),
	_ = require("lodash")

module.exports = Combinator;

function Combinator(data, opts) {
	var self = this;
	self.opts = opts;
	self.data = data;
	self.cache = {};
}

Combinator.prototype.compressJs = function(cacheKey, liveOrLatest, callback) {
	
	var self = this;

	var liveCacheKey = cacheKey + liveOrLatest;

	if(cacheKey && self.cache[liveCacheKey] && liveOrLatest == 'live') return callback(null, self.cache[liveCacheKey]);

	var js = self.data.getJS(liveOrLatest);

	var compressed = ugly.minify(js, {
		outSourceMap: cacheKey + ".map",
    	sourceRoot: self.opts.url + '/src'
	});

	// Concatenate the source map to the JS
	compressed.code += "\r\n//@ sourceMappingURL=" + self.opts.url + "/jsmap/" + cacheKey + (liveOrLatest == 'latest' ? '?latest=true' : '')

	// Fix the source map base URLs
	var jsonMap = JSON.parse(compressed.map);
	jsonMap.sources = _.map(jsonMap.sources, function(source) { return source.replace(self.data._srcDir + '/', '') })
	compressed.map = JSON.stringify(jsonMap);

	if(cacheKey) self.cache[liveCacheKey]  = compressed;

	return callback(null, compressed);

}

Combinator.prototype.compressCss = function(cacheKey, liveOrLatest, callback) {
		
	var self = this;
	
	cacheKey = cacheKey + liveOrLatest;

	if(cacheKey && self.cache[cacheKey] && liveOrLatest == 'live') return callback(null, self.cache[cacheKey]);

	var css = self.data.getCSS(liveOrLatest),
		compressedScss = "",
		compressedCss = "";

	_.map(css, function(cssFile) {
		if(path.extname(cssFile) === '.css') compressedCss += fs.readFileSync(cssFile) + "\r\n";
		if(path.extname(cssFile) === '.scss') compressedScss += fs.readFileSync(cssFile) + "\r\n";
	});

	// Now sassify it.
	sass.render(compressedScss, function(err, compressed) {

		if(err) return callback(err);

		// Add the normal css to the arse end of it
		compressed += "\r\n" + compressedCss;

		// Now clean it
		compressed = cleanCSS.process(compressed);

		if(cacheKey) self.cache[cacheKey]  = compressed;

		return callback(null, compressed);;

	});

}
