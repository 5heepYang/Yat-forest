/**
 * 地图顶部悬浮区：搜索框 + 筛选 Tab
 *
 * 搜索输入即时报 keywordchange（不过滤本身由页面做，方便与筛选 Tab 叠加），
 * 样式隔离用 apply-shared（与 components/sheet 一致），
 * 页面通过宿主 class（.float-top）控制悬浮定位。
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 筛选项：[{ key, label }] */
    filters: {
      type: Array,
      value: []
    },
    /** 当前选中的筛选 key */
    active: {
      type: String,
      value: 'all'
    },
    /** 搜索关键词（受控，页面持有） */
    keyword: {
      type: String,
      value: ''
    }
  },

  methods: {
    onInput(e) {
      this.triggerEvent('keywordchange', { keyword: e.detail.value })
    },

    onFilterTap(e) {
      this.triggerEvent('filterchange', { key: e.currentTarget.dataset.key })
    }
  }
})
