const qs = require('querystring')
const { attrsToQuery } = require('./utils')

module.exports = function genCustomBlocksCode (
  blocks,
  resourcePath,
  resourceQuery,
  stringifyRequest
) {
  return `\n/* custom blocks */\n` + blocks.map((block, i) => {
    const src = block.attrs.src || resourcePath
    // zxx注：把对象形式的转成字符串形式，比如把 {lang: yaml} 转成 &lang=yaml
    const attrsQuery = attrsToQuery(block.attrs)
    // zxx注：这里用issuerQuery表示用到customBlock的模块的路径（谁请求了customBlock，就是谁的路径）
    // 比如例子里source.vue里用到了customBlock，那么issuerQuery就是path/to/vue-loader/example/source.vue
    const issuerQuery = block.attrs.src ? `&issuerPath=${qs.escape(resourcePath)}` : ''
    // zxx注：inheritQuery表示继承的query，本例中没有resourceQuery
    const inheritQuery = resourceQuery ? `&${resourceQuery.slice(1)}` : ''
    /*
      zxx注：
      拼接customBlock真正的query；
      可以看到attrsToQuery函数里ignoreList中包含的attrs会在这里单独拼接；
      注意：query里添加了vue，这是为了在匹配loader时能够匹配到pitcher-loader
    */
    const query = `?vue&type=custom&index=${i}&blockType=${qs.escape(block.type)}${issuerQuery}${attrsQuery}${inheritQuery}`
    /*
      zxx注：
      这里的component是指vue-loader/index.js里返回的code里normalizer得到的。
      TODO:
      至于为什么要去执行block(component)，有时间再看
    */
    return (
      `import block${i} from ${stringifyRequest(src + query)}\n` +
      `if (typeof block${i} === 'function') block${i}(component)`
    )
  }).join(`\n`) + `\n`
}
