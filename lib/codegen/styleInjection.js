const { attrsToQuery } = require('./utils')
const hotReloadAPIPath = JSON.stringify(require.resolve('vue-hot-reload-api'))
const nonWhitespaceRE = /\S+/

module.exports = function genStyleInjectionCode (
  loaderContext,
  styles,
  id,
  resourcePath,
  stringifyRequest,
  needsHotReload,
  needsExplicitInjection
) {
  let styleImportsCode = ``
  let styleInjectionCode = ``
  let cssModulesHotReloadCode = ``

  let hasCSSModules = false
  const cssModuleNames = new Map()

  /*
    zxx注：
    genStyleRequest函数的注释请参考vue-loader/lib/codegen/customBlock.js
    注意：与customBlock.js不同的是，这里没有issuerQuery。因为style是可以复用的，
    如果加上issuerQuery，会导致request不同，但实际得到的style是一样的，也就是重复请求了
  */
  function genStyleRequest (style, i) {
    const src = style.src || resourcePath
    const attrsQuery = attrsToQuery(style.attrs, 'css')
    const inheritQuery = `&${loaderContext.resourceQuery.slice(1)}`
    // make sure to only pass id when necessary so that we don't inject
    // duplicate tags when multiple components import the same css file
    const idQuery = style.scoped ? `&id=${id}` : ``
    const query = `?vue&type=style&index=${i}${idQuery}${attrsQuery}${inheritQuery}`
    return stringifyRequest(src + query)
  }

  function genCSSModulesCode (style, request, i) {
    hasCSSModules = true

    /*
      zxx注：
      如果style.module是true，则取默认值$style
      如果style.module不是true，表明有自定义名字，就使用自定义的名字
    */
    const moduleName = style.module === true ? '$style' : style.module
    // zxx注：moduleName必须是唯一的
    if (cssModuleNames.has(moduleName)) {
      loaderContext.emitError(`CSS module name ${moduleName} is not unique!`)
    }
    cssModuleNames.set(moduleName, true)

    // `(vue-)style-loader` exports the name-to-hash map directly
    // `css-loader` exports it in `.locals`
    /*
      TODO:
      zxx注：这里涉及到(vue-)style-loader、css-loader的导出，等后续看了这两个再说，不影响理解
    */
    const locals = `(style${i}.locals || style${i})`
    const name = JSON.stringify(moduleName)

    if (!needsHotReload) {
      styleInjectionCode += `this[${name}] = ${locals}\n`
    } else {
      styleInjectionCode += `
        cssModules[${name}] = ${locals}
        Object.defineProperty(this, ${name}, {
          configurable: true,
          get: function () {
            return cssModules[${name}]
          }
        })
      `
      cssModulesHotReloadCode += `
        module.hot && module.hot.accept([${request}], function () {
          var oldLocals = cssModules[${name}]
          if (oldLocals) {
            var newLocals = require(${request})
            if (JSON.stringify(newLocals) !== JSON.stringify(oldLocals)) {
              cssModules[${name}] = newLocals
              require(${hotReloadAPIPath}).rerender("${id}")
            }
          }
        })
      `
    }
  }

  // empty styles: with no `src` specified or only contains whitespaces
  const isNotEmptyStyle = style => style.src || nonWhitespaceRE.test(style.content)
  // explicit injection is needed in SSR (for critical CSS collection)
  // or in Shadow Mode (for injection into shadow root)
  // In these modes, vue-style-loader exports objects with the __inject__
  // method; otherwise we simply import the styles.
  /*
    zxx注：
    在ssr、shadow node模式下，vue-style-loader导出的对象带有__inject__方法
    其他模式，只是简单import the styles
  */
  if (!needsExplicitInjection) {
    styles.forEach((style, i) => {
      // do not generate requests for empty styles
      if (isNotEmptyStyle(style)) {
        const request = genStyleRequest(style, i)
        styleImportsCode += `import style${i} from ${request}\n`
        // zxx注：vue单文件组件支持css modules，具体用法可参看官网https://vue-loader.vuejs.org/zh/guide/css-modules.html
        if (style.module) genCSSModulesCode(style, request, i)
      }
    })
  } else {
    styles.forEach((style, i) => {
      if (isNotEmptyStyle(style)) {
        const request = genStyleRequest(style, i)
        styleInjectionCode += (
          `var style${i} = require(${request})\n` +
          `if (style${i}.__inject__) style${i}.__inject__(context)\n`
        )
        if (style.module) genCSSModulesCode(style, request, i)
      }
    })
  }

  if (!needsExplicitInjection && !hasCSSModules) {
    return styleImportsCode
  }

  return `
${styleImportsCode}
${hasCSSModules && needsHotReload ? `var cssModules = {}` : ``}
${needsHotReload ? `var disposed = false` : ``}

function injectStyles (context) {
  ${needsHotReload ? `if (disposed) return` : ``}
  ${styleInjectionCode}
}

${needsHotReload ? `
  module.hot && module.hot.dispose(function (data) {
    disposed = true
  })
` : ``}

${cssModulesHotReloadCode}
  `.trim()
/*
  zxx注：
  如果needsExplicitInjection，或者hasCSSModules，最终导出的结果是（一个例子）：

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
*/
}
