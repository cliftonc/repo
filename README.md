This is a prototype of a centralised Style repository.

The idea is that we can use this to store all of the various front end components (html, css, js)
that can be rendered on the front end of the site.  Each type will have an associated editor, where
that editor allows you to create an instance of an object of this style (e.g. the underlying content)
but the style itself is managed separately.

Because components are only getting more complex, it seems sensible to give them a lifecycle of there
own, and build a process and toolset around them.

Key aims:



- Central repository that enables me to effectively manage the lifecycle of components:

    [x] Create a component as a folder containing: a package descriptor, html, css, javascript and other assets.
    [x] Package this component and publish it to a repository.
    [x] Preview the component as it would appear.
    [x] Have the preview automatically update as changes are published to it.
    [x] Enable auto-publication as a component is modified (coupled with above allows for rapid build / preview).
    [x] Download an existing version of a component for modification.
    [x] Track changes to a component, and allow specifying a single version to be 'live' at any one time.
    [x] Search the repository.
    [x] View full history of a component.
    [x] Preview any previous version of a component.

- Enables me to distribute packages of CSS effectively:

