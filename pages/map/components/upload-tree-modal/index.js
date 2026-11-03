/**
 * 新增树木弹窗
 *
 * 表单：名称* / 树种* / 现场照片*（wx.chooseMedia）/ 位置（当前地图中心，页面传入）/ 描述。
 * 组件内管表单状态和必填校验，校验通过把字段抛 submit 事件给页面入库。
 * 每次打开时重置表单，避免上一次的草稿残留。
 */
const { toast } = require('../../../../common/util')

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    show: {
      type: Boolean,
      value: false
    },
    /** 新增点位坐标：{ latitude, longitude }，取打开弹窗时的地图中心 */
    location: {
      type: Object,
      value: null
    }
  },

  data: {
    name: '',
    species: '',
    image: '',
    description: '',
    render: false,
    anim: false
  },

  observers: {
    'show': function (show) {
      if (show) {
        // 每次打开重置表单，然后先挂载再下一拍挂过渡类，实现上滑 + 淡入
        this.setData({ name: '', species: '', image: '', description: '', render: true })
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
    onClose() {
      this.triggerEvent('close')
    },

    onNameInput(e) {
      this.setData({ name: e.detail.value })
    },

    onSpeciesInput(e) {
      this.setData({ species: e.detail.value })
    },

    onDescInput(e) {
      this.setData({ description: e.detail.value })
    },

    /** 拍摄或从相册选择现场照片，选完直接预览 */
    onChooseImage() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const f = res.tempFiles[0]
          if (f) this.setData({ image: f.tempFilePath })
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
      const name = this.data.name.replace(/^\s+|\s+$/g, '')
      const species = this.data.species.replace(/^\s+|\s+$/g, '')

      if (name === '') {
        toast('请填写树木名称')
        return
      }
      if (species === '') {
        toast('请填写树种')
        return
      }
      if (this.data.image === '') {
        toast('请先拍摄或选择现场照片')
        return
      }

      this.triggerEvent('submit', {
        name: name,
        species: species,
        image: this.data.image,
        description: this.data.description.replace(/^\s+|\s+$/g, '')
      })
    }
  }
})
