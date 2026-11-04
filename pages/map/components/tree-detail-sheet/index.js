/**
 * 树木详情底部卡片
 *
 * tree 传页面预先算好的展示对象（decorateSelected 的产物），
 * 组件内不做业务判断，只负责渲染，把按钮 / 关闭事件抛给页面。
 * 点遮罩或右上角关闭按钮都会触发 close。
 *
 * 动画：show 变 true 先渲染（render）再下一拍挂上过渡类（anim），
 * 实现"上滑 + 淡入"；show 变 false 反向过渡完再卸载，
 * 页面只管开关 show，进出都有过渡，不会闪断。
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 是否显示 */
    show: {
      type: Boolean,
      value: false
    },
    /** 展示对象：coverImg/name/species/age/distance/ownerText/growthScore/levelText/
     *  desc/descClass/tagText/tagBg/tagColor/btnText/btnBg/btnColor */
    tree: {
      type: Object,
      value: null
    }
  },

  data: {
    render: false,
    anim: false
  },

  observers: {
    'show': function (show) {
      if (show) {
        this.setData({ render: true })
        wx.nextTick(() => this.setData({ anim: true }))
        return
      }
      if (this.data.render) {
        this.setData({ anim: false })
        if (this._hideTimer) clearTimeout(this._hideTimer)
        this._hideTimer = setTimeout(() => {
          this.setData({ render: false })
        }, 260)
      }
    }
  },

  lifetimes: {
    detached() {
      if (this._hideTimer) clearTimeout(this._hideTimer)
    }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    },

    /** 拍照上报异常：交给页面走 AI 巡检流程 */
    onHazard() {
      this.triggerEvent('hazard')
    },

    /** 看认养人主页 */
    onOwner() {
      this.triggerEvent('owner')
    },

    onClose() {
      this.triggerEvent('close')
    }
  }
})
