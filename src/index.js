define(["./fast-xml-parser/parser", "js/nameOf"], function(FXP, nameOf) {
	
	var Xml;

	function logonce(s) {
		var app = require("vcl/Application").instances[0];
		var ac = arguments.callee; ac.cache = (ac.cache || (ac.cache = []));
		if(ac.cache.indexOf(s) === -1) {
			ac.cache.push(s);
			app.print(s);
		}
	}
	function asArray(arr) {
		if(arr instanceof Array) {
			return arr;
		}
		
		if(arr === null || arr === undefined) {
			return [];
		}
		
		return [arr];
	}
	function types(scrape_gml_root, opts) {
		var r = {};
		for(var k in scrape_gml_root) {
			r[k] = scrape_gml_root[k].map(_ => Object.keys(_).join(",")).filter(function(v, i, a) {
				return a.indexOf(v) === i;
			});
		}
		return r;
	}

	function gml(root, messages, opts) {
		function resolve_xlinks(elems, elem, log, done) {
			var key = "@_xlink:href-resolved", href;
			
			done = done || [];
			if(done.indexOf(elem) !== -1) return;
			done.push(elem);
			
			for(var k in elem) {
				if(k !== key && typeof elem[k] === "object") {
					resolve_xlinks(elems, elem[k], log); // <- what about done? 
				}
			}
		
			if((href = elem['@_xlink:href'])) {
				if(href.charAt(0) === '#') href = href.substring(1);
				if(!(elem[key] = elems[href])) {
					log && log.push(String.format("%s not found", href));
				}
			}
		}
		
		var key = Object.keys(root)[0];
		var ns = key.split(":")[0];
		var features = asArray(root[key][ns + ":featureMember"]);
		var elems = {}, map = {}; /* return value */
		var log = [];
	
		resolve_xlinks(elems, root);
		features.forEach(function(_) {
			var key = Object.keys(_)[0];
			var arr = (map[key] = map[key] || []);
	
			elems[_[key]['@_gml:id']] = _;
	
			arr.push(_[key]);
		});
		resolve_xlinks(elems, root, log);
		
		return messages && log.length ? { messages: log, result: map } : map;
		// return map;
	}
	function gml2geojson(feature) {
		
		function coordinates(arr) {
			return arr.map(function(v) {
				if(typeof v['#text'] === "string") {
					v = v['#text'];
				}
				var r = [], coords = v.split(/\s/);
				while(coords.length) {
					r.push([parseFloat(coords.shift()), parseFloat(coords.shift())]);
				}
				return r;
			});
		}
		
		var keys = Object.keys(feature);
		var ft = feature[keys[0]], v;
		var r = { 
			geometry: { type: keys[0].split(":").pop() },
			properties: { id: ft['@_gml:id'] },
			type: "Feature"
		};
		
		if(r.geometry.type === "LineString") {
			r.geometry.coordinates = coordinates(asArray(ft["gml:posList"]));
		} else if(r.geometry.type === "Point") {
			r.geometry.coordinates = coordinates(asArray(ft["gml:pos"]))[0][0];
		} else if(r.geometry.type === "Polygon") {
			r.geometry.coordinates = coordinates(asArray(js.get("gml:exterior.gml:LinearRing.gml:posList", ft)));
		} else if(r.geometry.type === "Curve") {
			r.geometry.type = "LineString";
			r.geometry.coordinates = coordinates(asArray(js.get("gml:segments.gml:LineStringSegment.gml:posList", ft)))[0];
		} else {
			logonce(r.geometry.type);
		}
		r.properties['@_gml'] = ft;
		return r;
	}
	function imkl2geojson(root, opts) {

		function scrape(gml_root, opts) {
			var result = {}; opts = opts || {};
			
			function walk(item, path, objs) {
				
				path = path || [];
				objs = objs || [];
				
				if(objs.indexOf(item) !== -1) return;
				
				objs.push(item);
				
				var r = {}, k;
				for(var key in item) {
					if(key !== "@_gml:id") {// && key!=="@_xlink:href-resolved") {
						path.push(key);
						if(key.indexOf("gml:") === 0) {
							if(opts.fullPaths !== false) {
								r[path.join("/")] = item[key];
							} else {
								if(r[key] instanceof Array) {
									r[key].push(item[key]);
								} else if(r[key] === undefined) {
									r[key] = item[key];
								} else {
									r[key] = [r[key], item[key]];
								}
							}
						} else if(key === "net:link") {
							js.mixIn(r, walk(item[key]["@_xlink:href-resolved"], path, objs));
						} else if(typeof item[key] === "object") {
							js.mixIn(r, walk(item[key], path, objs));
						}
						path.pop();
					}
				}
				return r;
			}
			
			for(var k in gml_root) {
				var arr = gml_root[k].map(item => walk(item)).filter(_ => Object.keys(_).length);
				if(arr.length > 0) {
					result[k] = arr;
				}
			}

			return result;
		}

		opts = opts || {};
		
		var scraped = scrape(gml(root, false));
		var layers = {}, all = [];

		for(var layer in scraped) {
			layers[layer] = {
				type: "FeatureCollection", name: layer,
				crs: { "type": "name", "properties": { "name": "urn:ogc:def:crs:EPSG::28992" } },
				features: scraped[layer].map(gml2geojson)
			};
			all = all.concat(layers[layer].features)
		}
		
		if(opts.all === true) {
			return {
				type: "FeatureCollection", 
				name: (/\d\d.\d\d\d\d\d\d/.exec(all[0].properties.id)||[""])[0],
				crs: { 
					"type": "name", 
					"properties": { "name": "urn:ogc:def:crs:EPSG::28992" } 
				},
				features: all
			}
		}

		return layers;
	}
	
	function doc2source(node, def_ns) {
		if(node.attributes === undefined && node.childNodes === undefined) {// && Object.keys(node.attributes).length === 0) {
			// console.log("return")
			// return;
		}

		var name = node.name.split(":"), 
			ns = name.length > 1 ? name[0] : def_ns,
			out = [];
		
		if(ns) {
			ns = ns + ":";
		} else {
			ns = "";
		}
		
		out.push(js.sf("<%s%s", ns, (name = name.pop())));

// if(node.hasOwnProperty("element_only")) log(node.element_only);

		if(node.element_only) {
			out.push(" />");
		} else if(node.attributes || node.childNodes) {
			if(node.attributes !== undefined) {
				var attrs = [];
				for(var k in node.attributes) {
					out.push(js.sf(" %s=\"%H\"", k, node.attributes[k]));
				}
			}
			
			if(node.childNodes !== undefined) {
				out.push(">");
				node.childNodes.forEach(function(child) {
					if(typeof child === "string") {
						out.push(String.format("%H", child));
					} else if(child.comment) {
						out.push(String.format("<!--%s-->", child.comment));
					} else if(child.attributes || child.childNodes) {
						out.push(doc2source(child));
					} else if(child.element_only) {
						out.push(String.format("<%s />", child.name));
					}
				});
				out.push(String.format("</%s%s>", ns, name));
			} else {
				out[out.length - 1] += " />";
			}
		}
		return out.join("");
    }

	function jsonfy(node, opts, r) {
		if(node.getAttributeNames) {
			var attributes = node.getAttributeNames().map(name => 
					[name, node.getAttribute(name)]);
			var nodes = Array.from(node.childNodes)
					.filter(node => !(node instanceof Text) || node.textContent.trim())
					.map(child => jsonfy(child))
					.filter(_ => _);
					
			r = { x: node.nodeName };
			if(attributes.length) r.a = attributes;
			if(nodes.length) r.n = nodes;
			
		} else if(node instanceof Text) {
			r = node.textContent;
		} else if(node instanceof Comment) {
		} else {
			r = js.sf("%s", node);
		}
		return r;
	}
	function stringify(node, opts) {
		return doc2source(node);
	}

	function getNamespaceIdentifier(xml, namespace) {
	    // Find the root node opening tag
	    const rootStart = xml.indexOf("<");
	    const rootEnd = xml.indexOf(">", rootStart);
	    const rootTag = xml.substring(rootStart, rootEnd + 1);
	  
	    // Find the namespace declaration
	    const nsIndex = rootTag.indexOf(`="${namespace}"`);
	    if (nsIndex === -1) {
	        return null; // Namespace not found
	    }
	  
	    // Extract the namespace identifier
	    const nsDeclaration = rootTag.substring(0, nsIndex);
	    const nsStart = nsDeclaration.lastIndexOf("xmlns:") + 6; // 6 is the length of 'xmlns:'
	    const nsIdentifier = nsDeclaration.substring(nsStart);
	  
	    return nsIdentifier;
	}

	var replace_xmlEntities = (str) => {
		return str && str.replace ? str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
			.replace(/&apos;/g, "'").replace("&quot;", "\"") : str;
	};
	nameOf.methods.push(
		(obj) => {
			if(obj['@_xsi:type']) {
				var entity = {}; 
				obj = js.mixIn(obj); 
				entity[obj['@_xsi:type']] = obj;
				delete obj['@_xsi:type'];
				return js.nameOf(entity);
			}
		},
		(obj) => {
			var keys = Object.keys(obj);
			if(keys.length === 2 && keys[1] === "@_xlink:href-resolved") {
				if(obj[keys[1]] !== undefined) {
					return js.nameOf(obj[keys[1]]);
				} else {
					return js.nameOf(obj[keys[0]]);
				}
			}
			if(keys.length === 1) {
				obj = obj[keys[0]];
				if(keys[0] === "gml:TimeInstant") {
					return obj['gml:timePosition'];
				}
				if(keys[0] === "gml:Point") {
					return obj['gml:pos'] && js.nameOf(obj['gml:pos']);
				}
				if(keys.length && keys[0].indexOf(":") !== -1) {
					var name = js.nameOf(obj);
					return ["[object Object]", "Object", "undefined"].indexOf(name) === -1 ? name : keys[0].split(":").pop();
				}
			}
		},
		(obj) => {
			var t = obj['#text'];
			return (t && js.nameOf((t = replace_xmlEntities(t)))) || t;
		},
		(obj) => (obj['@_name']),
		(obj) => (obj['@_id'])
	);
	// nameOf.methods.after.push(
	// 	(obj) => {
	// 		var keys = Object.keys(obj);
	// 		if(keys.length && keys[0].indexOf(":") !== -1) {
	// 			var name = js.nameOf(obj);
	// 			return ["[object Object]", "Object", "undefined"].indexOf(name) === -1 ? name : keys[0].split(":").pop();
	// 		}
	// 	}
	// );
	return (Xml = {
		parse: (text, opts) => {
			let xml_doc = FXP.parse(text, js.mi({ignoreAttributes: false, 
				parseTrueNumberOnly: true}, opts || {}));
				
			const namespaces = {}, root = xml_doc[Object.keys(xml_doc)[0]];
			if(typeof opts !== "undefined") {
				if(opts.namespaces) {
					const ns = Object.fromEntries(Object.entries(opts.namespaces).map(e => [e[1], e[0]]));
					Object.keys(root)
						.filter(k => k.startsWith("@_xmlns") || k.endsWith(":schemaLocation"))
						.forEach(k => {
							namespaces[k.split(":").pop()] = {
								url: root[k], 
								alias: ns[root[k]] || k.split(":").pop()
							};
						});
						
					// TODO this is not foolproof (xsi:)
					if(namespaces.schemaLocation) {
						namespaces[''] = {
							url: namespaces.schemaLocation.url.split(" ")[0],
							alias: opts.defaultNSPrefix || ""
						};
						delete namespaces.schemaLocation;
					}
				}
				const loop = (obj) => {
					if(obj !== null && typeof obj === "object") {
						if(typeof opts.defaultNSPrefix === "string") {
							obj = Object.fromEntries(Object.entries(obj)
								.map(e => e[0].includes(":") ? 
									[e[0], loop(e[1])] : 
									[opts.defaultNSPrefix + ":" + e[0], loop(e[1])]
								));
						}
						if(typeof opts.namespaces === "object") {
							obj = Object.fromEntries(Object.entries(obj)
								.map(e => {
									const qName = e[0].split(":");
									const prefix = qName.length == 2 ? qName[0] : "";
									const alias = (namespaces[prefix] || {}).alias || prefix;
									return [(alias ? alias + ":" : "") + qName.pop(), loop(e[1])];
								})
							)
						} else if(opts.stripNS) {
							obj = Object.fromEntries(Object.entries(obj)
								.map(e => [e[0].split(":").pop(), e[1]]));
						}
						
					}
					return obj;
				};
				xml_doc = loop(xml_doc);
			}
			
			return xml_doc;	
		},
		// stringify: (obj, type, resolved) => {
		// 	// obj - parsed GML-entity 
			
		// 	if(!resolved) {
		// 		resolved = [];
		// 		var r = [];
		// 		r.push(Xml.stringify(obj, type, resolved));
		// 		for(var i = 0; i < resolved.length; ++i) {
		// 			r.push(Xml.stringify(resolved[i], undefined, resolved));
		// 		}
		// 		return r;
		// 	}
		// 	if(typeof type === "string") {
		// 		var o = {}; 
		// 		o[type] = obj;
		// 		obj = o;
		// 	}
			
		// 	return JSON.stringify(obj, (key, value) => {
		// 		if(key === "@_xlink:href-resolved") {
		// 			if(resolved.indexOf(value) === -1) {
		// 				resolved.push(value);
		// 			}
		// 		} else return value;
		// 	});
		// },
		replaceXmlEntities: replace_xmlEntities,
		
		getNamespaceIdentifier: getNamespaceIdentifier,
		
		jsonfy: (node, options) => jsonfy(node, options),
		stringify: (node, options) => stringify(node, options),

		doc2source: doc2source,		
		gml: gml, 
		// gml2ol: gml2ol,
		gml2geojson: gml2geojson,
		imkl2geojson: imkl2geojson
	});

});