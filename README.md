---
title: vue-loader源码解析
date: 2019-06-11 22:47:33
tags:
---
# 前置知识
## vue-loader基本知识
> vue-loader作用：允许你以一种名为单文件组件（SFC）的格式撰写Vue组件

1. block（块）：vue组件里包含`template`、`script`、`style`、`custom blocks`这几部分，我们称之为“块”。

2. 一个vue组件里可以包含多个`style`块、`custom`块。

3. 每个块都可以使用不同的loader来处理，比如：

```javascript
<template lang="pug"></template>

<script type="text/vbscript"></script>

<style lang="scss"></style>

<style lang="less"></style>

<docs lang="xxx"></docs>

<foo></foo>
```

webpack里可以设置相应的loader来处理这些块，比如`pug-plain-loader`、`sass-loader`等。

4. 支持函数式组件

```javascript
<template functional>
  <div>{{ props.foo }}</div>
</template>
```

## webpack loader基本知识
vue-loader与webpack loader密切相关，我们首先看一下webpack loader的执行过程。

每个loader上都可以有一个`.pitch`方法，loader的处理过程分为两个阶段，pitch阶段和normal执行阶段：

第一步先进行pitch阶段：会先按顺序执行每个loader的pitch方法；

第二步按相反顺序进行normal执行阶段

如果loader的pitch方法有返回值，则直接掉头往相反顺序执行。参考官网例子([pitching loader](https://webpack.docschina.org/api/loaders/#%E8%B6%8A%E8%BF%87-loader-pitching-loader-))：

```javascript
module.exports = {
  //...
  module: {
    rules: [
      {
        //...
        use: [
          'a-loader',
          'b-loader',
          'c-loader'
        ]
      }
    ]
  }
};
```

上面例子中各个loader的执行顺序如下：

```
|- a-loader `pitch`
  |- b-loader `pitch`
    |- c-loader `pitch`
      |- requested module is picked up as a dependency
    |- c-loader normal execution
  |- b-loader normal execution
|- a-loader normal execution
```

如果b-loader返回了内容，则执行顺序如下：

```
|- a-loader `pitch`
  |- b-loader `pitch` returns a module
|- a-loader normal execution
```

# vue-loader在webpack流程中的位置

![vue-loader在webpack流程中的位置](https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader%E5%9C%A8webpack%E4%B8%AD%E7%9A%84%E4%BD%8D%E7%BD%AE.jpg?raw=true)

图中黄色部分就是vue-loader所涉及的内容，也就是我们这篇文章要分析的。

# 输入与输出
接下来，我们将通过一个例子，来看vue-loader是怎么工作的(这个例子来自vue-loader/example/)。

```javascript
// main.js
import Vue from 'vue'
import Foo from './source.vue'

new Vue({
  el: '#app',
  render: h => h(Foo)
})

```
```javascript
// source.vue
<template lang="pug">
  div(ok)
    h1(:class="$style.red") hello
</template>

<script>
export default {
  data () {
    return {
      msg: 'fesfff'
    }
  }
}
</script>

<style module>
.red {
  color: red;
}
</style>

<foo>
export default comp => {
  console.log(comp.options.data())
}
</foo>
```
```javascript
// webpack.config.js
const path = require('path')
const VueLoaderPlugin = require('../lib/plugin')

module.exports = {
  devtool: 'source-map',
  mode: 'development',
  entry: path.resolve(__dirname, './main.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    publicPath: '/dist/'
  },
  devServer: {
    stats: "minimal",
    contentBase: __dirname,
    writeToDisk: true,
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        resourceQuery: /blockType=foo/,
        loader: 'babel-loader'
      },
      {
        test: /\.pug$/,
        oneOf: [
          {
            resourceQuery: /^\?vue/,
            use: ['pug-plain-loader']
          },
          {
            use: ['raw-loader', 'pug-plain-loader']
          }
        ]
      },
      {
        test: /\.css$/,
        oneOf: [
          {
            resourceQuery: /module/,
            use: [
              'vue-style-loader',
              {
                loader: 'css-loader',
                options: {
                  modules: true,
                  localIdentName: '[local]_[hash:base64:8]'
                }
              }
            ]
          },
          {
            use: [
              'vue-style-loader',
              'css-loader'
            ]
          }
        ]
      },
      {
        test: /\.scss$/,
        use: [
          'vue-style-loader',
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              data: '$color: red;'
            }
          }
        ]
      }
    ]
  },
  resolveLoader: {
    alias: {
      'vue-loader': require.resolve('../lib')
    }
  },
  plugins: [
    new VueLoaderPlugin()
  ]
}
```

对于上述例子，vue-loader的输出结果是：

```javascript
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
```

# 源码结构
首先看一下vue-loader源码结构：

```
vue-loader/lib/
  │
  ├─── codegen/
  │      ├─── customBlock.js/      生成custom block的request
  │      ├─── hotReload.js/        生成热加载的代码
  │      ├─── styleInjection.js/   生成style的request
  │      ├─── utils.js/            工具函数
  ├─── loaders/   vue-loader内部定义的loaders
  │      ├─── pitcher.js/          pitcher-loader，将所有的单文件组件里的block请求拦截并转成合适的请求
  │      ├─── stylePostLoader.js/  style-post-loader， 处理scoped css的loader
  │      ├─── templateLoader.js/   template-loader，编译 html 模板字符串，生成 render/staticRenderFns 函数
  ├─── runtime/
  │      ├─── componentNormalizer.js/  将组件标准化
  ├─── index.d.ts/
  ├─── index.js/    vue-loader的核心代码
  ├─── plugin.js/   vue-loader-plugin的核心代码
  ├─── select.js/   根据不同query类型（script、template等）传递相应的content、map给下一个loader
```

# vue-loader-plugin

在webpack开始执行后，会先合并webpack.config里的配置，接着实例化compiler，然后就去挨个执行所有plugin的apply方法。请看webpack这部分源码：

```javascript
// webpack/lib/webpack.js

const Compiler = require("./Compiler")

const webpack = (options, callback) => {
  ...
  options = new WebpackOptionsDefaulter().process(options) // 初始化 webpack 各配置参数
  let compiler = new Compiler(options.context)             // 初始化 compiler 对象，这里 options.context 为 process.cwd()
  compiler.options = options                               // 往 compiler 添加初始化参数
  new NodeEnvironmentPlugin().apply(compiler)              // 往 compiler 添加 Node 环境相关方法
  for (const plugin of options.plugins) {
    plugin.apply(compiler);
  }
  ...
}
```

从例子中看到，我们的webpack配置了vue-loader-plugin，也就是源码里的vue-loader/lib/plugin.js，这是vue-loader强依赖的，如果不配置vue-loader-plugin，就会抛出错误。根据上面wbepack执行过程，在执行vue-loader核心代码之前，会先经过vue-loader-plugin。那么它到底做了哪些事情？

```javascript
// vue-loader/lib/plugin.js

class VueLoaderPlugin {
  apply (compiler) {
    // ...

    // 事件注册（简化了源代码）
    compiler.hooks.compilation.tap(id, compilation => {
      let normalModuleLoader = compilation.hooks.normalModuleLoader
      normalModuleLoader.tap(id, loaderContext => {
        loaderContext[NS] = true
      })
    })

    // ...

    const rawRules = compiler.options.module.rules
    const { rules } = new RuleSet(rawRules)

    // ...
    // 它的职责是将你定义过的其它规则复制并应用到 .vue 文件里相应语言的块。
    // 例如，如果你有一条匹配 /\.js$/ 的规则，那么它会应用到 .vue 文件里的 <script> 块。
    const clonedRules = rules
      .filter(r => r !== vueRule)
      .map(cloneRule)

    // ...

    // global pitcher (responsible for injecting template compiler loader & CSS
    // post loader)
    // 这个pitcher-loader的作用之一就是给template块添加template-loader，给style块添加style-post-loader，并分别导出一个新的js module request
    const pitcher = {
      loader: require.resolve('./loaders/pitcher'),
      resourceQuery: query => {
        const parsed = qs.parse(query.slice(1))
        return parsed.vue != null
      },
      options: {
        cacheDirectory: vueLoaderUse.options.cacheDirectory,
        cacheIdentifier: vueLoaderUse.options.cacheIdentifier
      }
    }

    // replace original rules
    compiler.options.module.rules = [
      pitcher,
      ...clonedRules,
      ...rules
    ]
  }
}

function createMatcher (fakeFile) {/*...*/}

function cloneRule (rule) {/*...*/}

VueLoaderPlugin.NS = NS
module.exports = VueLoaderPlugin
```

从上面源码可以看出，vue-loader-plugin导出的是一个类，并且只包含了一个apply方法。这个apply方法就是被webpack调用的。

apply方法其实就做了3件事：

1. 事件监听：在normalModuleLoader钩子执行前调用代码：loaderContext[NS] = true
   （每解析一个module，都会用到normalModuleLoader，由于每解析一个module都会有一个新的loaderContext，vue-loader/lib/index.js会判断loaderContext[NS]的值，为保证经过vue-loader执行时不报错，需要在这里标记loaderContext[NS] = true。）
> 说明：loader中的this是一个叫做loaderContext的对象，这是webpack提供的，是loader的上下文对象，里面包含loader可以访问的方法或属性。

2. 将webpack中配置的rules利用webpack的new RuleSet进行格式化（[rules配置](https://webpack.js.org/configuration/module#modulerules)），并clone一份rules给.vue文件里的每个block使用。

  ```javascript
      rules = [{
        resource: f (),
        use: [{
          loader: "vue-loader",
          options: undefined
        }]
      }, {
        resourceQuery: f (),
        use: [{
          loader: "babel-loader",
          options: undefined
        }]
      }, {
        resourceQuery: f (),
        use: [{
          loader: "babel-loader",
          options: undefined
        }]
      }, {
        resource: ƒ (),
        oneOf: [{
          resourceQuery: ƒ (),
          use: [{
            loader: "pug-plain-loader", options: undefined
          }]
        }, {
          use: [{
            loader: "raw-loader",
            options: undefined
          }, {
            loader: "pug-plain-loader",
            options: undefined
          }]
        }]
      }]
  ```

3. 在rules里加入vue-loader内部提供的rule（暂且称为pitcher-rule），其对应的loader是pitcher-loader，同时将原始的rules替换成pitcher-rule、cloneRules、rules。至于pitcher-rule、pitcher-loader做了什么，我们后面再讲。

放一张图总结下vue-loader-plugin的整体流程：

<img src="https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader-plugin%E6%95%B4%E4%BD%93%E6%B5%81%E7%A8%8B.jpg?raw=true" width = "300" height = "400" />


# vue-loader

当webpack加载入口文件main.js时，依赖到了source.vue，webpack内部会匹配source.vue的loaders，发现是vue-loader，然后就会去执行vue-loader([vue-loader/lib/index.js](https://github.com/vuejs/vue-loader/blob/master/lib/index.js))。接下来，我们分析vue-loader的实现过程。

```javascript
// vue-loader/lib/index.js

module.exports = function (source) {
  const loaderContext = this

  // 会先判断是否加载了vue-loader-plugin，没有则报错
  if (!errorEmitted && !loaderContext['thread-loader'] && !loaderContext[NS]) {
    // 略
  }

  // 从loaderContext获取信息
  const {
    target, // 编译的目标，是从webpack配置中传递过来的，默认是'web'，也可以是'node'等
    request, // 请求的资源的路径（每个资源都有一个路径）
    minimize, // 是否压缩：true/false，现在已废弃
    sourceMap, // 是否生成sourceMap: true/false
    rootContext, // 当前项目绝对路径，对本例子来说是：/Users/zhangxixi/knowledge collect/vue-loader
    resourcePath, // 资源文件的绝对路径，对本例子来说是：/Users/zhangxixi/knowledge collect/vue-loader/example/source.vue
    resourceQuery // 资源的 query 参数，也就是问号及后面的，如 ?vue&type=custom&index=0&blockType=foo
  } = loaderContext

  // 开始解析SFC，其实就是根据不同的 block 来拆解对应的内容
  // parse函数返回的是compiler.parseComponent()的结果
  // 如果没有自定义compiler，compiler对应的就是vue-template-compiler。
  const descriptor = parse({
    source,
    compiler: options.compiler || loadTemplateCompiler(loaderContext), // 如果loader的options没有配置compiler, 则使用vue-template-compiler
    filename,
    sourceRoot,
    needMap: sourceMap
  })

  // 如果是语言块，则直接返回
  if (incomingQuery.type) {
    return selectBlock(
      descriptor,
      loaderContext,
      incomingQuery,
      !!options.appendExtension
    )
  }

  // 接下来分别对不同block的请求进行处理
  // template
  // 处理template，根据descriptor.template，生成template的js module（生成import语句）
  /* 生成的template请求
    import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&"
  */
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
  /* 生成的script请求：
    import script from "./source.vue?vue&type=script&lang=js&"
    export * from "./source.vue?vue&type=script&lang=js&"
  */
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
 /* 生成的style请求：
    import style0 from "./source.vue?vue&type=style&index=0&id=27e4e96e&scoped=true&lang=css&"
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
  }

  module.exports.VueLoaderPlugin = plugin
```

vue-loader整体流程图：

<img src="https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader%E6%95%B4%E4%BD%93%E6%B5%81%E7%A8%8B.jpg?raw=true">

可以看出，整个过程大体可以分为3个阶段。

## 第一阶段
这一阶段是将.vue文件解析成js代码。

1. 会先判断是否加载了vue-loader-plugin，没有则报错
   ```javascript
    if (!errorEmitted && !loaderContext['thread-loader'] && !loaderContext[NS]) {
      // 略
    }
   ```
2. 从loaderContext中获取到模块的信息，比如request、resourcePath、resourceQuery等
   ```javascript
    const {
      target, // 编译的目标，是从webpack配置中传递过来的，默认是'web'，也可以是'node'等
      request, // 请求的资源的路径（每个资源都有一个路径）
      minimize, // 是否压缩：true/false，现在已废弃
      sourceMap, // 是否生成sourceMap: true/false
      rootContext, // 当前项目绝对路径，对本例子来说是：/Users/zhangxixi/knowledge collect/vue-loader
      resourcePath, // 资源文件的绝对路径，对本例子来说是：/Users/zhangxixi/knowledge collect/vue-loader/example/source.vue
      resourceQuery // 资源的 query 参数，也就是问号及后面的，如 ?vue&type=custom&index=0&blockType=foo
    } = loaderContext
   ```
3. 对.vue文件进行parse，其实就是把.vue分成template、script、style、customBlocks这几部分
   ```javascript
    const descriptor = parse({
      source,
      compiler: options.compiler || loadTemplateCompiler(loaderContext), // 如果loader的options没有配置compiler, 则使用vue-template-compiler
      filename,
      sourceRoot,
      needMap: sourceMap
    })
   ```

    这一阶段最关键的就是parse过程，parse前后对比如下：

    ```javascript
    // parse之前 source是：
    '<template lang="pug">\ndiv(ok)\n  h1(:class="$style.red") hello\n</template>\n\n<script>\nexport default {\n  data () {\n    return {\n      msg: \'fesfff\'\n    }\n  }\n}\n</script>\n\n<style scoped>\n.red {\n  color: red;\n}\n</style>\n\n<foo>\nexport default comp => {\n  console.log(comp.options.data())\n}\n</foo>\n'

    // parse之后 得到的结果
    {
      template:
        { type: 'template',
          content: '\ndiv(ok)\n  h1(:class="$style.red") hello\n',
          start: 21,
          attrs: { lang: 'pug' },
          lang: 'pug',
          end: 62
        },
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
            sourcesContent: [Array] }
        },
      styles:
        [ { type: 'style',
            content: '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n.red {\n  color: red;\n}\n',
            start: 183,
            attrs: [Object],
            scoped: true,
            end: 207,
            map: [Object]
          }
        ],
      customBlocks:
        [ { type: 'foo',
            content:
            '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nexport default comp => {\n  console.log(comp.options.data())\n}\n',
            start: 222,
            attrs: {},
            end: 285
          }
        ],
      errors: []
    }
    ```

4. 然后区分.vue请求与block请求（请求source.vue就是.vue请求，source.vue里依赖了template、script等block，那么这些依赖会被解析成.source.vue?vue&type=template这种带query的，我们称之为block请求）。如果是.vue请求，则需要生成js module。否则就执行selectBlock。第一阶段是.vue请求，因此会生成js module：分别生成template、script、style、customBlock的请求路径（这里会在query上添加'vue'，比如./source.vue?vue&type=script&lang=js，这会在第二阶段用到）；添加热加载逻辑。

vue-loader第一阶段生成的js代码如下：

```javascript
import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&"
import script from "./source.vue?vue&type=script&lang=js&"
export * from "./source.vue?vue&type=script&lang=js&"
import style0 from "./source.vue?vue&type=style&index=0&id=27e4e96e&scoped=true&lang=css&"
import normalizer from "!../lib/runtime/componentNormalizer.js"
var component = normalizer(
  script,
  render,
  staticRenderFns,
  false,
  null,
  "27e4e96e",
  null
)
import block0 from "./source.vue?vue&type=custom&index=0&blockType=foo"
if (typeof block0 === 'function') block0(component)
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
    module.hot.accept("./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&", function () {
      api.rerender('27e4e96e', {
        render: render,
        staticRenderFns: staticRenderFns
      })
    })
  }
}
component.options.__file = "example/source.vue"
export default component.exports
```

![vue-loader第一阶段](https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader%E7%AC%AC%E4%B8%80%E9%98%B6%E6%AE%B5.jpg?raw=true)

## 第二阶段
第一阶段返回的js代码交与webpack继续解析，代码里的这几个import请求就会被接着进行依赖解析，这样就会接着请求所依赖的template、script、style、customBlock。

我们以template的请求为例：
`import { render, staticRenderFns } from "./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&"`，webpack解析出这个module需要的loaders是：pitcher-loader、pug-plain-loader、vue-loader。需要哪些loader是webpack内部根据rules来匹配的，这里的rules是经过vue-loader-plugin处理后的。之所以能解析出pitcher-loader，是因为query里含有vue，此时，是时候回过头来看一下vue-loader-plugin中pitcher-rule和pitcher-loader的代码了。

```javascript
// vue-loader/lib/plugin.js

    // ...
    // global pitcher (responsible for injecting template compiler loader & CSS
    // post loader)
    const pitcher = {
      loader: require.resolve('./loaders/pitcher'),
      resourceQuery: query => {
        const parsed = qs.parse(query.slice(1))
        return parsed.vue != null
      },
      options: {
        cacheDirectory: vueLoaderUse.options.cacheDirectory,
        cacheIdentifier: vueLoaderUse.options.cacheIdentifier
      }
    }
    // ...
```

从上面代码可以看到，pitcher-rule是通过resourceQuery中是否有vue进行匹配的。从第一阶段返回的代码中可以看到，template、script、style、custom-block的请求query中都带有vue。所以这个rule就是匹配这几个block请求的。如果匹配到了，那么pitcher-loader就会加入到这些请求需要的loader数组中。pitcher-loader来自于vue-loader/lib/loaders/pitcher.js。那我们来看一下这个pitcher-loader到底做了什么：

```javascript
// vue-loader/lib/loaders/pitcher.js

module.exports = code => code
module.exports.pitch = function (remainingRequest) {
  // ...
  const query = qs.parse(this.resourceQuery.slice(1))
  let loaders = this.loaders

  // if this is a language block request, eslint-loader may get matched
  // multiple times
  if (query.type) {
    // if this is an inline block, since the whole file itself is being linted,
    // remove eslint-loader to avoid duplicate linting.
    if (/\.vue$/.test(this.resourcePath)) {
      loaders = loaders.filter(l => !isESLintLoader(l))
    } else {
      // This is a src import. Just make sure there's not more than 1 instance
      // of eslint present.
      loaders = dedupeESLintLoader(loaders)
    }
  }

  // remove self
  loaders = loaders.filter(isPitcher)

  // ...

  // Inject style-post-loader before css-loader for scoped CSS and trimming
  if (query.type === `style`) {
    const cssLoaderIndex = loaders.findIndex(isCSSLoader)
    if (cssLoaderIndex > -1) {
      const afterLoaders = loaders.slice(0, cssLoaderIndex + 1)
      const beforeLoaders = loaders.slice(cssLoaderIndex + 1)

      const request = genRequest([
        ...afterLoaders,
        stylePostLoaderPath,
        ...beforeLoaders
      ])

      return `import mod from ${request}; export default mod; export * from ${request}`
    }
  }

  // for templates: inject the template compiler & optional cache
  if (query.type === `template`) {
    const path = require('path')
    const cacheLoader = cacheDirectory && cacheIdentifier
      ? [`cache-loader?${JSON.stringify({
        // For some reason, webpack fails to generate consistent hash if we
        // use absolute paths here, even though the path is only used in a
        // comment. For now we have to ensure cacheDirectory is a relative path.
        cacheDirectory: (path.isAbsolute(cacheDirectory)
          ? path.relative(process.cwd(), cacheDirectory)
          : cacheDirectory).replace(/\\/g, '/'),
        cacheIdentifier: hash(cacheIdentifier) + '-vue-loader-template'
      })}`]
      : []

    const preLoaders = loaders.filter(isPreLoader)
    const postLoaders = loaders.filter(isPostLoader)

    const request = genRequest([
      ...cacheLoader,
      ...postLoaders,
      templateLoaderPath + `??vue-loader-options`,
      ...preLoaders
    ])

    // the template compiler uses esm exports
    return `export * from ${request}`
  }

  // if a custom block has no other matching loader other than vue-loader itself
  // or cache-loader, we should ignore it
  if (query.type === `custom` && shouldIgnoreCustomBlock(loaders)) {
    return ``
  }

  // When the user defines a rule that has only resourceQuery but no test,
  // both that rule and the cloned rule will match, resulting in duplicated
  // loaders. Therefore it is necessary to perform a dedupe here.
  const request = genRequest(loaders)

  return `import mod from ${request}; export default mod; export * from ${request}`
}
```

pitcher-loader做了三件事情，最关键的是第三件事情：

1. 剔除eslint-loader
2. 剔除pitcher-loader自身
3. 根据不同的query进行拦截处理，返回对应的内容，跳过后面的loader执行部分

对于style的处理，先判断是否有css-loader，有的话就生成一个新的request，这个过程会将vue-loader内部的style-post-loader添加进去，然后返回一个js请求。根据pitch的规则，pitcher-loader后面的loader都会被跳过，然后就开始解析这个返回的js请求，它的的内容是：

```javascript
import mod from "-!../node_modules/_vue-style-loader@4.1.2@vue-style-loader/index.js!../node_modules/_css-loader@1.0.1@css-loader/index.js!../lib/loaders/stylePostLoader.js!../lib/index.js??vue-loader-options!./source.vue?vue&type=style&index=0&id=27e4e96e&scoped=true&lang=css&";
export default mod; export * from "-!../node_modules/_vue-style-loader@4.1.2@vue-style-loader/index.js!../node_modules/_css-loader@1.0.1@css-loader/index.js!../lib/loaders/stylePostLoader.js!../lib/index.js??vue-loader-options!./source.vue?vue&type=style&index=0&id=27e4e96e&scoped=true&lang=css&"
```

对于template的处理类似，也会生成一个新的request，这个过程会将vue-loader内部提供的template-loader加进去，并返回一个js请求：

```javascript
export * from "-!../lib/loaders/templateLoader.js??vue-loader-options!../node_modules/_pug-plain-loader@1.0.0@pug-plain-loader/index.js!../lib/index.js??vue-loader-options!./source.vue?vue&type=template&id=27e4e96e&scoped=true&lang=pug&"
```

其他block也是类似的。

![vue-loader第二阶段](https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader%E7%AC%AC%E4%BA%8C%E9%98%B6%E6%AE%B5.jpg?raw=true)

## 第三阶段
经过第二阶段后，webpack会继续解析每个block对应的js请求。根据这些请求，webpack会匹配到相应的loaders。

对于style，对应的loader是vue-style-loader、css-loader、style-post-loader、vue-loader。执行顺序就是：

vue-style-loader的pitch、css-loader的pitch、style-post-loader的pitch、vue-loader的pitch、vue-loader（分离出style block）、style-post-loader（处理scoped css）、css-loader（处理相关资源的引入路径）、vue-style-loader（动态创建style标签插入css）。


对于template，对应的loader是template-loader、pug-plain-loader、vue-loader，执行顺序是：

template-loader的pitch、pug-plain-loader的pitch、vue-loader的pitch、vue-loader（分离出template block）、pug-plain-loader（将pug模板转化为html字符串）、template-loader（编译 html 模板字符串，生成 render/staticRenderFns 函数并暴露出去）。

其他模块类似。


会发现，在不考虑pitch函数的时候，第三阶段里最先执行的都是vue-loader，此时query是有值的，所以会进入到selecBlock阶段。（这就是vue-loader执行时与第一阶段不同的地方）

```javascript
  // vue-loader/lib/index.js

  // ...
  // 如果是语言块，则直接返回
  if (incomingQuery.type) {
    return selectBlock(
      descriptor,
      loaderContext,
      incomingQuery,
      !!options.appendExtension
    )
  }
  // ...
```
selectBlock来自select.js，那么我们来看看select.js做了什么：

```javascript
module.exports = function selectBlock (
  descriptor,
  loaderContext,
  query,
  appendExtension
) {
  // template
  if (query.type === `template`) {
    if (appendExtension) {
      loaderContext.resourcePath += '.' + (descriptor.template.lang || 'html')
    }
    loaderContext.callback(
      null,
      descriptor.template.content,
      descriptor.template.map
    )
    return
  }

  // script
  if (query.type === `script`) {
    if (appendExtension) {
      loaderContext.resourcePath += '.' + (descriptor.script.lang || 'js')
    }
    loaderContext.callback(
      null,
      descriptor.script.content,
      descriptor.script.map
    )
    return
  }

  // styles
  if (query.type === `style` && query.index != null) {
    const style = descriptor.styles[query.index]
    if (appendExtension) {
      loaderContext.resourcePath += '.' + (style.lang || 'css')
    }
    loaderContext.callback(
      null,
      style.content,
      style.map
    )
    return
  }

  // custom
  if (query.type === 'custom' && query.index != null) {
    const block = descriptor.customBlocks[query.index]
    loaderContext.callback(
      null,
      block.content,
      block.map
    )
    return
  }
}
```

select.js其实就是根据不同的query类型，将相应的content和map传递给下一个loader。

最终生成的代码长什么样？

template最终解析代码：

```javascript
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

export { render, staticRenderFns }
```

style最终解析代码：

```javascript
  .red[data-v-27e4e96e] {
    color: red;
  }
```

![vue-loader第三阶段](https://github.com/xixizhangfe/markdownImages/blob/master/vue-loader%E7%AC%AC%E4%B8%89%E9%98%B6%E6%AE%B5.jpg?raw=true)


# 一些有意思的代码实现

## vue-plugin-loader是如何将rules里配置的规则应用到block里的？

vue-loader-plugin的cloneRules源码:

```javascript
// vue-loader/lib/plugin.js

// ...

function cloneRule (rule) {
  const { resource, resourceQuery } = rule
  // Assuming `test` and `resourceQuery` tests are executed in series and
  // synchronously (which is true based on RuleSet's implementation), we can
  // save the current resource being matched from `test` so that we can access
  // it in `resourceQuery`. This ensures when we use the normalized rule's
  // resource check, include/exclude are matched correctly.
  let currentResource
  const res = Object.assign({}, rule, {
    resource: {
      test: resource => {
        currentResource = resource
        // 始终返回true，是为了能让ruleSet在执行时能够进入resourceQuery的判断规则
        // 同时提供currentResource给resourceQuery使用
        return true
      }
    },
    resourceQuery: query => {
      const parsed = qs.parse(query.slice(1))
      // 如果query里没有vue，则说明不是.vue的block，不进行匹配
      if (parsed.vue == null) {
        return false
      }
      // .vue里给block匹配loader时需要通过lang来匹配。如果没有指定lang，也不进行匹配。
      // 会发现，在为block生成request时，都会用到attrsToQuery，而style和script会给attrsToQuery分别传递'css', 'js'作为langFallback, customBlock和template则不需要传递
      // 这是因为我们写代码时style和script可以不写lang，不写默认是css、js。这时候vue-loader需要把默认的加上。
      // 而customBlock和template没有默认的lang，所以vue-loader不用提供默认的lang。
      if (resource && parsed.lang == null) {
        return false
      }
      // 这里需要在原资源路径后拼接一个假的后缀，如source.vue.css，这是为了执行resource时，能够通过资源名后缀匹配到loader
      /* 比如，我们配置了一个规则是:
        {
          test: /\.css$/,
          use: [
            'vue-style-loader',
            'css-loader'
          ]
        }

        经过new RuleSet后，会变成:
        {
          resource: (resource) => {
            return /\.css$/.test(resource)
          },
          use: [
            'vue-style-loader',
            'css-loader'
          ]
        }

        resource是一个函数，此时利用拼接的fakeResourcePath，resource(fakeResourcePath)就可以匹配成功了
      */
      const fakeResourcePath = `${currentResource}.${parsed.lang}`
      if (resource && !resource(fakeResourcePath)) {
        return false
      }
      if (resourceQuery && !resourceQuery(query)) {
        return false
      }
      return true
    }
  })

  if (rule.oneOf) {
    res.oneOf = rule.oneOf.map(cloneRule)
  }

  return res
}

// ...

// replace original rules
compiler.options.module.rules = [
  pitcher,
  ...clonedRules,
  ...rules
]

// ...
```

# 尾声
本文只是梳理了vue-loader的整体流程，具体源码细节请参考我写的[源码注释](https://github.com/xixizhangfe/vue-loader)

# 扩展知识
[webpack RuleSet源码分析](https://github.com/CommanderXL/Biu-blog/issues/30)
