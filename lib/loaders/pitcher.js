const qs = require('querystring')
const loaderUtils = require('loader-utils')
const hash = require('hash-sum')
const selfPath = require.resolve('../index')
const templateLoaderPath = require.resolve('./templateLoader')
const stylePostLoaderPath = require.resolve('./stylePostLoader')

// l表示loader
const isESLintLoader = l => /(\/|\\|@)eslint-loader/.test(l.path)
const isNullLoader = l => /(\/|\\|@)null-loader/.test(l.path)
const isCSSLoader = l => /(\/|\\|@)css-loader/.test(l.path)
const isCacheLoader = l => /(\/|\\|@)cache-loader/.test(l.path)
const isPitcher = l => l.path !== __filename // __filename是node中定义的，获得当前执行文件所在目录的完整目录名
// 根据loader的pitchExecuted属性判断是否已经了该loader的pitch方法，如果pitchExecuted为false，表示该loader是在pitcher-loader之前执行的loader
const isPreLoader = l => !l.pitchExecuted
const isPostLoader = l => l.pitchExecuted

// 去掉重复的eslint loader
const dedupeESLintLoader = loaders => {
  const res = []
  let seen = false
  loaders.forEach(l => {
    if (!isESLintLoader(l)) {
      res.push(l)
    } else if (!seen) {
      seen = true
      res.push(l)
    }
  })
  return res
}

// 是否忽略自定义block，如果loaders中只有vue-loader、cache-loader，则忽略自定义block
const shouldIgnoreCustomBlock = loaders => {
  const actualLoaders = loaders.filter(loader => {
    // vue-loader
    if (loader.path === selfPath) {
      return false
    }

    // cache-loader
    if (isCacheLoader(loader)) {
      return false
    }

    return true
  })
  return actualLoaders.length === 0
}

module.exports = code => code

// This pitching loader is responsible for intercepting all vue block requests
// and transform it into appropriate requests.
// pitching loader是为了拦截所有的vue块请求，并将其转换为合适的请求
module.exports.pitch = function (remainingRequest) {
  const options = loaderUtils.getOptions(this)
  const { cacheDirectory, cacheIdentifier } = options
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

  // do not inject if user uses null-loader to void the type (#1239)
  // null-loader会使依赖静音。https://webpack.docschina.org/loaders/null-loader/
  // 如果module的loaders含有null-loader，则不用进行依赖处理
  if (loaders.some(isNullLoader)) {
    return
  }

  // 根据loader的path + query去重，
  const genRequest = loaders => {
    // Important: dedupe since both the original rule
    // and the cloned rule would match a source import request.
    // also make sure to dedupe based on loader path.
    // assumes you'd probably never want to apply the same loader on the same
    // file twice.
    // Exception: in Vue CLI we do need two instances of postcss-loader
    // for user config and inline minification. So we need to dedupe baesd on
    // path AND query to be safe.
    const seen = new Map()
    const loaderStrings = []

    loaders.forEach(loader => {
      const identifier = typeof loader === 'string'
        ? loader
        : (loader.path + loader.query)
      const request = typeof loader === 'string' ? loader : loader.request
      if (!seen.has(identifier)) {
        seen.set(identifier, true)
        // loader.request contains both the resolved loader path and its options
        // query (e.g. ??ref-0)
        loaderStrings.push(request)
      }
    })

    return loaderUtils.stringifyRequest(this, '-!' + [
      ...loaderStrings,
      this.resourcePath + this.resourceQuery
    ].join('!'))
  }

  // Inject style-post-loader before css-loader for scoped CSS and trimming
  // 生成style的request
  if (query.type === `style`) {
    // 是否有css-loader
    const cssLoaderIndex = loaders.findIndex(isCSSLoader)
    if (cssLoaderIndex > -1) {
      /*
        如果有css-loader，则需要将style-post-loader插入到css-loader之前
        由于loader的实际执行顺序是相反的，所以这里的命名afterLoaders、beforeLoaders是根据执行顺序来命名的
      */
      const afterLoaders = loaders.slice(0, cssLoaderIndex + 1)
      const beforeLoaders = loaders.slice(cssLoaderIndex + 1)
      // 根据loaders生成request
      const request = genRequest([
        ...afterLoaders,
        stylePostLoaderPath,
        ...beforeLoaders
      ])
      // console.log(request)
      return `import mod from ${request}; export default mod; export * from ${request}`
    }
  }

  // for templates: inject the template compiler & optional cache
  // 生成template的request
  if (query.type === `template`) {
    const path = require('path')
    // 拼接cacheLoader的路径
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

    // cacheLoader最后执行，template-loader需要在preLoader之后执行
    const request = genRequest([
      ...cacheLoader,
      ...postLoaders,
      templateLoaderPath + `??vue-loader-options`,
      ...preLoaders
    ])
    // console.log(request)
    // the template compiler uses esm exports
    /*
      这里export * 实际上是es6模块的继承语法(http://es6.ruanyifeng.com/#docs/module#%E6%A8%A1%E5%9D%97%E7%9A%84%E7%BB%A7%E6%89%BF)
      后面会交给template-loader处理，相当于template-loader继承并导出了request的所有属性和方法
    */
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
