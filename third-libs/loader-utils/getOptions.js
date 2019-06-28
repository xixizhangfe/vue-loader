'use strict';

const parseQuery = require('./parseQuery');

function getOptions(loaderContext) {
  // 如果loader配置了options对象，则query指向这个options对象
  // 如果没有配置options，而是以query字符串作为参数调用时，this.query就是一个以 ? 开头的字符串
  // query的可能格式：{indentedSyntax: true} 或者 ?indentedSyntax=true
  const query = loaderContext.query;

  if (typeof query === 'string' && query !== '') {
    return parseQuery(loaderContext.query);
  }

  if (!query || typeof query !== 'object') {
    // Not object-like queries are not supported.
    return null;
  }

  return query;
}

module.exports = getOptions;
