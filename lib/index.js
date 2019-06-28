const path = require('path')
const hash = require('hash-sum')
const qs = require('querystring')
const plugin = require('./plugin')
const selectBlock = require('./select')
const loaderUtils = require('loader-utils')
const { attrsToQuery } = require('./codegen/utils')
const { parse } = require('@vue/component-compiler-utils')
const genStylesCode = require('./codegen/styleInjection')
const { genHotReloadCode } = require('./codegen/hotReload')
const genCustomBlocksCode = require('./codegen/customBlocks')
const componentNormalizerPath = require.resolve('./runtime/componentNormalizer')
const { NS } = require('./plugin')

let errorEmitted = false

// 加载vue-template-compiler
function loadTemplateCompiler (loaderContext) {
  try {
    return require('vue-template-compiler')
  } catch (e) {
    if (/version mismatch/.test(e.toString())) {
      loaderContext.emitError(e)
    } else {
      loaderContext.emitError(new Error(
        `[vue-loader] vue-template-compiler must be installed as a peer dependency, ` +
        `or a compatible compiler implementation must be passed via options.`
      ))
    }
  }
}

/*
  .vue文件包含template、script、style、customBlock这四部分
  需要不同的loader来解析，所以.vue文件依赖于这四部分的解析结果，
  即这四部分就是.vue文件的依赖。
  所以在请求.vue文件时，会执行vue-loader，然后依赖的这四部分也会分别执行vue-loader。
*/

/*
  对于一个loader来说，输入参数是上一个loader产生的结果或者资源文件，这里其实就是.vue文件，
  因为vue-loader总是第一个被执行的loader（指非pitch阶段）
  （对于本例子，source就是example/source.vue的内容）
*/
module.exports = function (source) {
  /*
    这里this是loader上下文，由webpack提供，里面包含loader可以访问的方法或属性。
    具体的可参考webpack文档：https://webpack.docschina.org/api/loaders/#loader-%E4%B8%8A%E4%B8%8B%E6%96%87
  */
  const loaderContext = this

  /*
    thread-loader: webpack的loader配置中，放置在thread-loader之后的loader会被放入一个单独的worker池中
    这里NS='vue-loader'
    如果webpack配置中含有vue-loader-plugin，webpack加载vue-loader-plugin后会设置loaderContext[NS] = true。
    因此，如果loaderContext[NS] = false，则表明webpack没有配置vue-loader-plugin，
    应该抛出错误。
  */
  if (!errorEmitted && !loaderContext['thread-loader'] && !loaderContext[NS]) {
    loaderContext.emitError(new Error(
      `vue-loader was used without the corresponding plugin. ` +
      `Make sure to include VueLoaderPlugin in your webpack config.`
    ))
    errorEmitted = true
  }

  /*
    这个函数就是把request的路径变成相对于loaderContext.context的相对路径
    eg：
    request=/Users/zhangxixi/knowledge collect/vue-loader/example/source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&
    loaderContext.context在本例子中是：/Users/zhangxixi/knowledge collect/vue-loader/example
    经过stringifyRequest后，变成了：
    ./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&
  */
  const stringifyRequest = r => loaderUtils.stringifyRequest(loaderContext, r)

  const {
    target, // 编译的目标，是从webpack配置中传递过来的，默认是'web'，也可以是'node'等
    request, // module request路径，由path和query组成，eg:
    // path/to/vue-loader/lib/index.js??vue-loader-options!/Users/zhangxixi/knowledge collect/vue-loader/example/source.vue,
    // 上面的路径?vue&type=script&lang=js&
    // 上面的路径?vue&type=custom&index=0&blockType=foo
    minimize, // 是否压缩：true/false，现在已废弃
    sourceMap, // 是否生成sourceMap: true/false
    rootContext, // 项目根路径，eg: path/to/vue-loader
    resourcePath, // module的path，eg: path/to/vue-loader/example/source.vue
    resourceQuery // module的query，也就是问号及后面的，eg: ?vue&type=custom&index=0&blockType=foo
  } = loaderContext

  // 接下来是一系列对于参数和路径的处理
  const rawQuery = resourceQuery.slice(1) // 去掉query的问号，query第一个字符是问号
  // .vue文件的query需要添加到其每个block的query里
  // 因此对于每个block来说，这个添加的query实际上继承自.vue文件，所以叫做继承query
  const inheritQuery = `&${rawQuery}`
  // 将query格式化成对象，eg: vue&type=custom&index=0&blockType=foo 将被转换为
  // { vue: '', type: 'custom', index: '0', blockType: 'foo' }
  const incomingQuery = qs.parse(rawQuery)
  // getOptions这个函数是根据loaderContext.query获取option：
  // 如果loader配置了options对象，则loaderContext.query指向这个options对象；
  // 如果没有配置options，而是以query字符串作为参数调用时，就是一个以 ? 开头的字符串，是字符串就转成对象返回
  const options = loaderUtils.getOptions(loaderContext) || {}

  const isServer = target === 'node'

  // shadowMode模式下，组件的样式注入地方不同，具体参考https://vue-loader.vuejs.org/zh/options.html#shadowmode
  const isShadow = !!options.shadowMode
  const isProduction = options.productionMode || minimize || process.env.NODE_ENV === 'production'
  const filename = path.basename(resourcePath) // 获取module名字，eg: source.vue
  // 设置上下文，如果rootContext不存在，就取当前程序执行目录
  const context = rootContext || process.cwd()
  // path.relative(context, resourcePath)获取module相对于context的路径;
  // path.dirname获取module的目录名
  const sourceRoot = path.dirname(path.relative(context, resourcePath))
  // 开始解析SFC，其实就是根据不同的 block 来拆解对应的内容
  // parse函数返回的是compiler.parseComponent()的结果
  // 如果没有自定义compiler，compiler对应的就是vue-template-compiler。
  const descriptor = parse({
    source,
    compiler: options.compiler || loadTemplateCompiler(loaderContext),
    filename,
    sourceRoot,
    needMap: sourceMap
  })
  // 本例子descriptor结果：
  /*
  {template:
    { type: 'template',
      content: '\ndiv(ok)\n  h1(:class="$style.red") hello\n',
      start: 21,
      attrs: { lang: 'pug' },
      lang: 'pug',
      end: 62 },
   script:
    { type: 'script',
      content:
       '//\n//\n//\n//\n//\n\nexport default {\n  data () {\n    return {\n      msg: \'fesfff\'\n    }\n  }\n}\n',
      start: 83,
      attrs: {},
      end: 158,
      map:
       { version: 3,
         sources: [Array],
         names: [],
         mappings: ';;;;;;AAMA;AACA;AACA;AACA;AACA;AACA;AACA',
         file: 'source.vue',
         sourceRoot: 'example',
         sourcesContent: [Array] } },
   styles:
    [ { type: 'style',
        content: '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n.red {\n  color: red;\n}\n',
        start: 183,
        attrs: [Object],
        module: true,
        end: 207,
        map: [Object] } ],
   customBlocks:
    [ { type: 'foo',
        content:
         '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nexport default comp => {\n  console.log(comp.options.data())\n}\n',
        start: 222,
        attrs: {},
        end: 285 } ],
   errors: [] }
   */

  // if the query has a type field, this is a language block request
  // e.g. foo.vue?type=template&id=xxxxx
  // and we will return early
  // 如果query有type，说明是.vue文件里的block请求，比如source.vue?type=template，这样就直接返回
  if (incomingQuery.type) {
    return selectBlock(
      descriptor,
      loaderContext,
      incomingQuery,
      !!options.appendExtension
    )
  }

  // module id for scoped CSS & hot-reload
  // replace这个正则是去掉路径前面的 ../，比如: ../example/source.vue将变成example/source.vue
  const rawShortFilePath = path
    .relative(context, resourcePath)
    .replace(/^(\.\.[\/\\])+/, '')

  const shortFilePath = rawShortFilePath.replace(/\\/g, '/') + resourceQuery

  // 生成hash id
  const id = hash(
    isProduction
      ? (shortFilePath + '\n' + source)
      : shortFilePath
  )

  // feature information
  // 是否有scoped styles
  const hasScoped = descriptor.styles.some(s => s.scoped)
  // 是否是函数式组件
  const hasFunctional = descriptor.template && descriptor.template.attrs.functional
  // 是否需要热加载
  const needsHotReload = (
    !isServer &&
    !isProduction &&
    (descriptor.script || descriptor.template) &&
    options.hotReload !== false
  )

  // 接下来分别对不同block的请求进行处理
  // template
  // 处理template，根据descriptor.template，生成template的js module（生成import语句）
  let templateImport = `var render, staticRenderFns`
  let templateRequest
  if (descriptor.template) {
    const src = descriptor.template.src || resourcePath
    const idQuery = `&id=${id}`
    const scopedQuery = hasScoped ? `&scoped=true` : ``

    // 把attrs转成query格式：{lang: pug} => &lang=pug
    const attrsQuery = attrsToQuery(descriptor.template.attrs)
    // 如果css有scope，那么template就需要加上scoped=true，这是why？？
    const query = `?vue&type=template${idQuery}${scopedQuery}${attrsQuery}${inheritQuery}`
    const request = templateRequest = stringifyRequest(src + query)
    // 这个request会经过pug-plain-loader、template-loader
    // 最终template-loader会返回render, staticRenderFns这两个函数
    templateImport = `import { render, staticRenderFns } from ${request}`
  }

  // script
  // 处理script，与template类似
  let scriptImport = `var script = {}`
  if (descriptor.script) {
    const src = descriptor.script.src || resourcePath
    const attrsQuery = attrsToQuery(descriptor.script.attrs, 'js')
    const query = `?vue&type=script${attrsQuery}${inheritQuery}`
    const request = stringifyRequest(src + query)
    /* script不会再经过其他loader处理，所以从request里import的script就是对应的源码，如
      {
        data () {
          return {
            msg: 'fesfff'
          }
        }
      }
    */
    scriptImport = (
      `import script from ${request}\n` +
      `export * from ${request}` // support named exports
    )
  }

  // styles
  // 处理styles
  /*
    genStylesCode做了3件事情:
    1. 生成import语句（这一步与template生成import语句类似）
    2. 如果需要热加载，添加热加载代码
    3.如果需要注入样式，则添加样式注入函数injectStyles
  */
  let stylesCode = ``
  if (descriptor.styles.length) {
    stylesCode = genStylesCode(
      loaderContext,
      descriptor.styles, // vue单文件组件支持多个style标签，故descriptor.styles是数组
      id,
      resourcePath,
      stringifyRequest,
      needsHotReload,
      isServer || isShadow // needs explicit injection?
    )
  }

  // 将由 .vue 提供 render函数/staticRenderFns，js script，style样式，并交由 normalizer 进行统一的格式化，最终导出 component.exports

  // 如果stylesCode里含有injectStyles，则表明是需要注入style的，因此可以使用这个正则来判断：/injectStyles/.test(stylesCode)
  let code = `
${templateImport}
${scriptImport}
${stylesCode}

/* normalize component */
import normalizer from ${stringifyRequest(`!${componentNormalizerPath}`)}
var component = normalizer(
  script,
  render,
  staticRenderFns,
  ${hasFunctional ? `true` : `false`},
  ${/injectStyles/.test(stylesCode) ? `injectStyles` : `null`},
  ${hasScoped ? JSON.stringify(id) : `null`},
  ${isServer ? JSON.stringify(hash(request)) : `null`}
  ${isShadow ? `,true` : ``}
)
  `.trim() + `\n`

  if (descriptor.customBlocks && descriptor.customBlocks.length) {
    code += genCustomBlocksCode(
      descriptor.customBlocks,
      resourcePath,
      resourceQuery,
      stringifyRequest
    )
  }

  if (needsHotReload) {
    code += `\n` + genHotReloadCode(id, hasFunctional, templateRequest)
  }

  // Expose filename. This is used by the devtools and Vue runtime warnings.
  if (!isProduction) {
    // Expose the file's full path in development, so that it can be opened
    // from the devtools.
    code += `\ncomponent.options.__file = ${JSON.stringify(rawShortFilePath.replace(/\\/g, '/'))}`
  } else if (options.exposeFilename) {
    // Libraies can opt-in to expose their components' filenames in production builds.
    // For security reasons, only expose the file's basename in production.
    code += `\ncomponent.options.__file = ${JSON.stringify(filename)}`
  }

  code += `\nexport default component.exports`

  // console.log(code)
  return code
  /* 第一阶段生成的code：
    import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&lang=pug&"
    import script from "./source.vue?vue&type=script&lang=js&"
    export * from "./source.vue?vue&type=script&lang=js&"
    import style0 from "./source.vue?vue&type=style&index=0&module=true&lang=css&"

    var cssModules = {}
    var disposed = false

    function injectStyles (context) {
      if (disposed) return

      cssModules["$style"] = (style0.locals || style0)
      Object.defineProperty(this, "$style", {
        configurable: true,
        get: function () {
          return cssModules["$style"]
        }
      })
    }

    module.hot && module.hot.dispose(function (data) {
      disposed = true
    })

    module.hot && module.hot.accept(["./source.vue?vue&type=style&index=0&module=true&lang=css&"], function () {
      var oldLocals = cssModules["$style"]
      if (oldLocals) {
        var newLocals = require("./source.vue?vue&type=style&index=0&module=true&lang=css&")
        if (JSON.stringify(newLocals) !== JSON.stringify(oldLocals)) {
          cssModules["$style"] = newLocals
          require("/Users/zhangxixi/knowledge collect/vue-loader/node_modules/_vue-hot-reload-api@2.3.3@vue-hot-reload-api/dist/index.js").rerender("27e4e96e")
        }
      }
    })

    // normalize component
    import normalizer from "!../lib/runtime/componentNormalizer.js"
    var component = normalizer(
      script,
      render,
      staticRenderFns,
      false,
      injectStyles,
      null,
      null
    )

    // custom blocks
    import block0 from "./source.vue?vue&type=custom&index=0&blockType=foo"
    if (typeof block0 === 'function') block0(component)

    // hot reload
    if (module.hot) {
      var api = require("/Users/zhangxixi/knowledge collect/vue-loader/node_modules/_vue-hot-reload-api@2.3.3@vue-hot-reload-api/dist/index.js")
      api.install(require('vue'))
      if (api.compatible) {
        module.hot.accept()
        if (!module.hot.data) {
          api.createRecord('27e4e96e', component.options)
        } else {
          api.reload('27e4e96e', component.options)
        }
        module.hot.accept("./source.vue?vue&type=template&id=27e4e96e&lang=pug&", function () {
          api.rerender('27e4e96e', {
            render: render,
            staticRenderFns: staticRenderFns
          })
        })
      }
    }
    component.options.__file = "example/source.vue"
    export default component.exports
  */
}

module.exports.VueLoaderPlugin = plugin

/*
  // 继续解析完这些第一阶段的request:
  // import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&lang=pug&"
  // import script from "./source.vue?vue&type=script&lang=js&"
  // export * from "./source.vue?vue&type=script&lang=js&"
  // import style0 from "./source.vue?vue&type=style&index=0&module=true&lang=css&"
  // 最终生成的代码

  // template
  // 来自 import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&lang=pug&" 的结果
  var render = function() {
    var _vm = this
    var _h = _vm.$createElement
    var _c = _vm._self._c || _h
    return _c(
      "div",
      {
        attrs: {
          ok: ""
        }
      },
      [
        _c(
          "h1",
          {
            class: _vm.$style.red
          },
        [_vm._v("hello")
      ])
    ])
  }

  var staticRenderFns = []

  render._withStripped = true

  // script
  // 来自 import script from "./source.vue?vue&type=script&lang=js&" 的结果
  var script = {
    data () {
      return {
        msg: 'fesfff'
      }
    }
  }

  // style
  // 来自 import style0 from "./source.vue?vue&type=style&index=0&module=true&lang=css&" 的结果
  .red {
    color: red;
  }

  // 注入style 及 style热加载
  var cssModules = {}
    var disposed = false

    function injectStyles (context) {
      if (disposed) return

      cssModules["$style"] = (style0.locals || style0)
      Object.defineProperty(this, "$style", {
        configurable: true,
        get: function () {
          return cssModules["$style"]
        }
      })
    }

    module.hot && module.hot.dispose(function (data) {
      disposed = true
    })

    module.hot && module.hot.accept(["./source.vue?vue&type=style&index=0&module=true&lang=css&"], function () {
      var oldLocals = cssModules["$style"]
      if (oldLocals) {
        var newLocals = require("./source.vue?vue&type=style&index=0&module=true&lang=css&")
        if (JSON.stringify(newLocals) !== JSON.stringify(oldLocals)) {
          cssModules["$style"] = newLocals
          require("/Users/zhangxixi/knowledge collect/vue-loader/node_modules/_vue-hot-reload-api@2.3.3@vue-hot-reload-api/dist/index.js").rerender("27e4e96e")
        }
      }
    })

    // normalize component
    import normalizer from "!../lib/runtime/componentNormalizer.js"
    var component = normalizer(
      script,
      render,
      staticRenderFns,
      false,
      injectStyles,
      null,
      null
    )

    // custom blocks
    // 来自 import block0 from "./source.vue?vue&type=custom&index=0&blockType=foo" 的结果
    var block0 = comp => {
      console.log(comp.options.data())
    }

    if (typeof block0 === 'function') block0(component)

    // hot reload
    // script 和 template的热加载
    if (module.hot) {
      var api = require("/Users/zhangxixi/knowledge collect/vue-loader/node_modules/_vue-hot-reload-api@2.3.3@vue-hot-reload-api/dist/index.js")
      api.install(require('vue'))
      if (api.compatible) {
        module.hot.accept()
        if (!module.hot.data) {
          api.createRecord('27e4e96e', component.options)
        } else {
          api.reload('27e4e96e', component.options)
        }
        module.hot.accept("./source.vue?vue&type=template&id=27e4e96e&lang=pug&", function () {
          api.rerender('27e4e96e', {
            render: render,
            staticRenderFns: staticRenderFns
          })
        })
      }
    }
    component.options.__file = "example/source.vue"
    export default component.exports

    // 继承自./source.vue?vue&type=script&lang=js&的导出
    export {
      data () {
        return {
          msg: 'fesfff'
        }
      }
    }
*/
