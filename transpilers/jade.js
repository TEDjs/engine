(function() {
    function require(p) {
        var path = require.resolve(p)
          , mod = require.modules[path];
        if (!mod)
            throw new Error('failed to require "' + p + '"');
        return mod.exports || (mod.exports = {},
        mod.call(mod.exports, mod, mod.exports, require.relative(path))),
        mod.exports
    }
    require.modules = {},
    require.resolve = function(path) {
        var orig = path
          , reg = path + ".js"
          , index = path + "/index.js";
        return require.modules[reg] && reg || require.modules[index] && index || orig
    }
    ,
    require.register = function(path, fn) {
        require.modules[path] = fn
    }
    ,
    require.relative = function(parent) {
        return function(p) {
            if ("." != p.charAt(0))
                return require(p);
            var path = parent.split("/")
              , segs = p.split("/");
            path.pop();
            for (var i = 0; i < segs.length; i++) {
                var seg = segs[i];
                ".." == seg ? path.pop() : "." != seg && path.push(seg)
            }
            return require(path.join("/"))
        }
    }
    ,
    require.register("compiler.js", function(module, exports, require) {
        function isConstant(val) {
            if (/^ *("([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'|true|false|null|undefined) *$/i.test(val))
                return !0;
            if (!isNaN(Number(val)))
                return !0;
            var matches;
            return (matches = /^ *\[(.*)\] *$/.exec(val)) ? matches[1].split(",").every(isConstant) : !1
        }
        function escape(html) {
            return String(html).replace(/&(?!\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        }
        var nodes = require("./nodes")
          , filters = require("./filters")
          , doctypes = require("./doctypes")
          , selfClosing = require("./self-closing")
          , runtime = require("./runtime")
          , utils = require("./utils");
        Object.keys || (Object.keys = function(obj) {
            var arr = [];
            for (var key in obj)
                obj.hasOwnProperty(key) && arr.push(key);
            return arr
        }
        ),
        String.prototype.trimLeft || (String.prototype.trimLeft = function() {
            return this.replace(/^\s+/, "")
        }
        );
        var Compiler = module.exports = function Compiler(node, options) {
            this.options = options = options || {},
            this.node = node,
            this.hasCompiledDoctype = !1,
            this.hasCompiledTag = !1,
            this.pp = options.pretty || !1,
            this.debug = !1 !== options.compileDebug,
            this.indents = 0,
            this.parentIndents = 0,
            options.doctype && this.setDoctype(options.doctype)
        }
        ;
        Compiler.prototype = {
            compile: function() {
                return this.buf = ["var interp;"],
                this.pp && this.buf.push("var __indent = [];"),
                this.lastBufferedIdx = -1,
                this.visit(this.node),
                this.buf.join("\n")
            },
            setDoctype: function(name) {
                name = name && name.toLowerCase() || "default",
                this.doctype = doctypes[name] || "<!DOCTYPE " + name + ">",
                this.terse = this.doctype.toLowerCase() == "<!doctype html>",
                this.xml = 0 == this.doctype.indexOf("<?xml")
            },
            buffer: function(str, esc) {
                esc && (str = utils.escape(str)),
                this.lastBufferedIdx == this.buf.length ? (this.lastBuffered += str,
                this.buf[this.lastBufferedIdx - 1] = "buf.push('" + this.lastBuffered + "');") : (this.buf.push("buf.push('" + str + "');"),
                this.lastBuffered = str,
                this.lastBufferedIdx = this.buf.length)
            },
            prettyIndent: function(offset, newline) {
                offset = offset || 0,
                newline = newline ? "\\n" : "",
                this.buffer(newline + Array(this.indents + offset).join("  ")),
                this.parentIndents && this.buf.push("buf.push.apply(buf, __indent);")
            },
            visit: function(node) {
                var debug = this.debug;
                debug && this.buf.push("__jade.unshift({ lineno: " + node.line + ", filename: " + (node.filename ? JSON.stringify(node.filename) : "__jade[0].filename") + " });"),
                !1 === node.debug && this.debug && (this.buf.pop(),
                this.buf.pop()),
                this.visitNode(node),
                debug && this.buf.push("__jade.shift();")
            },
            visitNode: function(node) {
                var name = node.constructor.name || node.constructor.toString().match(/function ([^(\s]+)()/)[1];
                return this["visit" + name](node)
            },
            visitCase: function(node) {
                var _ = this.withinCase;
                this.withinCase = !0,
                this.buf.push("switch (" + node.expr + "){"),
                this.visit(node.block),
                this.buf.push("}"),
                this.withinCase = _
            },
            visitWhen: function(node) {
                "default" == node.expr ? this.buf.push("default:") : this.buf.push("case " + node.expr + ":"),
                this.visit(node.block),
                this.buf.push("  break;")
            },
            visitLiteral: function(node) {
                var str = node.str.replace(/\n/g, "\\\\n");
                this.buffer(str)
            },
            visitBlock: function(block) {
                var len = block.nodes.length
                  , escape = this.escape
                  , pp = this.pp;
                if (this.parentIndents && block.mode) {
                    pp && this.buf.push("__indent.push('" + Array(this.indents + 1).join("  ") + "');"),
                    this.buf.push("block && block();"),
                    pp && this.buf.push("__indent.pop();");
                    return
                }
                pp && len > 1 && !escape && block.nodes[0].isText && block.nodes[1].isText && this.prettyIndent(1, !0);
                for (var i = 0; i < len; ++i)
                    pp && i > 0 && !escape && block.nodes[i].isText && block.nodes[i - 1].isText && this.prettyIndent(1, !1),
                    this.visit(block.nodes[i]),
                    block.nodes[i + 1] && block.nodes[i].isText && block.nodes[i + 1].isText && this.buffer("\\n")
            },
            visitDoctype: function(doctype) {
                doctype && (doctype.val || !this.doctype) && this.setDoctype(doctype.val || "default"),
                this.doctype && this.buffer(this.doctype),
                this.hasCompiledDoctype = !0
            },
            visitMixin: function(mixin) {
                var name = mixin.name.replace(/-/g, "_") + "_mixin"
                  , args = mixin.args || ""
                  , block = mixin.block
                  , attrs = mixin.attrs
                  , pp = this.pp;
                if (mixin.call) {
                    pp && this.buf.push("__indent.push('" + Array(this.indents + 1).join("  ") + "');");
                    if (block || attrs.length) {
                        this.buf.push(name + ".call({");
                        if (block) {
                            this.buf.push("block: function(){"),
                            this.parentIndents++;
                            var _indents = this.indents;
                            this.indents = 0,
                            this.visit(mixin.block),
                            this.indents = _indents,
                            this.parentIndents--,
                            attrs.length ? this.buf.push("},") : this.buf.push("}")
                        }
                        if (attrs.length) {
                            var val = this.attrs(attrs);
                            val.inherits ? this.buf.push("attributes: merge({" + val.buf + "}, attributes), escaped: merge(" + val.escaped + ", escaped, true)") : this.buf.push("attributes: {" + val.buf + "}, escaped: " + val.escaped)
                        }
                        args ? this.buf.push("}, " + args + ");") : this.buf.push("});")
                    } else
                        this.buf.push(name + "(" + args + ");");
                    pp && this.buf.push("__indent.pop();")
                } else
                    this.buf.push("var " + name + " = function(" + args + "){"),
                    this.buf.push("var block = this.block, attributes = this.attributes || {}, escaped = this.escaped || {};"),
                    this.parentIndents++,
                    this.visit(block),
                    this.parentIndents--,
                    this.buf.push("};")
            },
            visitTag: function(tag) {
                this.indents++;
                var name = tag.name
                  , pp = this.pp;
                tag.buffer && (name = "' + (" + name + ") + '"),
                this.hasCompiledTag || (!this.hasCompiledDoctype && "html" == name && this.visitDoctype(),
                this.hasCompiledTag = !0),
                pp && !tag.isInline() && this.prettyIndent(0, !0),
                (~selfClosing.indexOf(name) || tag.selfClosing) && !this.xml ? (this.buffer("<" + name),
                this.visitAttributes(tag.attrs),
                this.terse ? this.buffer(">") : this.buffer("/>")) : (tag.attrs.length ? (this.buffer("<" + name),
                tag.attrs.length && this.visitAttributes(tag.attrs),
                this.buffer(">")) : this.buffer("<" + name + ">"),
                tag.code && this.visitCode(tag.code),
                this.escape = "pre" == tag.name,
                this.visit(tag.block),
                pp && !tag.isInline() && "pre" != tag.name && !tag.canInline() && this.prettyIndent(0, !0),
                this.buffer("</" + name + ">")),
                this.indents--
            },
            visitFilter: function(filter) {
                var fn = filters[filter.name];
                if (!fn)
                    throw filter.isASTFilter ? new Error('unknown ast filter "' + filter.name + ':"') : new Error('unknown filter ":' + filter.name + '"');
                if (filter.isASTFilter)
                    this.buf.push(fn(filter.block, this, filter.attrs));
                else {
                    var text = filter.block.nodes.map(function(node) {
                        return node.val
                    }).join("\n");
                    filter.attrs = filter.attrs || {},
                    filter.attrs.filename = this.options.filename,
                    this.buffer(utils.text(fn(text, filter.attrs)))
                }
            },
            visitText: function(text) {
                text = utils.text(text.val.replace(/\\/g, "_SLASH_")),
                this.escape && (text = escape(text)),
                text = text.replace(/_SLASH_/g, "\\\\"),
                this.buffer(text)
            },
            visitComment: function(comment) {
                if (!comment.buffer)
                    return;
                this.pp && this.prettyIndent(1, !0),
                this.buffer("<!--" + utils.escape(comment.val) + "-->")
            },
            visitBlockComment: function(comment) {
                if (!comment.buffer)
                    return;
                0 == comment.val.trim().indexOf("if") ? (this.buffer("<!--[" + comment.val.trim() + "]>"),
                this.visit(comment.block),
                this.buffer("<![endif]-->")) : (this.buffer("<!--" + comment.val),
                this.visit(comment.block),
                this.buffer("-->"))
            },
            visitCode: function(code) {
                if (code.buffer) {
                    var val = code.val.trimLeft();
                    this.buf.push("var __val__ = " + val),
                    val = 'null == __val__ ? "" : __val__',
                    code.escape && (val = "escape(" + val + ")"),
                    this.buf.push("buf.push(" + val + ");")
                } else
                    this.buf.push(code.val);
                code.block && (code.buffer || this.buf.push("{"),
                this.visit(code.block),
                code.buffer || this.buf.push("}"))
            },
            visitEach: function(each) {
                this.buf.push("// iterate " + each.obj + "\n" + ";(function(){\n" + "  if ('number' == typeof " + each.obj + ".length) {\n"),
                each.alternative && this.buf.push("  if (" + each.obj + ".length) {"),
                this.buf.push("    for (var " + each.key + " = 0, $$l = " + each.obj + ".length; " + each.key + " < $$l; " + each.key + "++) {\n" + "      var " + each.val + " = " + each.obj + "[" + each.key + "];\n"),
                this.visit(each.block),
                this.buf.push("    }\n"),
                each.alternative && (this.buf.push("  } else {"),
                this.visit(each.alternative),
                this.buf.push("  }")),
                this.buf.push("  } else {\n    var $$l = 0;\n    for (var " + each.key + " in " + each.obj + ") {\n" + "      $$l++;" + "      if (" + each.obj + ".hasOwnProperty(" + each.key + ")){" + "      var " + each.val + " = " + each.obj + "[" + each.key + "];\n"),
                this.visit(each.block),
                this.buf.push("      }\n"),
                this.buf.push("    }\n"),
                each.alternative && (this.buf.push("    if ($$l === 0) {"),
                this.visit(each.alternative),
                this.buf.push("    }")),
                this.buf.push("  }\n}).call(this);\n")
            },
            visitAttributes: function(attrs) {
                var val = this.attrs(attrs);
                val.inherits ? this.buf.push("buf.push(attrs(merge({ " + val.buf + " }, attributes), merge(" + val.escaped + ", escaped, true)));") : val.constant ? (eval("var buf={" + val.buf + "};"),
                this.buffer(runtime.attrs(buf, JSON.parse(val.escaped)), !0)) : this.buf.push("buf.push(attrs({ " + val.buf + " }, " + val.escaped + "));")
            },
            attrs: function(attrs) {
                var buf = []
                  , classes = []
                  , escaped = {}
                  , constant = attrs.every(function(attr) {
                    return isConstant(attr.val)
                })
                  , inherits = !1;
                return this.terse && buf.push("terse: true"),
                attrs.forEach(function(attr) {
                    if (attr.name == "attributes")
                        return inherits = !0;
                    escaped[attr.name] = attr.escaped;
                    if (attr.name == "class")
                        classes.push("(" + attr.val + ")");
                    else {
                        var pair = "'" + attr.name + "':(" + attr.val + ")";
                        buf.push(pair)
                    }
                }),
                classes.length && (classes = classes.join(" + ' ' + "),
                buf.push("class: " + classes)),
                {
                    buf: buf.join(", ").replace("class:", '"class":'),
                    escaped: JSON.stringify(escaped),
                    inherits: inherits,
                    constant: constant
                }
            }
        }
    }),
    require.register("doctypes.js", function(module, exports, require) {
        module.exports = {
            5: "<!DOCTYPE html>",
            "default": "<!DOCTYPE html>",
            xml: '<?xml version="1.0" encoding="utf-8" ?>',
            transitional: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
            strict: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
            frameset: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Frameset//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-frameset.dtd">',
            1.1: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
            basic: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML Basic 1.1//EN" "http://www.w3.org/TR/xhtml-basic/xhtml-basic11.dtd">',
            mobile: '<!DOCTYPE html PUBLIC "-//WAPFORUM//DTD XHTML Mobile 1.2//EN" "http://www.openmobilealliance.org/tech/DTD/xhtml-mobile12.dtd">'
        }
    }),
    require.register("filters.js", function(module, exports, require) {
        module.exports = {
            cdata: function(str) {
                return "<![CDATA[\\n" + str + "\\n]]>"
            },
            sass: function(str) {
                str = str.replace(/\\n/g, "\n");
                var sass = require("sass").render(str).replace(/\n/g, "\\n");
                return '<style type="text/css">' + sass + "</style>"
            },
            stylus: function(str, options) {
                var ret;
                str = str.replace(/\\n/g, "\n");
                var stylus = require("stylus");
                return stylus(str, options).render(function(err, css) {
                    if (err)
                        throw err;
                    ret = css.replace(/\n/g, "\\n")
                }),
                '<style type="text/css">' + ret + "</style>"
            },
            less: function(str) {
                var ret;
                return str = str.replace(/\\n/g, "\n"),
                require("less").render(str, function(err, css) {
                    if (err)
                        throw err;
                    ret = '<style type="text/css">' + css.replace(/\n/g, "\\n") + "</style>"
                }),
                ret
            },
            markdown: function(str) {
                var md;
                try {
                    md = require("markdown")
                } catch (err) {
                    try {
                        md = require("discount")
                    } catch (err) {
                        try {
                            md = require("markdown-js")
                        } catch (err) {
                            try {
                                md = require("marked")
                            } catch (err) {
                                throw new Error("Cannot find markdown library, install markdown, discount, or marked.")
                            }
                        }
                    }
                }
                return str = str.replace(/\\n/g, "\n"),
                md.parse(str).replace(/\n/g, "\\n").replace(/'/g, "&#39;")
            },
            coffeescript: function(str) {
                var js = require("coffee-script").compile(str).replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
                return '<script type="text/javascript">\\n' + js + "</script>"
            }
        }
    }),
    require.register("inline-tags.js", function(module, exports, require) {
        module.exports = ["a", "abbr", "acronym", "b", "br", "code", "em", "font", "i", "img", "ins", "kbd", "map", "samp", "small", "span", "strong", "sub", "sup"]
    }),
    require.register("jade.js", function(module, exports, require) {
        function parse(str, options) {
            try {
                var parser = new Parser(str,options.filename,options)
                  , compiler = new (options.compiler || Compiler)(parser.parse(),options)
                  , js = compiler.compile();
                return options.debug && console.error("\nCompiled Function:\n\n[90m%s[0m", js.replace(/^/gm, "  ")),
                "var buf = [];\n" + (options.self ? "var self = locals || {};\n" + js : "with (locals || {}) {\n" + js + "\n}\n") + 'return buf.join("");'
            } catch (err) {
                parser = parser.context(),
                runtime.rethrow(err, parser.filename, parser.lexer.lineno)
            }
        }
        function stripBOM(str) {
            return 65279 == str.charCodeAt(0) ? str.substring(1) : str
        }
        var Parser = require("./parser")
          , Lexer = require("./lexer")
          , Compiler = require("./compiler")
          , runtime = require("./runtime");
        exports.version = "0.27.6",
        exports.selfClosing = require("./self-closing"),
        exports.doctypes = require("./doctypes"),
        exports.filters = require("./filters"),
        exports.utils = require("./utils"),
        exports.Compiler = Compiler,
        exports.Parser = Parser,
        exports.Lexer = Lexer,
        exports.nodes = require("./nodes"),
        exports.runtime = runtime,
        exports.cache = {},
        exports.compile = function(str, options) {
            var options = options || {}, client = options.client, filename = options.filename ? JSON.stringify(options.filename) : "undefined", fn;
            return str = stripBOM(String(str)),
            options.compileDebug !== !1 ? fn = ["var __jade = [{ lineno: 1, filename: " + filename + " }];", "try {", parse(str, options), "} catch (err) {", "  rethrow(err, __jade[0].filename, __jade[0].lineno);", "}"].join("\n") : fn = parse(str, options),
            client && (fn = "attrs = attrs || jade.attrs; escape = escape || jade.escape; rethrow = rethrow || jade.rethrow; merge = merge || jade.merge;\n" + fn),
            fn = new Function("locals, attrs, escape, rethrow, merge",fn),
            client ? fn : function(locals) {
                return fn(locals, runtime.attrs, runtime.escape, runtime.rethrow, runtime.merge)
            }
        }
        ,
        exports.render = function(str, options, fn) {
            "function" == typeof options && (fn = options,
            options = {});
            if (options.cache && !options.filename)
                return fn(new Error('the "filename" option is required for caching'));
            try {
                var path = options.filename
                  , tmpl = options.cache ? exports.cache[path] || (exports.cache[path] = exports.compile(str, options)) : exports.compile(str, options);
                fn(null, tmpl(options))
            } catch (err) {
                fn(err)
            }
        }
        ,
        exports.renderFile = function(path, options, fn) {
            var key = path + ":string";
            "function" == typeof options && (fn = options,
            options = {});
            try {
                options.filename = path;
                var str = options.cache ? exports.cache[key] || (exports.cache[key] = fs.readFileSync(path, "utf8")) : fs.readFileSync(path, "utf8");
                exports.render(str, options, fn)
            } catch (err) {
                fn(err)
            }
        }
        ,
        exports.__express = exports.renderFile
    }),
    require.register("lexer.js", function(module, exports, require) {
        var utils = require("./utils")
          , Lexer = module.exports = function Lexer(str, options) {
            options = options || {},
            this.input = str.replace(/\r\n|\r/g, "\n"),
            this.colons = options.colons,
            this.deferredTokens = [],
            this.lastIndents = 0,
            this.lineno = 1,
            this.stash = [],
            this.indentStack = [],
            this.indentRe = null,
            this.pipeless = !1
        }
        ;
        Lexer.prototype = {
            tok: function(type, val) {
                return {
                    type: type,
                    line: this.lineno,
                    val: val
                }
            },
            consume: function(len) {
                this.input = this.input.substr(len)
            },
            scan: function(regexp, type) {
                var captures;
                if (captures = regexp.exec(this.input))
                    return this.consume(captures[0].length),
                    this.tok(type, captures[1])
            },
            defer: function(tok) {
                this.deferredTokens.push(tok)
            },
            lookahead: function(n) {
                var fetch = n - this.stash.length;
                while (fetch-- > 0)
                    this.stash.push(this.next());
                return this.stash[--n]
            },
            indexOfDelimiters: function(start, end) {
                var str = this.input
                  , nstart = 0
                  , nend = 0
                  , pos = 0;
                for (var i = 0, len = str.length; i < len; ++i)
                    if (start == str.charAt(i))
                        ++nstart;
                    else if (end == str.charAt(i) && ++nend == nstart) {
                        pos = i;
                        break
                    }
                return pos
            },
            stashed: function() {
                return this.stash.length && this.stash.shift()
            },
            deferred: function() {
                return this.deferredTokens.length && this.deferredTokens.shift()
            },
            eos: function() {
                if (this.input.length)
                    return;
                return this.indentStack.length ? (this.indentStack.shift(),
                this.tok("outdent")) : this.tok("eos")
            },
            blank: function() {
                var captures;
                if (captures = /^\n *\n/.exec(this.input))
                    return this.consume(captures[0].length - 1),
                    ++this.lineno,
                    this.pipeless ? this.tok("text", "") : this.next()
            },
            comment: function() {
                var captures;
                if (captures = /^ *\/\/(-)?([^\n]*)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var tok = this.tok("comment", captures[2]);
                    return tok.buffer = "-" != captures[1],
                    tok
                }
            },
            interpolation: function() {
                var captures;
                if (captures = /^#\{(.*?)\}/.exec(this.input))
                    return this.consume(captures[0].length),
                    this.tok("interpolation", captures[1])
            },
            tag: function() {
                var captures;
                if (captures = /^(\w[-:\w]*)(\/?)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var tok, name = captures[1];
                    if (":" == name[name.length - 1]) {
                        name = name.slice(0, -1),
                        tok = this.tok("tag", name),
                        this.defer(this.tok(":"));
                        while (" " == this.input[0])
                            this.input = this.input.substr(1)
                    } else
                        tok = this.tok("tag", name);
                    return tok.selfClosing = !!captures[2],
                    tok
                }
            },
            filter: function() {
                return this.scan(/^:(\w+)/, "filter")
            },
            doctype: function() {
                return this.scan(/^(?:!!!|doctype) *([^\n]+)?/, "doctype")
            },
            id: function() {
                return this.scan(/^#([\w-]+)/, "id")
            },
            className: function() {
                return this.scan(/^\.([\w-]+)/, "class")
            },
            text: function() {
                return this.scan(/^(?:\| ?| ?)?([^\n]+)/, "text")
            },
            "extends": function() {
                return this.scan(/^extends? +([^\n]+)/, "extends")
            },
            prepend: function() {
                var captures;
                if (captures = /^prepend +([^\n]+)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var mode = "prepend"
                      , name = captures[1]
                      , tok = this.tok("block", name);
                    return tok.mode = mode,
                    tok
                }
            },
            append: function() {
                var captures;
                if (captures = /^append +([^\n]+)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var mode = "append"
                      , name = captures[1]
                      , tok = this.tok("block", name);
                    return tok.mode = mode,
                    tok
                }
            },
            block: function() {
                var captures;
                if (captures = /^block\b *(?:(prepend|append) +)?([^\n]*)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var mode = captures[1] || "replace"
                      , name = captures[2]
                      , tok = this.tok("block", name);
                    return tok.mode = mode,
                    tok
                }
            },
            yield: function() {
                return this.scan(/^yield */, "yield")
            },
            include: function() {
                return this.scan(/^include +([^\n]+)/, "include")
            },
            "case": function() {
                return this.scan(/^case +([^\n]+)/, "case")
            },
            when: function() {
                return this.scan(/^when +([^:\n]+)/, "when")
            },
            "default": function() {
                return this.scan(/^default */, "default")
            },
            assignment: function() {
                var captures;
                if (captures = /^(\w+) += *([^;\n]+)( *;? *)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var name = captures[1]
                      , val = captures[2];
                    return this.tok("code", "var " + name + " = (" + val + ");")
                }
            },
            call: function() {
                var captures;
                if (captures = /^\+([-\w]+)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var tok = this.tok("call", captures[1]);
                    if (captures = /^ *\((.*?)\)/.exec(this.input))
                        /^ *[-\w]+ *=/.test(captures[1]) || (this.consume(captures[0].length),
                        tok.args = captures[1]);
                    return tok
                }
            },
            mixin: function() {
                var captures;
                if (captures = /^mixin +([-\w]+)(?: *\((.*)\))?/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var tok = this.tok("mixin", captures[1]);
                    return tok.args = captures[2],
                    tok
                }
            },
            conditional: function() {
                var captures;
                if (captures = /^(if|unless|else if|else)\b([^\n]*)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var type = captures[1]
                      , js = captures[2];
                    switch (type) {
                    case "if":
                        js = "if (" + js + ")";
                        break;
                    case "unless":
                        js = "if (!(" + js + "))";
                        break;
                    case "else if":
                        js = "else if (" + js + ")";
                        break;
                    case "else":
                        js = "else"
                    }
                    return this.tok("code", js)
                }
            },
            "while": function() {
                var captures;
                if (captures = /^while +([^\n]+)/.exec(this.input))
                    return this.consume(captures[0].length),
                    this.tok("code", "while (" + captures[1] + ")")
            },
            each: function() {
                var captures;
                if (captures = /^(?:- *)?(?:each|for) +(\w+)(?: *, *(\w+))? * in *([^\n]+)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var tok = this.tok("each", captures[1]);
                    return tok.key = captures[2] || "$index",
                    tok.code = captures[3],
                    tok
                }
            },
            code: function() {
                var captures;
                if (captures = /^(!?=|-)([^\n]+)/.exec(this.input)) {
                    this.consume(captures[0].length);
                    var flags = captures[1];
                    captures[1] = captures[2];
                    var tok = this.tok("code", captures[1]);
                    return tok.escape = flags.charAt(0) === "=",
                    tok.buffer = flags.charAt(0) === "=" || flags.charAt(1) === "=",
                    tok
                }
            },
            attrs: function() {
                if ("(" == this.input.charAt(0)) {
                    var index = this.indexOfDelimiters("(", ")"), str = this.input.substr(1, index - 1), tok = this.tok("attrs"), len = str.length, colons = this.colons, states = ["key"], escapedAttr, key = "", val = "", quote, c, p;
                    function state() {
                        return states[states.length - 1]
                    }
                    function interpolate(attr) {
                        return attr.replace(/(\\)?#\{([^}]+)\}/g, function(_, escape, expr) {
                            return escape ? _ : quote + " + (" + expr + ") + " + quote
                        })
                    }
                    this.consume(index + 1),
                    tok.attrs = {},
                    tok.escaped = {};
                    function parse(c) {
                        var real = c;
                        colons && ":" == c && (c = "=");
                        switch (c) {
                        case ",":
                        case "\n":
                            switch (state()) {
                            case "expr":
                            case "array":
                            case "string":
                            case "object":
                                val += c;
                                break;
                            default:
                                states.push("key"),
                                val = val.trim(),
                                key = key.trim();
                                if ("" == key)
                                    return;
                                key = key.replace(/^['"]|['"]$/g, "").replace("!", ""),
                                tok.escaped[key] = escapedAttr,
                                tok.attrs[key] = "" == val ? !0 : interpolate(val),
                                key = val = ""
                            }
                            break;
                        case "=":
                            switch (state()) {
                            case "key char":
                                key += real;
                                break;
                            case "val":
                            case "expr":
                            case "array":
                            case "string":
                            case "object":
                                val += real;
                                break;
                            default:
                                escapedAttr = "!" != p,
                                states.push("val")
                            }
                            break;
                        case "(":
                            ("val" == state() || "expr" == state()) && states.push("expr"),
                            val += c;
                            break;
                        case ")":
                            ("expr" == state() || "val" == state()) && states.pop(),
                            val += c;
                            break;
                        case "{":
                            "val" == state() && states.push("object"),
                            val += c;
                            break;
                        case "}":
                            "object" == state() && states.pop(),
                            val += c;
                            break;
                        case "[":
                            "val" == state() && states.push("array"),
                            val += c;
                            break;
                        case "]":
                            "array" == state() && states.pop(),
                            val += c;
                            break;
                        case '"':
                        case "'":
                            switch (state()) {
                            case "key":
                                states.push("key char");
                                break;
                            case "key char":
                                states.pop();
                                break;
                            case "string":
                                c == quote && states.pop(),
                                val += c;
                                break;
                            default:
                                states.push("string"),
                                val += c,
                                quote = c
                            }
                            break;
                        case "":
                            break;
                        default:
                            switch (state()) {
                            case "key":
                            case "key char":
                                key += c;
                                break;
                            default:
                                val += c
                            }
                        }
                        p = c
                    }
                    for (var i = 0; i < len; ++i)
                        parse(str.charAt(i));
                    return parse(","),
                    "/" == this.input.charAt(0) && (this.consume(1),
                    tok.selfClosing = !0),
                    tok
                }
            },
            indent: function() {
                var captures, re;
                this.indentRe ? captures = this.indentRe.exec(this.input) : (re = /^\n(\t*) */,
                captures = re.exec(this.input),
                captures && !captures[1].length && (re = /^\n( *)/,
                captures = re.exec(this.input)),
                captures && captures[1].length && (this.indentRe = re));
                if (captures) {
                    var tok, indents = captures[1].length;
                    ++this.lineno,
                    this.consume(indents + 1);
                    if (" " == this.input[0] || "  " == this.input[0])
                        throw new Error("Invalid indentation, you can use tabs or spaces but not both");
                    if ("\n" == this.input[0])
                        return this.tok("newline");
                    if (this.indentStack.length && indents < this.indentStack[0]) {
                        while (this.indentStack.length && this.indentStack[0] > indents)
                            this.stash.push(this.tok("outdent")),
                            this.indentStack.shift();
                        tok = this.stash.pop()
                    } else
                        indents && indents != this.indentStack[0] ? (this.indentStack.unshift(indents),
                        tok = this.tok("indent", indents)) : tok = this.tok("newline");
                    return tok
                }
            },
            pipelessText: function() {
                if (this.pipeless) {
                    if ("\n" == this.input[0])
                        return;
                    var i = this.input.indexOf("\n");
                    -1 == i && (i = this.input.length);
                    var str = this.input.substr(0, i);
                    return this.consume(str.length),
                    this.tok("text", str)
                }
            },
            colon: function() {
                return this.scan(/^: */, ":")
            },
            advance: function() {
                return this.stashed() || this.next()
            },
            next: function() {
                return this.deferred() || this.blank() || this.eos() || this.pipelessText() || this.yield() || this.doctype() || this.interpolation() || this["case"]() || this.when() || this["default"]() || this["extends"]() || this.append() || this.prepend() || this.block() || this.include() || this.mixin() || this.call() || this.conditional() || this.each() || this["while"]() || this.assignment() || this.tag() || this.filter() || this.code() || this.id() || this.className() || this.attrs() || this.indent() || this.comment() || this.colon() || this.text()
            }
        }
    }),
    require.register("nodes/attrs.js", function(module, exports, require) {
        var Node = require("./node")
          , Block = require("./block")
          , Attrs = module.exports = function Attrs() {
            this.attrs = []
        }
        ;
        Attrs.prototype = new Node,
        Attrs.prototype.constructor = Attrs,
        Attrs.prototype.setAttribute = function(name, val, escaped) {
            return this.attrs.push({
                name: name,
                val: val,
                escaped: escaped
            }),
            this
        }
        ,
        Attrs.prototype.removeAttribute = function(name) {
            for (var i = 0, len = this.attrs.length; i < len; ++i)
                this.attrs[i] && this.attrs[i].name == name && delete this.attrs[i]
        }
        ,
        Attrs.prototype.getAttribute = function(name) {
            for (var i = 0, len = this.attrs.length; i < len; ++i)
                if (this.attrs[i] && this.attrs[i].name == name)
                    return this.attrs[i].val
        }
    }),
    require.register("nodes/block-comment.js", function(module, exports, require) {
        var Node = require("./node")
          , BlockComment = module.exports = function BlockComment(val, block, buffer) {
            this.block = block,
            this.val = val,
            this.buffer = buffer
        }
        ;
        BlockComment.prototype = new Node,
        BlockComment.prototype.constructor = BlockComment
    }),
    require.register("nodes/block.js", function(module, exports, require) {
        var Node = require("./node")
          , Block = module.exports = function Block(node) {
            this.nodes = [],
            node && this.push(node)
        }
        ;
        Block.prototype = new Node,
        Block.prototype.constructor = Block,
        Block.prototype.isBlock = !0,
        Block.prototype.replace = function(other) {
            other.nodes = this.nodes
        }
        ,
        Block.prototype.push = function(node) {
            return this.nodes.push(node)
        }
        ,
        Block.prototype.isEmpty = function() {
            return 0 == this.nodes.length
        }
        ,
        Block.prototype.unshift = function(node) {
            return this.nodes.unshift(node)
        }
        ,
        Block.prototype.includeBlock = function() {
            var ret = this, node;
            for (var i = 0, len = this.nodes.length; i < len; ++i) {
                node = this.nodes[i];
                if (node.yield)
                    return node;
                if (node.textOnly)
                    continue;
                node.includeBlock ? ret = node.includeBlock() : node.block && !node.block.isEmpty() && (ret = node.block.includeBlock());
                if (ret.yield)
                    return ret
            }
            return ret
        }
        ,
        Block.prototype.clone = function() {
            var clone = new Block;
            for (var i = 0, len = this.nodes.length; i < len; ++i)
                clone.push(this.nodes[i].clone());
            return clone
        }
    }),
    require.register("nodes/case.js", function(module, exports, require) {
        var Node = require("./node")
          , Case = exports = module.exports = function Case(expr, block) {
            this.expr = expr,
            this.block = block
        }
        ;
        Case.prototype = new Node,
        Case.prototype.constructor = Case;
        var When = exports.When = function When(expr, block) {
            this.expr = expr,
            this.block = block,
            this.debug = !1
        }
        ;
        When.prototype = new Node,
        When.prototype.constructor = When
    }),
    require.register("nodes/code.js", function(module, exports, require) {
        var Node = require("./node")
          , Code = module.exports = function Code(val, buffer, escape) {
            this.val = val,
            this.buffer = buffer,
            this.escape = escape,
            val.match(/^ *else/) && (this.debug = !1)
        }
        ;
        Code.prototype = new Node,
        Code.prototype.constructor = Code
    }),
    require.register("nodes/comment.js", function(module, exports, require) {
        var Node = require("./node")
          , Comment = module.exports = function Comment(val, buffer) {
            this.val = val,
            this.buffer = buffer
        }
        ;
        Comment.prototype = new Node,
        Comment.prototype.constructor = Comment
    }),
    require.register("nodes/doctype.js", function(module, exports, require) {
        var Node = require("./node")
          , Doctype = module.exports = function Doctype(val) {
            this.val = val
        }
        ;
        Doctype.prototype = new Node,
        Doctype.prototype.constructor = Doctype
    }),
    require.register("nodes/each.js", function(module, exports, require) {
        var Node = require("./node")
          , Each = module.exports = function Each(obj, val, key, block) {
            this.obj = obj,
            this.val = val,
            this.key = key,
            this.block = block
        }
        ;
        Each.prototype = new Node,
        Each.prototype.constructor = Each
    }),
    require.register("nodes/filter.js", function(module, exports, require) {
        var Node = require("./node")
          , Block = require("./block")
          , Filter = module.exports = function Filter(name, block, attrs) {
            this.name = name,
            this.block = block,
            this.attrs = attrs,
            this.isASTFilter = !block.nodes.every(function(node) {
                return node.isText
            })
        }
        ;
        Filter.prototype = new Node,
        Filter.prototype.constructor = Filter
    }),
    require.register("nodes/index.js", function(module, exports, require) {
        exports.Node = require("./node"),
        exports.Tag = require("./tag"),
        exports.Code = require("./code"),
        exports.Each = require("./each"),
        exports.Case = require("./case"),
        exports.Text = require("./text"),
        exports.Block = require("./block"),
        exports.Mixin = require("./mixin"),
        exports.Filter = require("./filter"),
        exports.Comment = require("./comment"),
        exports.Literal = require("./literal"),
        exports.BlockComment = require("./block-comment"),
        exports.Doctype = require("./doctype")
    }),
    require.register("nodes/literal.js", function(module, exports, require) {
        var Node = require("./node")
          , Literal = module.exports = function Literal(str) {
            this.str = str.replace(/\\/g, "\\\\").replace(/\n|\r\n/g, "\\n").replace(/'/g, "\\'")
        }
        ;
        Literal.prototype = new Node,
        Literal.prototype.constructor = Literal
    }),
    require.register("nodes/mixin.js", function(module, exports, require) {
        var Attrs = require("./attrs")
          , Mixin = module.exports = function Mixin(name, args, block, call) {
            this.name = name,
            this.args = args,
            this.block = block,
            this.attrs = [],
            this.call = call
        }
        ;
        Mixin.prototype = new Attrs,
        Mixin.prototype.constructor = Mixin
    }),
    require.register("nodes/node.js", function(module, exports, require) {
        var Node = module.exports = function Node() {}
        ;
        Node.prototype.clone = function() {
            return this
        }
    }),
    require.register("nodes/tag.js", function(module, exports, require) {
        var Attrs = require("./attrs")
          , Block = require("./block")
          , inlineTags = require("../inline-tags")
          , Tag = module.exports = function Tag(name, block) {
            this.name = name,
            this.attrs = [],
            this.block = block || new Block
        }
        ;
        Tag.prototype = new Attrs,
        Tag.prototype.constructor = Tag,
        Tag.prototype.clone = function() {
            var clone = new Tag(this.name,this.block.clone());
            return clone.line = this.line,
            clone.attrs = this.attrs,
            clone.textOnly = this.textOnly,
            clone
        }
        ,
        Tag.prototype.isInline = function() {
            return ~inlineTags.indexOf(this.name)
        }
        ,
        Tag.prototype.canInline = function() {
            function isInline(node) {
                return node.isBlock ? node.nodes.every(isInline) : node.isText || node.isInline && node.isInline()
            }
            var nodes = this.block.nodes;
            if (!nodes.length)
                return !0;
            if (1 == nodes.length)
                return isInline(nodes[0]);
            if (this.block.nodes.every(isInline)) {
                for (var i = 1, len = nodes.length; i < len; ++i)
                    if (nodes[i - 1].isText && nodes[i].isText)
                        return !1;
                return !0
            }
            return !1
        }
    }),
    require.register("nodes/text.js", function(module, exports, require) {
        var Node = require("./node")
          , Text = module.exports = function Text(line) {
            this.val = "",
            "string" == typeof line && (this.val = line)
        }
        ;
        Text.prototype = new Node,
        Text.prototype.constructor = Text,
        Text.prototype.isText = !0
    }),
    require.register("parser.js", function(module, exports, require) {
        var Lexer = require("./lexer")
          , nodes = require("./nodes")
          , utils = require("./utils")
          , Parser = exports = module.exports = function Parser(str, filename, options) {
            this.input = str,
            this.lexer = new Lexer(str,options),
            this.filename = filename,
            this.blocks = {},
            this.mixins = {},
            this.options = options,
            this.contexts = [this]
        }
          , textOnly = exports.textOnly = ["script", "style"];
        Parser.prototype = {
            context: function(parser) {
                if (!parser)
                    return this.contexts.pop();
                this.contexts.push(parser)
            },
            advance: function() {
                return this.lexer.advance()
            },
            skip: function(n) {
                while (n--)
                    this.advance()
            },
            peek: function() {
                return this.lookahead(1)
            },
            line: function() {
                return this.lexer.lineno
            },
            lookahead: function(n) {
                return this.lexer.lookahead(n)
            },
            parse: function() {
                var block = new nodes.Block, parser;
                block.line = this.line();
                while ("eos" != this.peek().type)
                    "newline" == this.peek().type ? this.advance() : block.push(this.parseExpr());
                if (parser = this.extending) {
                    this.context(parser);
                    var ast = parser.parse();
                    this.context();
                    for (var name in this.mixins)
                        ast.unshift(this.mixins[name]);
                    return ast
                }
                return block
            },
            expect: function(type) {
                if (this.peek().type === type)
                    return this.advance();
                throw new Error('expected "' + type + '", but got "' + this.peek().type + '"')
            },
            accept: function(type) {
                if (this.peek().type === type)
                    return this.advance()
            },
            parseExpr: function() {
                switch (this.peek().type) {
                case "tag":
                    return this.parseTag();
                case "mixin":
                    return this.parseMixin();
                case "block":
                    return this.parseBlock();
                case "case":
                    return this.parseCase();
                case "when":
                    return this.parseWhen();
                case "default":
                    return this.parseDefault();
                case "extends":
                    return this.parseExtends();
                case "include":
                    return this.parseInclude();
                case "doctype":
                    return this.parseDoctype();
                case "filter":
                    return this.parseFilter();
                case "comment":
                    return this.parseComment();
                case "text":
                    return this.parseText();
                case "each":
                    return this.parseEach();
                case "code":
                    return this.parseCode();
                case "call":
                    return this.parseCall();
                case "interpolation":
                    return this.parseInterpolation();
                case "yield":
                    this.advance();
                    var block = new nodes.Block;
                    return block.yield = !0,
                    block;
                case "id":
                case "class":
                    var tok = this.advance();
                    return this.lexer.defer(this.lexer.tok("tag", "div")),
                    this.lexer.defer(tok),
                    this.parseExpr();
                default:
                    throw new Error('unexpected token "' + this.peek().type + '"')
                }
            },
            parseText: function() {
                var tok = this.expect("text")
                  , node = new nodes.Text(tok.val);
                return node.line = this.line(),
                node
            },
            parseBlockExpansion: function() {
                return ":" == this.peek().type ? (this.advance(),
                new nodes.Block(this.parseExpr())) : this.block()
            },
            parseCase: function() {
                var val = this.expect("case").val
                  , node = new nodes.Case(val);
                return node.line = this.line(),
                node.block = this.block(),
                node
            },
            parseWhen: function() {
                var val = this.expect("when").val;
                return new nodes.Case.When(val,this.parseBlockExpansion())
            },
            parseDefault: function() {
                return this.expect("default"),
                new nodes.Case.When("default",this.parseBlockExpansion())
            },
            parseCode: function() {
                var tok = this.expect("code"), node = new nodes.Code(tok.val,tok.buffer,tok.escape), block, i = 1;
                node.line = this.line();
                while (this.lookahead(i) && "newline" == this.lookahead(i).type)
                    ++i;
                return block = "indent" == this.lookahead(i).type,
                block && (this.skip(i - 1),
                node.block = this.block()),
                node
            },
            parseComment: function() {
                var tok = this.expect("comment"), node;
                return "indent" == this.peek().type ? node = new nodes.BlockComment(tok.val,this.block(),tok.buffer) : node = new nodes.Comment(tok.val,tok.buffer),
                node.line = this.line(),
                node
            },
            parseDoctype: function() {
                var tok = this.expect("doctype")
                  , node = new nodes.Doctype(tok.val);
                return node.line = this.line(),
                node
            },
            parseFilter: function() {
                var block, tok = this.expect("filter"), attrs = this.accept("attrs");
                this.lexer.pipeless = !0,
                block = this.parseTextBlock(),
                this.lexer.pipeless = !1;
                var node = new nodes.Filter(tok.val,block,attrs && attrs.attrs);
                return node.line = this.line(),
                node
            },
            parseASTFilter: function() {
                var block, tok = this.expect("tag"), attrs = this.accept("attrs");
                this.expect(":"),
                block = this.block();
                var node = new nodes.Filter(tok.val,block,attrs && attrs.attrs);
                return node.line = this.line(),
                node
            },
            parseEach: function() {
                var tok = this.expect("each")
                  , node = new nodes.Each(tok.code,tok.val,tok.key);
                return node.line = this.line(),
                node.block = this.block(),
                this.peek().type == "code" && this.peek().val == "else" && (this.advance(),
                node.alternative = this.block()),
                node
            },
            parseExtends: function() {
                var path = require("path")
                  , fs = require("fs")
                  , dirname = path.dirname
                  , basename = path.basename
                  , join = path.join;
                if (!this.filename)
                    throw new Error('the "filename" option is required to extend templates');
                var path = this.expect("extends").val.trim()
                  , dir = dirname(this.filename)
                  , path = join(dir, path + ".jade")
                  , str = fs.readFileSync(path, "utf8")
                  , parser = new Parser(str,path,this.options);
                return parser.blocks = this.blocks,
                parser.contexts = this.contexts,
                this.extending = parser,
                new nodes.Literal("")
            },
            parseBlock: function() {
                var block = this.expect("block")
                  , mode = block.mode
                  , name = block.val.trim();
                block = "indent" == this.peek().type ? this.block() : new nodes.Block(new nodes.Literal(""));
                var prev = this.blocks[name];
                if (prev)
                    switch (prev.mode) {
                    case "append":
                        block.nodes = block.nodes.concat(prev.nodes),
                        prev = block;
                        break;
                    case "prepend":
                        block.nodes = prev.nodes.concat(block.nodes),
                        prev = block
                    }
                return block.mode = mode,
                this.blocks[name] = prev || block
            },
            parseInclude: function() {
                var path = require("path")
                  , fs = require("fs")
                  , dirname = path.dirname
                  , basename = path.basename
                  , join = path.join
                  , path = this.expect("include").val.trim()
                  , dir = dirname(this.filename);
                if (!this.filename)
                    throw new Error('the "filename" option is required to use includes');
                ~basename(path).indexOf(".") || (path += ".jade");
                if (".jade" != path.substr(-5)) {
                    var path = join(dir, path)
                      , str = fs.readFileSync(path, "utf8");
                    return new nodes.Literal(str)
                }
                var path = join(dir, path)
                  , str = fs.readFileSync(path, "utf8")
                  , parser = new Parser(str,path,this.options);
                parser.blocks = utils.merge({}, this.blocks),
                parser.mixins = this.mixins,
                this.context(parser);
                var ast = parser.parse();
                return this.context(),
                ast.filename = path,
                "indent" == this.peek().type && ast.includeBlock().push(this.block()),
                ast
            },
            parseCall: function() {
                var tok = this.expect("call")
                  , name = tok.val
                  , args = tok.args
                  , mixin = new nodes.Mixin(name,args,new nodes.Block,!0);
                return this.tag(mixin),
                mixin.block.isEmpty() && (mixin.block = null),
                mixin
            },
            parseMixin: function() {
                var tok = this.expect("mixin"), name = tok.val, args = tok.args, mixin;
                return "indent" == this.peek().type ? (mixin = new nodes.Mixin(name,args,this.block(),!1),
                this.mixins[name] = mixin,
                mixin) : new nodes.Mixin(name,args,null,!0)
            },
            parseTextBlock: function() {
                var block = new nodes.Block;
                block.line = this.line();
                var spaces = this.expect("indent").val;
                null == this._spaces && (this._spaces = spaces);
                var indent = Array(spaces - this._spaces + 1).join(" ");
                while ("outdent" != this.peek().type)
                    switch (this.peek().type) {
                    case "newline":
                        this.advance();
                        break;
                    case "indent":
                        this.parseTextBlock().nodes.forEach(function(node) {
                            block.push(node)
                        });
                        break;
                    default:
                        var text = new nodes.Text(indent + this.advance().val);
                        text.line = this.line(),
                        block.push(text)
                    }
                return spaces == this._spaces && (this._spaces = null),
                this.expect("outdent"),
                block
            },
            block: function() {
                var block = new nodes.Block;
                block.line = this.line(),
                this.expect("indent");
                while ("outdent" != this.peek().type)
                    "newline" == this.peek().type ? this.advance() : block.push(this.parseExpr());
                return this.expect("outdent"),
                block
            },
            parseInterpolation: function() {
                var tok = this.advance()
                  , tag = new nodes.Tag(tok.val);
                return tag.buffer = !0,
                this.tag(tag)
            },
            parseTag: function() {
                var i = 2;
                "attrs" == this.lookahead(i).type && ++i;
                if (":" == this.lookahead(i).type && "indent" == this.lookahead(++i).type)
                    return this.parseASTFilter();
                var tok = this.advance()
                  , tag = new nodes.Tag(tok.val);
                return tag.selfClosing = tok.selfClosing,
                this.tag(tag)
            },
            tag: function(tag) {
                var dot;
                tag.line = this.line();
                e: for (; ; )
                    switch (this.peek().type) {
                    case "id":
                    case "class":
                        var tok = this.advance();
                        tag.setAttribute(tok.type, "'" + tok.val + "'");
                        continue;
                    case "attrs":
                        var tok = this.advance()
                          , obj = tok.attrs
                          , escaped = tok.escaped
                          , names = Object.keys(obj);
                        tok.selfClosing && (tag.selfClosing = !0);
                        for (var i = 0, len = names.length; i < len; ++i) {
                            var name = names[i]
                              , val = obj[name];
                            tag.setAttribute(name, val, escaped[name])
                        }
                        continue;
                    default:
                        break e
                    }
                "." == this.peek().val && (dot = tag.textOnly = !0,
                this.advance());
                switch (this.peek().type) {
                case "text":
                    tag.block.push(this.parseText());
                    break;
                case "code":
                    tag.code = this.parseCode();
                    break;
                case ":":
                    this.advance(),
                    tag.block = new nodes.Block,
                    tag.block.push(this.parseExpr())
                }
                while ("newline" == this.peek().type)
                    this.advance();
                tag.textOnly = tag.textOnly || ~textOnly.indexOf(tag.name);
                if ("script" == tag.name) {
                    var type = tag.getAttribute("type");
                    !dot && type && "text/javascript" != type.replace(/^['"]|['"]$/g, "") && (tag.textOnly = !1)
                }
                if ("indent" == this.peek().type)
                    if (tag.textOnly)
                        this.lexer.pipeless = !0,
                        tag.block = this.parseTextBlock(),
                        this.lexer.pipeless = !1;
                    else {
                        var block = this.block();
                        if (tag.block)
                            for (var i = 0, len = block.nodes.length; i < len; ++i)
                                tag.block.push(block.nodes[i]);
                        else
                            tag.block = block
                    }
                return tag
            }
        }
    }),
    require.register("runtime.js", function(module, exports, require) {
        function nulls(val) {
            return val != null
        }
        Array.isArray || (Array.isArray = function(arr) {
            return "[object Array]" == Object.prototype.toString.call(arr)
        }
        ),
        Object.keys || (Object.keys = function(obj) {
            var arr = [];
            for (var key in obj)
                obj.hasOwnProperty(key) && arr.push(key);
            return arr
        }
        ),
        exports.merge = function merge(a, b) {
            var ac = a["class"]
              , bc = b["class"];
            if (ac || bc)
                ac = ac || [],
                bc = bc || [],
                Array.isArray(ac) || (ac = [ac]),
                Array.isArray(bc) || (bc = [bc]),
                ac = ac.filter(nulls),
                bc = bc.filter(nulls),
                a["class"] = ac.concat(bc).join(" ");
            for (var key in b)
                key != "class" && (a[key] = b[key]);
            return a
        }
        ,
        exports.attrs = function attrs(obj, escaped) {
            var buf = []
              , terse = obj.terse;
            delete obj.terse;
            var keys = Object.keys(obj)
              , len = keys.length;
            if (len) {
                buf.push("");
                for (var i = 0; i < len; ++i) {
                    var key = keys[i]
                      , val = obj[key];
                    "boolean" == typeof val || null == val ? val && (terse ? buf.push(key) : buf.push(key + '="' + key + '"')) : 0 == key.indexOf("data") && "string" != typeof val ? buf.push(key + "='" + JSON.stringify(val) + "'") : "class" == key && Array.isArray(val) ? buf.push(key + '="' + exports.escape(val.join(" ")) + '"') : escaped && escaped[key] ? buf.push(key + '="' + exports.escape(val) + '"') : buf.push(key + '="' + val + '"')
                }
            }
            return buf.join(" ")
        }
        ,
        exports.escape = function escape(html) {
            return String(html).replace(/&(?!(\w+|\#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        }
        ,
        exports.rethrow = function rethrow(err, filename, lineno) {
            if (!filename)
                throw err;
            var context = 3
              , str = require("fs").readFileSync(filename, "utf8")
              , lines = str.split("\n")
              , start = Math.max(lineno - context, 0)
              , end = Math.min(lines.length, lineno + context)
              , context = lines.slice(start, end).map(function(line, i) {
                var curr = i + start + 1;
                return (curr == lineno ? "  > " : "    ") + curr + "| " + line
            }).join("\n");
            throw err.path = filename,
            err.message = (filename || "Jade") + ":" + lineno + "\n" + context + "\n\n" + err.message,
            err
        }
    }),
    require.register("self-closing.js", function(module, exports, require) {
        module.exports = ["meta", "img", "link", "input", "source", "area", "base", "col", "br", "hr"]
    }),
    require.register("utils.js", function(module, exports, require) {
        var interpolate = exports.interpolate = function(str) {
            return str.replace(/(_SLASH_)?([#!]){(.*?)}/g, function(str, escape, flag, code) {
                return code = code.replace(/\\'/g, "'").replace(/_SLASH_/g, "\\"),
                escape ? str.slice(7) : "' + " + ("!" == flag ? "" : "escape") + "((interp = " + code + ") == null ? '' : interp) + '"
            })
        }
          , escape = exports.escape = function(str) {
            return str.replace(/'/g, "\\'")
        }
        ;
        exports.text = function(str) {
            return interpolate(escape(str))
        }
        ,
        exports.merge = function(a, b) {
            for (var key in b)
                a[key] = b[key];
            return a
        }
    }),
    window.jade = require("jade")
})();
