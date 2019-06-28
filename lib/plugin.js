debugger
const qs = require('querystring')
const RuleSet = require('webpack/lib/RuleSet')

const id = 'vue-loader-plugin'
const NS = 'vue-loader'

class VueLoaderPlugin {
  apply (compiler) {
    // add NS marker so that the loader can detect and report missing plugin
    if (compiler.hooks) {
      // webpack 4
      compiler.hooks.compilation.tap(id, compilation => {
        let normalModuleLoader
        if (Object.isFrozen(compilation.hooks)) {
          // webpack 5
          normalModuleLoader = require('webpack/lib/NormalModule').getCompilationHooks(compilation).loader
        } else {
          normalModuleLoader = compilation.hooks.normalModuleLoader
        }
        // normalModuleLoader:调用loader-runner的runLoaders之前触发的hook
        normalModuleLoader.tap(id, loaderContext => {
          loaderContext[NS] = true
        })
      })
    } else {
      // webpack < 4
      compiler.plugin('compilation', compilation => {
        compilation.plugin('normal-module-loader', loaderContext => {
          loaderContext[NS] = true
        })
      })
    }

    // use webpack's RuleSet utility to normalize user rules
    // rawRules就是webpack.config.js里配置的rules，格式是：
    /*
    rawRules = [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        exclude: [path.resolve('eg2')]
      },
      {
        resourceQuery: /blockType=foo/,
        loader: 'babel-loader'
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
      }]
    */
    const rawRules = compiler.options.module.rules
    // rules是格式化后的规则
    /*
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
    */
    const { rules } = new RuleSet(rawRules)

    // find the rule that applies to vue files
    // 检查是否有规则匹配.vue或者.vue.html格式
    /*
      .vue对应的rule只有test和loader属性时:
      createMatcher = (str) => { return (/\.vue$/).test(str); }
      如果rule有exclude、or、and等属性:
      matchers = [
        (str) => { return (/\.vue$/).test(str); },
        (str) => { return !matcher(str); }
      ]
      createMatcher = (str) => {
        for (let i = 0; i < matchers.length; i++) {
            if (!matchers[i](str)) return false;
        }
        return true;
      }
    */
    let vueRuleIndex = rawRules.findIndex(createMatcher(`foo.vue`))
    if (vueRuleIndex < 0) {
      vueRuleIndex = rawRules.findIndex(createMatcher(`foo.vue.html`))
    }
    const vueRule = rules[vueRuleIndex]

    if (!vueRule) {
      throw new Error(
        `[VueLoaderPlugin Error] No matching rule for .vue files found.\n` +
        `Make sure there is at least one root-level rule that matches .vue or .vue.html files.`
      )
    }

    if (vueRule.oneOf) {
      throw new Error(
        `[VueLoaderPlugin Error] vue-loader 15 currently does not support vue rules with oneOf.`
      )
    }

    // get the normlized "use" for vue files
    // 检查.vue规则的loader是否是vue-loader
    const vueUse = vueRule.use
    // get vue-loader options
    const vueLoaderUseIndex = vueUse.findIndex(u => {
      return /^vue-loader|(\/|\\|@)vue-loader/.test(u.loader)
    })

    if (vueLoaderUseIndex < 0) {
      throw new Error(
        `[VueLoaderPlugin Error] No matching use for vue-loader is found.\n` +
        `Make sure the rule matching .vue files include vue-loader in its use.`
      )
    }

    // make sure vue-loader options has a known ident so that we can share
    // options by reference in the template-loader by using a ref query like
    // template-loader??vue-loader-options
    // 给vue-loader添加ident
    const vueLoaderUse = vueUse[vueLoaderUseIndex]
    vueLoaderUse.ident = 'vue-loader-options'
    vueLoaderUse.options = vueLoaderUse.options || {}

    // 它的职责是将你定义过的其它规则复制并应用到 .vue 文件里相应语言的块。
    // 例如，如果你有一条匹配 /\.js$/ 的规则，那么它会应用到 .vue 文件里的 <script> 块。
    // for each user rule (expect the vue rule), create a cloned rule
    // that targets the corresponding language blocks in *.vue files.
    const clonedRules = rules
      .filter(r => r !== vueRule)
      .map(cloneRule)

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

function createMatcher (fakeFile) {
  return (rule, i) => {
    // #1201 we need to skip the `include` check when locating the vue rule
    const clone = Object.assign({}, rule)
    delete clone.include
    const normalized = RuleSet.normalizeRule(clone, {}, '')
    return (
      !rule.enforce &&
      normalized.resource &&
      normalized.resource(fakeFile)
    )
  }
}

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

VueLoaderPlugin.NS = NS
module.exports = VueLoaderPlugin
