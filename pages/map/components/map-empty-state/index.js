/**
 * 地图空状态：筛选 / 搜索没有命中任何树时，在地图中央给出提示，
 * 并提供一键清除筛选和搜索的入口（保证地图不白屏、有出路）。
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onReset() {
      this.triggerEvent('reset')
    }
  }
})
