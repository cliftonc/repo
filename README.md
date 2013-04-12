This is a prototype of a centralised Style repository.

The idea is that we can use this to store all of the various front end components (html, css, js)
that can be rendered on the front end of the site.  Each type will have an associated editor, where
that editor allows you to create an instance of an object of this style (e.g. the underlying content)
but the style itself is managed separately.

Because components are only getting more complex, it seems sensible to give them a lifecycle of there
own, and build a process and toolset around them.

Key aims:
=========

Central repository that enables me to effectively manage the lifecycle of components:

*[x] Create a component as a folder containing: a package descriptor, html, css, javascript, static sample data and any other assets.*

See the [examples] folder.

[x] Package this component and publish it to a repository via a single command.

Via CLI:  repo publish

[x] Preview the component as it would appear.

Via Web:  View [preview] here.

[x] Have the preview automatically update as changes are published to it.

First of all, via the CLI, set the publish to auto:  repo publish -af
Then, browse to the [preview] in another window.
Make changes to any of the assets in the folder, the preview will update as soon as you save.

[x] Fetch an existing version of a component for modification.

Via CLI: repo fetch image_swap_carousel

[x] Track changes to a component, and allow specifying a single version to be 'live' at any one time.

Via Web: View the full [info] for any component.
Via CLI: repo info image_swap_carousel

[x] Retrieve an index of components by type (for the authoring nodes to use).

> Via Web: View the index by [type].

> Via CLI: repo index gallery

[x] Retrieve an index of all components (for the publishing nodes to use).

> Via Web: See the [index] example, or via CLI type: repo index

[x] Search the repository.

> Via Web: View the index by [search].

> Via CLI: repo search showbiz

[x] View full history of a component.

> Via CLI: repo versions image_swap_carousel

[x] Preview any previous version of a component.

> Via Web: View the index by [version].

[ ] Some way of namespacing.

Enables me to distribute packages of CSS effectively to the front end:


 - [x] Request a concatenated and cleaned CSS file that contains all of CSS from all of the live packages.
 - [x] Request a concatenated and cleaned CSS file that contains all of CSS from all of the latest packages.
 - [x] Cache the above requests for performance reasons.
 - [ ] Request CSS for a custom set of packages.

Enables me to distribute packages of JS effectively to the front end:

 - [x] Request a minified & jshinted JS file that contains all of JS from all of the live packages.
 - [x] Request a minified & jshinted JS file that contains all of JS from all of the live packages.
 - [x] Attach a source map for the minified JS file and provide that source map to allow debugging of the JS.
 - [x] Cache the above requests for performance reasons.
 - [ ] Request JS and sourcemap for a custom set of packages.

This will give us a workflow for a change to an existing component as simple as:

'''
	repo fetch image_swap_carousel
	cd image_swap_carousel	
	
	// edit package.json > bump version number to 0.0.7 and save
	
	repo publish -af // enable auto publish

	// Open browser: http://rpo.jit.su/preview/image_swap_carousel
	// edit HTML / CSS / JS > changes are reflected live in browser

	// Share link with designer / editorial to sign off.
	// When finished and signed off.

	repo live image_swap_carousel 0.0.7

	// Your new carousel is live on the site


[examples]: https://github.com/cliftonc/repo/tree/master/examples "Examples"
[index]: http://rpo.jit.su/api/index  "Index API"
[type]: http://rpo.jit.su/api/index/type/gallery  "Type"
[search]: http://rpo.jit.su/api/index/search/colour  "Search"
[info]: http://rpo.jit.su/api/info/image_swap_carousel  "Info"
[preview]: http://rpo.jit.su/preview/image_swap_carousel  "Preview"
[version]: http://rpo.jit.su/preview/image_swap_carousel/0.0.5  "Preview Older Version"
