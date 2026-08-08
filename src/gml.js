define(function() {

	function localName(name) {
		return String(name || "").split(":").pop();
	}
	function arrX(value) {
		return value instanceof Array ? value : (value !== undefined && value !== null ? [value] : []);
	}
	function inc(obj, key, value) {
		obj[key] = (obj[key] || 0) + (value || 1);
		return obj[key];
	}
	function objectValues(obj) {
		return Object.keys(obj || {}).map(key => obj[key]);
	}
	function textOf(value) {
		return value === undefined || value === null ? "" : String(value);
	}
	function coordinatesFromText(value) {
		const numbers = textOf(value).replace(/,/g, " ").trim()
			.split(/\s+/)
			.map(value => parseFloat(value))
			.filter(value => !isNaN(value));
		const coordinates = [];
		for(let i = 0; i + 1 < numbers.length; i += 2) {
			coordinates.push([numbers[i], numbers[i + 1]]);
		}
		return coordinates;
	}
	function closeRing(coordinates) {
		const first = coordinates[0];
		const last = coordinates[coordinates.length - 1];
		return first && last && (first[0] !== last[0] || first[1] !== last[1]) ?
			coordinates.concat([[first[0], first[1]]]) : coordinates;
	}
	function attrValue(text, name) {
		const match = String(text || "").match(new RegExp("(?:^|\\s)" + name.replace(/:/g, "\\:") + "\\s*=\\s*\"([^\"]*)\""));
		return match && match[1] || "";
	}
	function srsNameOf(text) {
		return attrValue(text, "srsName");
	}
	function firstChildElement(block) {
		const match = String(block || "").match(/<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b([^>]*)>/);
		return match ? { name: match[1], attrs: match[2] || "", tag: match[0] } : null;
	}
	function hrefIsLocal(href) {
		href = String(href || "");
		return href && href.indexOf("://") === -1 && href.indexOf("urn:") !== 0;
	}
	function normalizeHref(href) {
		return String(href || "").replace(/^#/, "");
	}
	function featureSummary(feature) {
		return {
			id: feature.id,
			type: feature.type,
			localName: feature.localName,
			hasGeometry: feature.hasGeometry,
			primitives: feature.primitives,
			geometryProperties: feature.geometryProperties,
			styleHints: feature.styleHints,
			refs: feature.refs.length
		};
	}
	function scan(text, opts) {
		opts = opts || {};
		text = String(text || "");
		const started = Date.now();
		const memberRe = /<([A-Za-z_][\w.-]*:)?(featureMember|member)\b[^>]*>/g;
		const primitiveRe = /<([A-Za-z_][\w.-]*:)?(Point|MultiPoint|LineString|Curve|MultiCurve|Polygon|Surface|MultiSurface)\b/g;
		const hrefRe = /<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b[^>]*\bxlink:href="([^"]+)"[^>]*\/?>/g;
		const geometryPropertyRe = /<((?:[A-Za-z_][\w.-]*:)?(?:geometrie|geometry|positie|locatie|ligging|geographicalPosition|centrelineGeometry|extent|positiePunt|plaatsbepaling|extraGeometrie|heeftExtraInformatie))\b[^>]*>/ig;
		const features = [];
		const byType = {};
		const stats = {
			bytes: text.length,
			features: 0,
			types: 0,
			geometryFeatures: 0,
			primitives: {},
			refs: 0
		};
		let member;

		while((member = memberRe.exec(text))) {
			const memberPrefix = member[1] || "";
			const memberLocal = member[2];
			const contentStart = memberRe.lastIndex;
			const close = "</" + memberPrefix + memberLocal + ">";
			const contentEnd = text.indexOf(close, contentStart);
			if(contentEnd === -1) break;

			const block = text.slice(contentStart, contentEnd);
			const root = firstChildElement(block);
			memberRe.lastIndex = contentEnd + close.length;
			if(!root) continue;

			const feature = {
				index: features.length,
				type: root.name,
				localName: localName(root.name),
				id: attrValue(root.attrs, "gml:id") || attrValue(root.attrs, "id"),
				start: contentStart,
				end: contentEnd,
				memberStart: member.index,
				memberEnd: memberRe.lastIndex,
				primitives: {},
				geometryProperties: {},
				refs: [],
				styleHints: null,
				hasGeometry: false
			};
			let match;
			primitiveRe.lastIndex = 0;
			while((match = primitiveRe.exec(block))) {
				inc(feature.primitives, match[2]);
				inc(stats.primitives, match[2]);
			}
			geometryPropertyRe.lastIndex = 0;
			while((match = geometryPropertyRe.exec(block))) {
				inc(feature.geometryProperties, match[1]);
			}
			hrefRe.lastIndex = 0;
			while((match = hrefRe.exec(block))) {
				const href = normalizeHref(match[2]);
				if(hrefIsLocal(href)) {
					feature.refs.push({ prop: match[1], href: href });
					stats.refs++;
				}
			}
			if(opts.onFeature instanceof Function) {
				opts.onFeature(feature, block, root);
			}
			feature.hasGeometry = Object.keys(feature.primitives).length > 0;
			features.push(feature);
			const type = byType[feature.type] || (byType[feature.type] = {
				type: feature.type,
				localName: feature.localName,
				count: 0,
				geometryCount: 0,
				primitives: {},
				geometryProperties: {},
				refs: {},
				ids: []
			});
			type.count++;
			if(feature.hasGeometry) {
				type.geometryCount++;
				stats.geometryFeatures++;
				if(type.ids.length < (opts.sampleIds || 6)) {
					type.ids.push(feature.id);
				}
			}
			Object.keys(feature.primitives).forEach(key => inc(type.primitives, key, feature.primitives[key]));
			Object.keys(feature.geometryProperties).forEach(key => inc(type.geometryProperties, key, feature.geometryProperties[key]));
			feature.refs.forEach(ref => inc(type.refs, ref.prop));
		}

		stats.features = features.length;
		stats.types = Object.keys(byType).length;
		stats.duration = Date.now() - started;
		return {
			type: opts.type || opts.domain || "gml",
			version: opts.version || "",
			features: features,
			byType: byType,
			stats: stats
		};
	}
	function index(scanResult) {
		const byId = {};
		const byType = scanResult.byType || {};
		(scanResult.features || []).forEach(feature => {
			if(feature.id) {
				byId[feature.id] = feature;
			}
		});
		return {
			type: scanResult.type,
			version: scanResult.version,
			features: scanResult.features || [],
			byType: byType,
			byId: byId,
			stats: scanResult.stats || {}
		};
	}
	function reachableGeometryFeatures(gmlIndex, feature, seen) {
		if(!feature) return [];
		seen = seen || {};
		if(feature.id && seen[feature.id]) return [];
		if(feature.id) seen[feature.id] = true;
		let result = feature.hasGeometry ? [feature] : [];
		(feature.refs || []).forEach(ref => {
			result = result.concat(reachableGeometryFeatures(gmlIndex, gmlIndex.byId[ref.href], seen));
		});
		const ids = {};
		return result.filter(item => {
			const key = item.id || item.index;
			if(ids[key]) return false;
			ids[key] = true;
			return true;
		});
	}
	function layerLabel(type, suffix) {
		const label = localName(type).replace(/([a-z])([A-Z])/g, "$1 $2");
		return suffix ? label + " " + suffix : label;
	}
	function featureTypes(index, predicate) {
		return Object.keys(index.byType || {})
			.map(type => index.byType[type])
			.filter(predicate || function() { return true; })
			.sort((a, b) => b.count - a.count);
	}
	function planGenericLayers(index, opts) {
		opts = opts || {};
		const layers = [];
		featureTypes(index, type => type.geometryCount > 0).forEach(type => {
			layers.push({
				key: "direct:" + type.type,
				mode: "direct",
				kind: "direct",
				type: type.type,
				name: layerLabel(type.type),
				count: type.geometryCount,
				primitives: type.primitives,
				checked: opts.checked === true
			});
		});
		return layers;
	}
	function planLayers(index, opts) {
		return planGenericLayers(index, opts);
	}
	function layerFeatures(index, layer) {
		if(!layer) return [];
		if(layer.mode === "all") {
			return index.features.filter(feature => feature.hasGeometry);
		}
		if(layer.mode === "direct") {
			return index.features.filter(feature => feature.type === layer.type && feature.hasGeometry);
		}
		if(layer.mode === "referenced") {
			return index.features.filter(feature => feature.type === layer.type &&
				reachableGeometryFeatures(index, feature).length);
		}
		return [];
	}
	function summaryView(index, layers) {
		layers = layers || planLayers(index);
		const typeRows = featureTypes(index).map(type => ({
			Type: type.type,
			Aantal: type.count,
			Geometrie: type.geometryCount,
			Primitives: Object.keys(type.primitives).map(key => key + ": " + type.primitives[key]).join(", "),
			GeometrieEigenschappen: Object.keys(type.geometryProperties).join(", "),
			Referenties: Object.keys(type.refs).map(key => key + ": " + type.refs[key]).join(", ")
		}));
		return {
			Lagen: layers.map(layer => ({
				Naam: layer.name,
				Type: layer.type || "",
				Soort: layer.kind,
				Modus: layer.mode,
				Features: layer.count,
				Geometrie: layer.geometryCount || layer.count
			})),
			Featuretypen: typeRows,
			Geometrie: typeRows.filter(row => row.Geometrie),
			Statistiek: [index.stats]
		};
	}
	function mapToText(map) {
		return Object.keys(map || {}).map(key => key + ": " + map[key]).join(", ");
	}
	function featureView(index) {
		const view = {};
		featureTypes(index).forEach(type => {
			view[type.type] = index.features
				.filter(feature => feature.type === type.type)
				.map(feature => ({
					"@gml:id": feature.id || "",
					type: feature.type,
					localName: feature.localName,
					hasGeometry: feature.hasGeometry,
					primitives: mapToText(feature.primitives),
					geometryProperties: Object.keys(feature.geometryProperties || {}).join(", "),
					"xlink:href": (feature.refs || []).map(ref => ref.prop + ": " + ref.href).join(", "),
					start: feature.start,
					end: feature.end
				}));
		});
		return view;
	}
	function elementBlocks(text, name) {
		const blocks = [];
		const openRe = new RegExp("<([A-Za-z_][\\w.-]*:)?" + name + "\\b[^>]*>", "g");
		let match;
		while((match = openRe.exec(text))) {
			const prefix = match[1] || "";
			const close = "</" + prefix + name + ">";
			const end = text.indexOf(close, openRe.lastIndex);
			if(end === -1) break;
			blocks.push({
				start: match.index,
				end: end + close.length,
				open: match[0],
				body: text.slice(openRe.lastIndex, end),
				text: text.slice(match.index, end + close.length)
			});
			openRe.lastIndex = end + close.length;
		}
		return blocks;
	}
	function firstText(text, names) {
		for(let i = 0; i < names.length; i++) {
			const blocks = elementBlocks(text, names[i]);
			if(blocks.length) {
				return blocks[0].body;
			}
		}
		return "";
	}
	function pointGeometry(text) {
		const coordinates = coordinatesFromText(firstText(text, ["pos", "coordinates"]))[0];
		return coordinates ? { type: "Point", coordinates: coordinates, srsName: srsNameOf(text) } : null;
	}
	function lineGeometry(text) {
		let coordinates = coordinatesFromText(firstText(text, ["posList", "coordinates"]));
		if(!coordinates.length) {
			coordinates = elementBlocks(text, "pos")
				.map(block => coordinatesFromText(block.body)[0])
				.filter(Boolean);
		}
		return coordinates.length > 1 ? { type: "LineString", coordinates: coordinates, srsName: srsNameOf(text) } : null;
	}
	function curveGeometry(text) {
		let coordinates = [];
		elementBlocks(text, "LineStringSegment").forEach(segment => {
			const line = lineGeometry(segment.text);
			if(line) {
				coordinates = coordinates.concat(line.coordinates);
			}
		});
		if(!coordinates.length) {
			const line = lineGeometry(text);
			coordinates = line && line.coordinates || [];
		}
		return coordinates.length > 1 ? { type: "LineString", coordinates: coordinates, srsName: srsNameOf(text) } : null;
	}
	function polygonGeometry(text) {
		let rings = elementBlocks(text, "LinearRing")
			.map(ring => coordinatesFromText(firstText(ring.text, ["posList", "coordinates"])))
			.filter(ring => ring.length > 2)
			.map(closeRing);
		if(!rings.length) {
			rings = elementBlocks(text, "posList")
				.map(block => coordinatesFromText(block.body))
				.filter(ring => ring.length > 2)
				.map(closeRing);
		}
		return rings.length ? { type: "Polygon", coordinates: rings, srsName: srsNameOf(text) } : null;
	}
	function geometriesFromText(text) {
		text = String(text || "");
		const geometries = [];
		const multiSurfaces = elementBlocks(text, "MultiSurface");
		if(multiSurfaces.length) {
			multiSurfaces.forEach(multiSurface => {
				const polygons = elementBlocks(multiSurface.text, "Polygon")
					.concat(elementBlocks(multiSurface.text, "Surface"))
					.map(polygon => polygonGeometry(polygon.text))
					.filter(Boolean);
				if(polygons.length) {
					geometries.push({
						type: "MultiPolygon",
						coordinates: polygons.map(polygon => polygon.coordinates),
						srsName: srsNameOf(multiSurface.open) || polygons[0].srsName
					});
				}
			});
			return geometries;
		}
		elementBlocks(text, "Polygon").forEach(block => {
			const geometry = polygonGeometry(block.text);
			geometry && geometries.push(geometry);
		});
		elementBlocks(text, "Surface").forEach(block => {
			const geometry = polygonGeometry(block.text);
			geometry && geometries.push(geometry);
		});
		elementBlocks(text, "Curve").forEach(block => {
			const geometry = curveGeometry(block.text);
			geometry && geometries.push(geometry);
		});
		elementBlocks(text, "LineString").forEach(block => {
			const geometry = lineGeometry(block.text);
			geometry && geometries.push(geometry);
		});
		elementBlocks(text, "Point").forEach(block => {
			const geometry = pointGeometry(block.text);
			geometry && geometries.push(geometry);
		});
		return geometries;
	}
	function featureFragment(text, feature) {
		return feature ? String(text || "").slice(feature.start, feature.end) : "";
	}

	return {
		scan: scan,
		index: index,
		planLayers: planLayers,
		planGenericLayers: planGenericLayers,
		layerFeatures: layerFeatures,
		reachableGeometryFeatures: reachableGeometryFeatures,
		summaryView: summaryView,
		featureView: featureView,
		featureFragment: featureFragment,
		geometriesFromText: geometriesFromText,
		coordinatesFromText: coordinatesFromText,
		localName: localName,
		featureSummary: featureSummary
	};
});
