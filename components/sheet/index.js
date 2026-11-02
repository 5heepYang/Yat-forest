/**
 * 统一底部弹层
 *
 * 用法：
 *   <sheet show="{{showSheet}}" title="标题" subtitle="副标题" bind:close="closeSheet">
 *     <view class="hint-box"><text class="hint-t">内容</text></view>
 *     <view class="sheet-btn sheet-btn-main" bindtap="onConfirm">
 *       <text class="sheet-btn-t sheet-btn-t-white">确定</text>
 *     </view>
 *   </sheet>
 *
 * .sheet-btn / .hint-box 这些通用样式在 app.wxss 里，任何页面都能直接用，
 * 不要再各写一套按钮样式。
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
    /** 主标题，传空则不渲染头部 */
    title: {
      type: String,
      value: ''
    },
    /** 副标题 */
    subtitle: {
      type: String,
      value: ''
    },
    /** 点遮罩是否关闭 */
    closeOnMask: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onMaskTap() {
      if (this.data.closeOnMask) {
        this.triggerEvent('close')
      }
    },

    /** 阻止弹层内部点击冒泡到遮罩 */
    noop() {}
  }
})
