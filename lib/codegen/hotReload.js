// 热加载利用的是vue-hot-reload-api（https://github.com/vuejs/vue-hot-reload-api）
const hotReloadAPIPath = JSON.stringify(require.resolve('vue-hot-reload-api'))

const genTemplateHotReloadCode = (id, request) => {
  return `
    module.hot.accept(${request}, function () {
      api.rerender('${id}', {
        render: render,
        staticRenderFns: staticRenderFns
      })
    })
  `.trim()
}

/*
  zxx注：
  module.hot: 是webpack.hmr api（https://webpack.js.org/guides/hot-module-replacement/）

  api.install(require('vue')): 安装api，并告诉api我正在使用Vue，安装后会检查兼容性

  api.compatible: 是检查版本的兼容性

  module.hot.accept(): 表示此模块接受热重载

  api.createRecord('${id}', component.options): 为了将每一个组件中的选项变得可以热加载，需要用一个不重复的id创建一次记录，只需要在启动的时候做一次。

  api.${functional ? 'rerender' : 'reload'}('${id}', component.options):
    如果一个组件只是修改了 template 或是 render 函数，只要把所有相关的实例重新渲染一遍就可以了，而不需要销毁重建他们。这样就可以完整的保持应用的当前状态。
    这是因为template被编译成立新的无副作用的渲染函数。

    如果一个组件更改了除 template或 render 之外的选项，就需要整个重新加载。这将销毁并重建整个组件（包括子组件）。
    这是因为script或者custom block里可能包含带有副作用的生命周期钩子，只有重新加载才能保证组件行为的一致性。

    style会通过vue-style-loader自行热重载，所以它不会影响应用的状态。
*/
exports.genHotReloadCode = (id, functional, templateRequest) => {
  return `
/* hot reload */
if (module.hot) {
  var api = require(${hotReloadAPIPath})
  api.install(require('vue'))
  if (api.compatible) {
    module.hot.accept()
    if (!module.hot.data) {
      api.createRecord('${id}', component.options)
    } else {
      api.${functional ? 'rerender' : 'reload'}('${id}', component.options)
    }
    ${templateRequest ? genTemplateHotReloadCode(id, templateRequest) : ''}
  }
}
  `.trim()
}
