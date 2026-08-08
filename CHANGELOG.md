### 2026/08/07 — XML traversal, safer xlinks and reusable GML scanning

#### XML object helpers and parsing

- Extends [src/index.js]() with namespace-agnostic text, attribute, child, recursive collection, coordinate and SRS/EPSG helpers for package-owned document interpreters.
- Adds named and numeric XML entity decoding with an in-place fallback when the bundled parser does not honour `decodeHTMLchar`, supports `removeNSPrefix` as a strip-namespace option and registers GML IDs once as preferred object names.
- Makes IMKL traversal tolerate null or repeated objects and resolves internal xlinks in two passes through cycle-safe collection, non-enumerable lazy targets and resolution statistics while leaving external references untouched.

#### GML scan and geometry extraction

- Adds [src/gml.js]() for source-text scanning of GML feature members, types, IDs, geometry primitives/properties, local xlinks and source offsets without first building a full parsed feature tree.
- Adds feature/type indexes, referenced-geometry traversal, generic layer planning, summary and feature views, source-fragment lookup and extraction of Point, LineString, Curve, Polygon, Surface and MultiSurface geometries.

#### Repository metadata

- Adds [package_monitor.log]() with the retained four-line 2023 package-monitor history for the package's `.md` resource.

### 2025/10/10 — 1.0.8

- Stops filtering out `"xmlns"` attributes during parsing — now preserved in attribute maps.
- Adds **`escape(str)`** for XML-safe encoding (`&`, `<`, `>`, `'`, `"`).
- Adds **`skipPrologue(xml)`** to trim XML declarations before parsing.
- Introduces **`nodify(xml_doc)`**, converting parsed XML objects into a DOM-like tree with attributes and child nodes.
- Refactors **namespace handling**: improved alias resolution and default namespace prefix detection.
- Adds smarter mapping for `@_xmlns` and schema locations.
- Cleans up and modernizes `replaceXmlEntities()` → `replaceXmlEntities` (camelCase).
- Updates `Xml.applyParseOptions()` with support for nested namespace alias sets and dynamic `defaultNSPrefix`.
- Exports new helpers: `escape`, `skipPrologue`, `jsonfy`, `nodify`, and improved alias detection in `nameOf`.
- Minor cleanup and reordering of logic in XML parser internals.
* Bumps version to **1.0.7**.
* Preserves `"xmlns"` attributes in parsed attribute maps (no longer filtered).
* Renames internal `replace_xmlEntities` → `replaceXmlEntities`; exported name remains `replaceXmlEntities`.
* Adds `escape(str)` for XML-safe encoding of `& < > ' "`.
* Adds `skipPrologue(xml)` to strip `<?xml ...?>` before parsing.
* Introduces `nodify(xml_doc, options)` producing DOM-like nodes with `name`, `attributes`, and `childNodes`.
* Exports new helpers: `escape`, `skipPrologue`, `nodify` (alongside existing `replaceXmlEntities`, `jsonfy`, `stringify`).
* `applyParseOptions()` now accepts **multiple URIs per alias** in `opts.namespaces` and builds a reverse map.
* Automatically sets `defaultNSPrefix` from `@_xmlns` when not provided.
* Improves namespace alias resolution for elements and attributes (incl. `:schemaLocation` handling).
* Fixes attribute prefix normalization so `@_` names keep the attribute marker after aliasing.
* Minor parser cleanup and reordering; behavior of `parse()` unchanged aside from new post-processing options.

...

### 2021/09/25 - 1.0.5

- Introducing/packing veldapps-xml/Writer

### 2021/08/12

- Introducing veldapps-xml/jsonfy

### 2020-12-22 - 1.0.3
- Updating in favor of `#VA-20201218-1` (ie. Arcadis SIKB/CSV-conversion - 1st order)
- Mainly refactored a lot of js/nameOf.methods 

### 2020-11-22
- Real numbers please

### 2020-11-11
- Refactoring js.nameOf-methods

### 2020-11-05
- Introducing fast-xml-parser (moved from cavalion-code)

### 2020-11-01
* Initial coding
