define(["./fast-xml-parser/parser", "./comment-parser", "js/nameOf"], function(FXP, CP, nameOf) {
	
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
	function textOf(value) {
		if(value === undefined || value === null) return "";
		if(typeof value === "string" || typeof value === "number" || typeof value === "boolean") return "" + value;
		if(value instanceof Array) return value.map(textOf).filter(Boolean).join("\n");
		return value["#text"] || value._Data || value._data || value.text || "";
	}
	function localName(key) {
		return String(key || "").replace(/^@_?/, "").split(":").pop();
	}
	function isAttributeKey(key) {
		return (/^@_?/).test(key);
	}
	function attr(obj, name) {
		var keys = ["@_" + name, "@" + name, name];
		var value;
		if(!obj || typeof obj !== "object") return "";
		for(var i = 0; i < keys.length; ++i) {
			value = obj[keys[i]];
			if(value !== undefined && value !== null) return value;
		}
		return "";
	}
	function childEntries(obj, names) {
		names = asArray(names);
		if(!obj || typeof obj !== "object") return [];
		return Object.keys(obj)
			.filter(function(key) { return !isAttributeKey(key) && names.indexOf(localName(key)) !== -1; })
			.map(function(key) {
				return asArray(obj[key]).map(function(value) {
					return { key: localName(key), value: value, sourceKey: key };
				});
			})
			.reduce(function(acc, values) { return acc.concat(values); }, []);
	}
	function childValues(obj, names) {
		return childEntries(obj, names).map(function(entry) { return entry.value; });
	}
	function firstChild(obj, names) {
		return childValues(obj, names)[0];
	}
	function hasKeyMatching(obj, matcher, seen) {
		seen = seen || [];
		if(obj instanceof Array) {
			return obj.some(function(value) { return hasKeyMatching(value, matcher, seen); });
		}
		if(!obj || typeof obj !== "object") {
			return false;
		}
		if(seen.indexOf(obj) !== -1) {
			return false;
		}
		seen.push(obj);
		return Object.keys(obj).some(function(key) {
			return matcher(key, obj[key]) || hasKeyMatching(obj[key], matcher, seen);
		});
	}
	function coordinatePairsFromText(value) {
		var numbers = textOf(value).replace(/,/g, " ").trim()
			.split(/\s+/)
			.map(function(value) { return parseFloat(value); })
			.filter(function(value) { return !isNaN(value); });
		var coordinates = [];
		for(var i = 0; i + 1 < numbers.length; i += 2) {
			coordinates.push([numbers[i], numbers[i + 1]]);
		}
		return coordinates;
	}
	function collectValuesForKeys(obj, keys, values, seen) {
		values = values || [];
		seen = seen || [];
		if(obj instanceof Array) {
			obj.forEach(function(value) { collectValuesForKeys(value, keys, values, seen); });
		} else if(obj && typeof obj === "object") {
			if(seen.indexOf(obj) !== -1) return values;
			seen.push(obj);
			Object.keys(obj).forEach(function(key) {
				if(keys.indexOf(key) !== -1) {
					values.push(obj[key]);
				}
				collectValuesForKeys(obj[key], keys, values, seen);
			});
		}
		return values;
	}
	function collectObjectsForKeys(obj, keys, values, seen) {
		values = values || [];
		seen = seen || [];
		if(obj instanceof Array) {
			obj.forEach(function(value) { collectObjectsForKeys(value, keys, values, seen); });
		} else if(obj && typeof obj === "object") {
			if(seen.indexOf(obj) !== -1) return values;
			seen.push(obj);
			Object.keys(obj).forEach(function(key) {
				if(keys.indexOf(key) !== -1) {
					asArray(obj[key]).forEach(function(value) {
						if(values.indexOf(value) === -1) values.push(value);
					});
				}
				collectObjectsForKeys(obj[key], keys, values, seen);
			});
		}
		return values;
	}
	function srsNameOf(obj) {
		return collectValuesForKeys(obj, ["@_srsName", "@srsName", "srsName"])
			.map(textOf)
			.filter(Boolean)[0] || "";
	}
	function epsgCodeOf(srsName) {
		var text = String(srsName || "");
		var match = text.match(/EPSG(?::|::|\/|#)(\d+)/i) || text.match(/epsg\.xml#(\d+)/i);
		return match ? "EPSG:" + match[1] : "";
	}
	function projectionCodeOf(obj) {
		return epsgCodeOf(srsNameOf(obj));
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
		function createSeen() {
			if(typeof WeakSet !== "undefined") {
				var weak = new WeakSet();
				return {
					has: function(obj) { return weak.has(obj); },
					add: function(obj) { weak.add(obj); }
				};
			}
			var items = [];
			return {
				has: function(obj) { return items.indexOf(obj) !== -1; },
				add: function(obj) { items.push(obj); }
			};
		}
		function defineResolvedXlink(elem, key, target) {
			try {
				Object.defineProperty(elem, key, {
					configurable: true,
					enumerable: false,
					get: function() {
						Object.defineProperty(elem, key, {
							configurable: true,
							enumerable: false,
							writable: true,
							value: target
						});
						return target;
					}
				});
			} catch(e) {
				elem[key] = target;
			}
		}
		function collect_gml_refs(elems, hrefs, elem, seen, stats) {
			var key = "@_xlink:href-resolved";
			if(!elem || typeof elem !== "object") return;
			if(seen.has(elem)) {
				stats.skipped = (stats.skipped || 0) + 1;
				return;
			}
			seen.add(elem);
			stats.visited = (stats.visited || 0) + 1;
			if(elem["@_gml:id"] && elems[elem["@_gml:id"]] === undefined) {
				elems[elem["@_gml:id"]] = elem;
				stats.ids = (stats.ids || 0) + 1;
			}
			if(elem['@_xlink:href']) {
				hrefs.push(elem);
			}
			for(var k in elem) {
				if(k !== key && elem[k] && typeof elem[k] === "object") {
					collect_gml_refs(elems, hrefs, elem[k], seen, stats);
				}
			}
		}
		function resolve_xlinks(elems, hrefs, log, stats) {
			var key = "@_xlink:href-resolved";
			hrefs.forEach(function(elem) {
				var href = elem['@_xlink:href'];
				if(href.charAt(0) !== '#') {
					stats.external = (stats.external || 0) + 1;
					return;
				}
				href = href.substring(1);
				if(elems[href] !== undefined) {
					defineResolvedXlink(elem, key, elems[href]);
					stats.resolved = (stats.resolved || 0) + 1;
				} else {
					stats.unresolved = (stats.unresolved || 0) + 1;
					log && log.push(String.format("%s not found", href));
				}
			});
		}
		
		opts = opts || {};
		var started = Date.now();
		var key = Object.keys(root)[0];
		var ns = key.split(":")[0];
		var features = asArray(root[key][ns + ":featureMember"]);
		var elems = {}, map = {}; /* return value */
		var hrefs = [];
		var log = [];
		var stats = { features: features.length };
	
		collect_gml_refs(elems, hrefs, root, createSeen(), stats);
		features.forEach(function(_) {
			var key = Object.keys(_)[0];
			var arr = (map[key] = map[key] || []);
	
			elems[_[key]['@_gml:id']] = _;
	
			arr.push(_[key]);
		});
		resolve_xlinks(elems, hrefs, log, stats);
		stats.duration = Date.now() - started;
		stats.hrefs = hrefs.length;
		stats.lazy = true;
		stats.types = Object.keys(map).length;
		if((opts.debug || stats.duration > 1000) && typeof console !== "undefined" && console.warn) {
			console.warn("[veldapps-xml] gml xlink resolve", stats);
		}
		
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
				
				if(!item || typeof item !== "object" || objs.indexOf(item) !== -1) return {};
				
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
						} else if(item[key] && typeof item[key] === "object") {
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

	function getNamespacePrefix(xml, namespace) {
	    // Find the root node opening tag
	    const rootStart = xml.indexOf("<");
	    const rootEnd = xml.indexOf(">", rootStart);
	    const rootTag = xml.substring(rootStart, rootEnd + 1);
	  
	    // Find the namespace declaration
	    const nsIndex = rootTag.indexOf(`="${namespace}"`);
	    if (nsIndex === -1) {
	        return null; // Namespace not found
	    }
	  
	    // Extract the namespace prefix
	    const nsDeclaration = rootTag.substring(0, nsIndex);
	    const nsStart = nsDeclaration.lastIndexOf("xmlns:") + 6; // 6 is the length of 'xmlns:'
	    const nsPrefix = nsDeclaration.substring(nsStart);
	  
	    return nsPrefix;
	}
	function replaceXmlEntities(str) {
		return str && str.replace ? str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
			.replace(/&apos;/g, "'").replace("&quot;", "\"") : str;
	};
	function xmlEntityDecoded(value) {
		if(typeof value !== "string") return value;
		return value
			.replace(/&#x([0-9a-f]+);/gi, function(match, code) { return String.fromCodePoint(parseInt(code, 16)); })
			.replace(/&#([0-9]+);/g, function(match, code) { return String.fromCodePoint(parseInt(code, 10)); })
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&apos;/g, "'")
			.replace(/&quot;/g, "\"")
			.replace(/&amp;/g, "&");
	}
	var xmlParseDecodesEntities;
	function xmlParseSupportsEntityDecode() {
		if(xmlParseDecodesEntities === undefined) {
			var parsed = FXP.parse("<value>&amp;</value>", { ignoreAttributes: false, decodeHTMLchar: true });
			xmlParseDecodesEntities = parsed && parsed.value === "&";
		}
		return xmlParseDecodesEntities;
	}
	function decodeXmlEntitiesInPlace(value, seen) {
		if(value instanceof Array) {
			value.forEach(function(item, index) {
				value[index] = typeof item === "string" ? xmlEntityDecoded(item) : decodeXmlEntitiesInPlace(item, seen);
			});
			return value;
		}
		if(!value || typeof value !== "object") {
			return value;
		}
		seen = seen || [];
		if(seen.indexOf(value) !== -1) {
			return value;
		}
		seen.push(value);
		Object.keys(value).forEach(function(key) {
			var item = value[key];
			value[key] = typeof item === "string" ? xmlEntityDecoded(item) : decodeXmlEntitiesInPlace(item, seen);
		});
		return value;
	}
	function escape(str) {
		return str && str.replace
			? str
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/'/g, "&apos;")
				.replace(/"/g, "&quot;")
			: str;
	}	
	
	function skipPrologue(xml) {
		if(!xml) return xml;
		// Find the end of the prologue if it exists
		const prologueEnd = xml.indexOf("?>");
		return xml.substring(prologueEnd !== -1 ? prologueEnd + 2 : 0).trim();
	}

	if(!nameOf.methods.some(method => method._veldappsXmlGmlId === true)) {
		const nameOfGmlId = (obj) => obj.gml_id || obj["@_gml:id"] || obj["@gml:id"];
		nameOfGmlId._veldappsXmlGmlId = true;
		nameOf.methods.unshift(nameOfGmlId);
	}
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
			if(Object.prototype.hasOwnProperty.call(obj, "@_xlink:href-resolved")) {
				if(obj["@_xlink:href-resolved"] !== undefined) {
					return js.nameOf(obj["@_xlink:href-resolved"]);
				} else if(keys.length) {
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
			return (t && js.nameOf((t = replaceXmlEntities(t)))) || t;
		},
		(obj) => (obj['@_name']),
		(obj) => (obj['@_id']),
		(obj) => { 
			const keys = Object.keys(obj); 
			if(keys.length === 1 && keys[0].split(":") === 2) {
				const v = obj[keys[0]];
				if(typeof v === "object" && v !== null ) {
					return keys[0];
				}
			}
		}
	);
	
	return (Xml = {

		jsonfy: (node, options) => jsonfy(node, options),
		stringify: (node, options) => { 
			return stringify(node, options);
		},
		nodify: (xml_doc, options) => {
			const root = Object.keys(xml_doc)[0];
			const make_node = (elem, name) => {
				const attributeNames = Object.keys(elem).filter(key => key.startsWith("@_"));
				const elementNames = Object.keys(elem).filter(key => !key.startsWith("@_") && key !== "#text");
				const node = {
					name: name,
					childNodes: [],
					attributes: {}
				};

				elementNames.forEach(elName => {
					if(elem[elName] instanceof Array) {
						elem[elName].forEach(el => node.childNodes.push(make_node(el, elName)));
					} else {
						const el = elem[elName];
						if(typeof el === "object") {
							node.childNodes.push(make_node(el, elName));
						} else {
							node.childNodes.push({name: elName, childNodes: ["" + el] })
						}
					}
				});
				
				if(elem['#text'] !== undefined) {
					node.childNodes.push("" + elem['#text']);
				}
				
				attributeNames.forEach(aName => {
					// remove @_
					node.attributes[aName.substring(2)] = elem[aName];
				});
				
				if(!node.childNodes.length) delete node.childNodes;
				if(!Object.keys(node.attributes).length) delete node.attributes;

				return node;
			}
			
			return make_node(xml_doc[root], root);
		},

		applyParseOptions: (xml_doc, opts = {}) => {
			const namespaces = {}, root = xml_doc[Object.keys(xml_doc)[0]];
			if(opts.namespaces) {
				const ns = Object.fromEntries(Object.entries(opts.namespaces).map(e => e[1].map(ns => [ns, e[0]])).flat())
				Object.keys(root)
					.filter(k => k.startsWith("@_xmlns") || k.endsWith(":schemaLocation"))
					.forEach(k => {
						namespaces[k === '@_xmlns' ? '' : k.split(":").pop()] = {
							url: root[k], 
							alias: ns[root[k]] || k.split(":")[1] || ns['']
						};
					});
					
				if(namespaces[''] && !opts.hasOwnProperty("defaultNSPrefix")) {
					opts.defaultNSPrefix = namespaces[''].alias;
				}
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
				if(obj instanceof Array) return obj.map(o => loop(o));
				
				if(obj !== null && typeof obj === "object") {
					if(opts.defaultNSPrefix) {
						obj = Object.fromEntries(Object.entries(obj)
							.map(e => e[0].includes(":") || e[0].startsWith("@_") || e[0].startsWith("#text") ? 
								[e[0], loop(e[1])] : 
								[opts.defaultNSPrefix + ":" + e[0], loop(e[1])]
							));
					}
					// if(typeof opts.defaultNSPrefix === "string") {
					// 	const prefix = opts.defaultNSPrefix;
					// 	const shouldStrip = opts.stripDefaultNSPrefix === true;
					
					// 	obj = Object.fromEntries(Object.entries(obj)
					// 		.map(([key, value]) => {
					// 			if (key.includes(":") || key.startsWith("@_") || key.startsWith("#text")) {
					// 				return [key, loop(value)];
					// 			} else {
					// 				const newKey = shouldStrip ? key : prefix + ":" + key;
					// 				return [newKey, loop(value)];
					// 			}
					// 		}));
					// }
					if(opts.comments === "kvp" && obj._comments) {
						obj._comments.map(s => s.substring(3, s.length - 2).split(": "))
							.forEach(e => obj[e[0].replace(/-/, ":")] = e[1])
						delete obj._comments;
					}
					if(obj['@_']) {
						Object.keys(obj['@_']).forEach(key => obj['@_' + key] = obj['@_'][key]);
						delete obj['@_'];
					}
					if(typeof opts.namespaces === "object") {
						obj = Object.fromEntries(Object.entries(obj)
							.map(e => {
								const qName = e[0].split(":");
								const prefix = (qName.length == 2 ? qName[0] : "");
								
								if(prefix) {
									const alias = (namespaces[prefix.replace(/\@_/, "")] || {}).alias || prefix;
									e[0] = (alias ? alias + ":" : "") + qName.pop();
									if(prefix.match(/\@_/, "")) {
										if(!e[0].startsWith("@_")) {
											e[0] = "@_" + e[0];
										} else {
											// TODO find out why this can happen
										}
									}
								}
								
								e[1] = loop(e[1]);
								
								return e;
							})
						)
					} else if(opts.stripNS || opts.removeNSPrefix) {
						obj = Object.fromEntries(Object.entries(obj)
							.map(e => [e[0].split(":").pop(), loop(e[1])]));
					} else {
						Object.keys(obj).forEach(k => loop(obj[k]));
					}
				}

				return obj;
			};
			const doc2 = loop(xml_doc);
			if(doc2 !== xml_doc) {
				Object.keys(xml_doc).forEach(k => delete xml_doc[k]);
				Object.keys(doc2).forEach(k => xml_doc[k] = doc2[k])
			}
		},
		parse: (text, opts) => {
			let xml_doc = opts && opts.comments === "kvp" ? 
				CP.parse(text, js.mi({ preserveAttributes: true, preserveDocumentNode: true }, opts || {})) : 
				FXP.parse(text, js.mi({ignoreAttributes: false, parseTrueNumberOnly: true}, opts || {}));

			if(opts && opts.decodeHTMLchar && !xmlParseSupportsEntityDecode()) {
				decodeXmlEntitiesInPlace(xml_doc);
			}
				
			if(typeof opts !== "undefined") {
				Xml.applyParseOptions(xml_doc, opts);
			}
			
			return xml_doc;	
		},

		replaceXmlEntities,
		xmlEntityDecoded,
		xmlParseSupportsEntityDecode,
		decodeXmlEntitiesInPlace,
		textOf,
		localName,
		localNameOf: localName,
		isAttributeKey,
		attr,
		childEntries,
		childValues,
		firstChild,
		hasKeyMatching,
		coordinatePairsFromText,
		collectValuesForKeys,
		collectObjectsForKeys,
		srsNameOf,
		epsgCodeOf,
		projectionCodeOf,
		getNamespacePrefix,
		skipPrologue, 
		
		doc2source, escape,
		
		gml, gml2geojson, imkl2geojson
	});

});
