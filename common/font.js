/**
 * 字体：全部使用系统字体栈（苹方 / 系统黑体），
 * 优势：任何汉字（树名、昵称等用户数据）都不会出现字体断层，
 * 且省掉本地字体文件体积。字重通过 font-weight 600/700/800 表达。
 * 保留 loadFonts 作为空实现，避免 app.js 调用处报错。
 */
function loadFonts() {}

module.exports = { loadFonts: loadFonts }
