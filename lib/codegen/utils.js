const qs = require('querystring')

// these are built-in query parameters so should be ignored
// if the user happen to add them as attrs
// zxx注：ignoreList里的不需要在这里处理
const ignoreList = [
  'id',
  'index',
  'src',
  'type'
]

// transform the attrs on a SFC block descriptor into a resourceQuery string
/*
  zxx注：
  把SFC block descriptor的attrs转换成resourceQuery
  eg:
    输入的attrs = { lang: 'pug' }
    输出的query = &lang=pug

    没有lang且存在langFallback的情况：
    输入的attrs = { scoped: true }
    输出的query = &scoped=true&lang=css
*/
exports.attrsToQuery = (attrs, langFallback) => {
  let query = ``
  for (const name in attrs) {
    const value = attrs[name]
    // zxx注：如果在ignoreList，则忽略
    if (!ignoreList.includes(name)) {
      // zxx注：escape是对字符串编码
      query += `&${qs.escape(name)}=${value ? qs.escape(value) : ``}`
    }
  }
  // zxx注：如果没有lang，langFallback存在则使用langFallback
  if (langFallback && !(`lang` in attrs)) {
    query += `&lang=${langFallback}`
  }
  return query
}
