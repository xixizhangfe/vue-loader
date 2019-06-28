const qs = require('querystring')
// 用于处理scoped css，如果不是scoped css，则该步骤被忽略
// 在css-loader之前注入
/*
  输入参数：
  interface StyleCompileOptions {
    source: string
    filename: string
    id: string
    map?: any
    scoped?: boolean
    trim?: boolean
    preprocessLang?: string
    preprocessOptions?: any
    postcssOptions?: any
    postcssPlugins?: any[]
  }

  输出：
  interface StyleCompileResults {
    code: string
    map: any | void
    rawResult: LazyResult | void // raw lazy result from PostCSS
    errors: string[]
  }

  比如：source是：
  <style>
    .red {
      color: red;
    }
  </style>
  输出（只是trim了）：
  .red {
    color: red;
  }

  source是：
  <style scoped>
    .red {
      color: red;
    }
  </style>
  输出（添加了data-v-）：
  .red[data-v-27e4e96e] {
    color: red;
  }
*/
const { compileStyle } = require('@vue/component-compiler-utils')

// This is a post loader that handles scoped CSS transforms.
// Injected right before css-loader by the global pitcher (../pitch.js)
// for any <style scoped> selection requests initiated from within vue files.
/*
  this 是loaderContext
*/
module.exports = function (source, inMap) {
  const query = qs.parse(this.resourceQuery.slice(1)) // 去掉问号
  const { code, map, errors } = compileStyle({
    source,
    filename: this.resourcePath,
    id: `data-v-${query.id}`,
    map: inMap,
    scoped: !!query.scoped,
    trim: true
  })

  if (errors.length) {
    this.callback(errors[0])
  } else {
    this.callback(null, code, map)
  }

  /*
    style-post-loader最终返回的代码:
    .red[data-v-27e4e96e] {
      color: red;
    }
  */
}
