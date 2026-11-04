/**
 * 新增树木弹窗（表单态 + 识别结果态）
 *
 * 表单只有：名称* / 现场照片* / 位置* / 树龄（选填）/ 描述（选填）。
 * 树种不再让用户填 —— 提交后由 AI 看照片识别，结果直接出现在同一张卡片里，
 * 也就是"生成树卡片给出树的品种"。
 *
 * 位置只有一个来源：用户先在地图上点选位置，页面带着坐标打开本弹窗。
 * 所以位置区只读展示，组件不再提供"去地图点选"入口。
 *
 * 为了取消/重开弹窗时不丢草稿，表单状态由页面持有：
 * 组件每次输入抛 draftchange，页面存下来再通过 draft 属性回灌，
 * 名称、树龄、照片都还在。
 */
const { toast } = require('../../../../common/util')

function trim(s) {
  return String(s || '').replace(/^\s+|\s+$/g, '')
}

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    show: {
      type: Boolean,
      value: false
    },
    /** 新增点位坐标：{ latitude, longitude } */
    location: {
      type: Object,
      value: null
    },
    /** 页面持有的表单草稿，选点往返时用它回灌 */
    draft: {
      type: Object,
      value: null
    },
    /**
     * 识别结果：null = 表单态。
     * { ok, name, image, species, age, aiDown, reason }
     */
    result: {
      type: Object,
      value: null
    }
  },

  data: {
    name: '',
    age: '',
    image: '',
    description: '',
    locationText: '',
    render: false,
    anim: false
  },

  observers: {
    'location': function (loc) {
      if (!loc) {
        this.setData({ locationText: '' })
        return
      }
      this.setData({
        locationText: Number(loc.latitude).toFixed(6) + ' , ' + Number(loc.longitude).toFixed(6)
      })
    },

    'show': function (show) {
      if (show) {
        const d = this.data.draft || {}
        this.setData({
          name: d.name || '',
          age: d.age || '',
          image: d.image || '',
          description: d.description || '',
          render: true
        })
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
    /** 把当前表单抛给页面保存，避免选点回来丢内容 */
    emitDraft() {
      this.triggerEvent('draftchange', {
        name: this.data.name,
        age: this.data.age,
        image: this.data.image,
        description: this.data.description
      })
    },

    onClose() {
      this.triggerEvent('close')
    },

    /** 点遮罩：结果态直接关（已经落库了），表单态等同取消 */
    onMaskTap() {
      if (this.data.result) {
        this.triggerEvent('resultclose')
        return
      }
      this.triggerEvent('close')
    },

    onNameInput(e) {
      this.setData({ name: e.detail.value })
      this.emitDraft()
    },

    onAgeInput(e) {
      this.setData({ age: e.detail.value })
      this.emitDraft()
    },

    onDescInput(e) {
      this.setData({ description: e.detail.value })
      this.emitDraft()
    },

    /** 拍摄或从相册选择现场照片，选完直接预览 */
    onChooseImage() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const f = res.tempFiles[0]
          if (f) {
            this.setData({ image: f.tempFilePath })
            this.emitDraft()
          }
        },
        fail: (e) => {
          // 用户取消不提示；其它失败给统一 Toast
          if (e && e.errMsg && e.errMsg.indexOf('cancel') === -1) {
            toast('选择照片失败，请重试')
          }
        }
      })
    },

    onSubmit() {
      const name = trim(this.data.name)

      if (name === '') {
        toast('请先给它起个名字')
        return
      }
      if (this.data.image === '') {
        toast('请先拍摄或选择现场照片')
        return
      }
      if (!this.data.location) {
        toast('请先确认树木位置')
        return
      }

      this.triggerEvent('submit', {
        name: name,
        age: trim(this.data.age),
        image: this.data.image,
        description: trim(this.data.description)
      })
    },

    /** 结果卡片：关闭 */
    onResultClose() {
      this.triggerEvent('resultclose')
    },

    /** 结果卡片：没认出来，回表单重拍 */
    onRetake() {
      this.triggerEvent('retake')
    }
  }
})
