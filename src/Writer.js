define(function(require) {
	
	var XmlWriter = {
		attribute: function(name, value, type, f) {
			if(this._element === null) {
				throw new Error("No element");
			}
			if(value !== undefined && value !== "" && value !== null) {
				if((type === "xs:date" || type === "date") && value instanceof Date) {
					value = String.format("%d-%02d-%02d", value.getFullYear(), value.getMonth() + 1, value.getDate());
				} else if((type === "xs:time" || type === "time") && value instanceof Date) {
					value = String.format("%02d:%02d:%02d", value.getHours(), value.getMinutes(), value.getSeconds());
				}
				if(typeof f === "function") {
					value = f(value);
				}
				this._element.attributes[name] = value;
			}
		},
		element: function(name, value, f, thisObj) {
			var current = this._element;

			var r = this._element = {
					name: name,
					attributes: {},
					childNodes: []
				};

			if(current !== null) {
				current.childNodes.push(r);
			} else {
				this._root = r;
			}

			if(/*(value !== undefined && value !== "" && value !== null) && */typeof f === "function") {
				f.apply(thisObj, [this, value]);
			}

			this._element = current;

			if(Object.keys(r.attributes).length === 0) {
				delete r.attributes;
			}
			if(r.childNodes.length === 0) {
				delete r.childNodes;
			}

			return r;
		},
		comment: function(comment) {
			if(!this._element) {
				// FIXME
				throw new Error("Top level comment not supported (yet)");
			}

			this._element.childNodes.push({
				comment: comment
			});
		},
		elements: function(name, instances, f, thisObj) {
			if(typeof instances === "function") instances = instances(instances);
			
			if(instances instanceof Array) {
				instances.forEach(function(instance) {
					this.element(name, obj, f, thisObj);
				}, this);
			}
		},
		content_element: function(name, value, type, size, f) {
			if(value !== undefined && value !== "" && value !== null) {
				if(type === "xs:date" && value instanceof Date) {
					value = String.format("%d-%02d-%02d", value.getFullYear(), value.getMonth() + 1, value.getDate());
				} else if(type === "xs:time" && value instanceof Date) {
					value = String.format("%02d:%02d:%02d", value.getHours(), value.getMinutes(), value.getSeconds());
				} else if(type === "boolean") {
					value = ("" + value);
				}
				if(typeof f === "function") {
					value = f(value);
				}
				this.element(name, value, function(writer, value) {
					writer.content(value);
				}, this);
			}
		},
		content: function(value) {
			this._element.childNodes.push(String.format("%s", value));
		},
		
		attribute_: function(name, instance, type, f) {
			var value = instance[name];
			this.attribute(name, value, type, f);
		},
		element_: function(name, instance, f, thisObj, occurs) {
			var value = instance[name];
			if(value !== undefined && value !== null) {
				this.element(name, value, f, thisObj);
			}
		},
		elements_: function(name, instance, f, thisObj, occurs) {
			var instances = instance[name];
			if(instances) {
				if(!(instances instanceof Array)) {
					log("WARNING: Converted non-array to array for: " + name);
					instances = [instances];
				}
				instances.forEach(function(instance) {
					this.element(name, instance, f, thisObj);
				}, this);
			}
		},
		content_element_: function(name, instance, type, size, f) {
			var value = instance[name];
			return this.content_element(name, value, type, size, f);
		},
		content_: function(value) {
			this.content(value);
		}
	};

	return {
		define: function(ROOT_ELEM, Writers, Collectors) {
			if(typeof Collectors === "function") {

				// idea for better API: Writer.define("bodeminformatie", root, (writer, instance) => { ... }).write(context);
				var W = {}; W[ROOT_ELEM] = Collectors, root = Writers;
				var C = { collect: (collector, instance, context) => root };

				var writer = this.define(ROOT_ELEM, W, C);
				var write = writer.write;
				writer.write = function(context) {
					return write.apply(this, [ROOT_ELEM, root, context]);
				};
				return writer;
				
				// return js.override(this.define(ROOT_ELEM, W, C), {
				// 	write: function(context) {
				// 		return in
				// 	}
				// }
			}
			return js.mixIn({
				write: function(collector, instance, context) {
					this._root = null;
					this._element = null;
					
					// var start = new Date(), request;
					request = Collectors.collect(collector, instance, context);
					// context.log(String.format("Collected in %d ms", Date.now() - start));

					// start = new Date();
					this.element(ROOT_ELEM, request, Writers[ROOT_ELEM], Writers);
					// context.log(String.format("Generated/written in %d ms", Date.now() - start));
					
					return this._root;
				},
			}, XmlWriter);
		}
	};
	
});