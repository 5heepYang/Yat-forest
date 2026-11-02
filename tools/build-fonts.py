# -*- coding: utf-8 -*-
"""
字体子集化工具

为什么需要它：
  原始 HarmonyOS Sans SC 两个字重共 15.7 MB，超过微信小程序主包 2 MB 的限制，
  直接打包会编译失败。小程序里实际用到的字符只有一千多个，切成子集后约 500 KB。

什么时候需要重跑：
  队友新增了文案，出现了新字。子集里没有的字会自动回退到系统字体（不会显示方块），
  但视觉上会和设计稿略有差异。想保持统一就重跑一次。

用法：
  pip install fonttools
  python tools/build-fonts.py

依赖的原始字体放在 assets-src/fonts/（不进包），产物写到 static/fonts/。
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIR = os.path.join(ROOT, 'assets-src', 'fonts')
OUT_DIR = os.path.join(ROOT, 'static', 'fonts')

SKIP_DIRS = {'static', 'node_modules', '.git', 'assets-src', 'tools'}

# 常用兜底汉字：队友加的新文案尽量能覆盖到，减少重跑次数
FALLBACK = (
    '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感'
    '见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许先口由死安写性马光白或住难望教命花结乐色更拉东神记处让母父应直字场平报友关放至张认接告入笑内英军候民岁往何度山觉路带万男边风解叫任金快原吃妈变通师立象数四失满战远格士音轻目条呢病始达深完今提求清王化空业思切怎非找片罗钱吗语元喜曾离飞科言干流欢约各即指合反题必该论交终林请医晚制球决传画保读运及则房早院量苦火布品近坐产答星精视五连司巴奇管类未朋且婚台夜青北队久乎越观落尽形影红爸百令周吧识步希亚术留市半热送兴造谈容极随演收首根讲整式取照办强石古华拿计您装似足双妻尼转诉米称丽客南领节衣站黑刻统断福城故历惊脸选包紧争另建维绝树系伤示愿持千史谁准联妇纪基买志静阿诗独复痛消社算义竟确酒需单治卡幸兰念举仅钟怕共毛句息功官待究跟穿室易游程号居考突皮哪费倒价图具刚脑永歌响商礼细专黄块脚味灵改据般破引食仍存众注笔甚某沉血备习校默务土微娘须试怀料调广苏显赛查密议底列富梦错座参八除跑亮假印设线温虽掉京初养香停际致阳纸李纳验助激够严证帝饭忘趣支春集丈木研班普导顿睡展跳获艺六波察群皇段急庭创区奥器谢弟店否害草排背止组州朝封睛板角况曲馆育忙质河续哥呼若推境遇雨标姐充围案伦护冷警贝著雪索剧啊船险烟依斗值帮汉慢佛肯闻唱沙局伯族低玩资屋击速顾泪洲团圣旁堂兵七露园牛哭旅街劳型烈姑陈莫鱼异抱宝权鲁简态级票怪寻杀律胜份汽右洋范床舞秘午登楼贵吸责例追较职属渐左录丝牙党继托赶章智冲叶胡吉卖坚喝肉遗救修松临藏担戏善卫药悲敢靠伊村戴词森耳差短祖云规窗散迷油旧适乡架恩投弹铁博雷府压超负勒杂醒洗采毫嘴毕九冰既状乱景席珍童顶派素脱农疑练野按犯拍征坏骨余承置臂彩灯巨琴免环姆暗换技翻束增忍餐洛塞缺忆判欧层付阵玛批岛项狗休懂武革良恶恋委拥娜妙探呀营退摇弄桌熟诺宣银势奖宫忽套康供优课鸟喊降夏困刘罪亡鞋健模败伴守挥鲜财孤枪禁恐伙杰迹妹遍盖副坦牌江顺秋萨菜划授归浪凡预奶雄升编典袋莱含盛济蒙棋端腿招释介烧误'
)


def collect_chars():
    chars = set()

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.endswith(('.wxml', '.js', '.json', '.wxss')):
                continue
            try:
                with open(os.path.join(dirpath, fn), encoding='utf-8') as f:
                    text = f.read()
            except Exception:
                continue
            for ch in text:
                if ord(ch) > 127:
                    chars.add(ch)

    for i in range(32, 127):
        chars.add(chr(i))

    for ch in '，。、；：？！“”‘’（）《》【】〈〉—…·～＋－×÷％＃＠＆＊￥':
        chars.add(ch)

    for ch in FALLBACK:
        chars.add(ch)

    return ''.join(sorted(chars))


def main():
    try:
        import fontTools  # noqa: F401
    except ImportError:
        print('缺少 fonttools，先执行： pip install fonttools')
        sys.exit(1)

    if not os.path.isdir(SRC_DIR):
        print('找不到原始字体目录：' + SRC_DIR)
        print('请把 hy-regular.ttf / hy-bold.ttf 放进去（约 7.8MB 一个）。')
        sys.exit(1)

    text = collect_chars()
    tmp = os.path.join(HERE, '.chars.txt')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    print('字符集：%d 个（汉字 %d 个）' % (
        len(text), sum(1 for c in text if '\u4e00' <= c <= '\u9fff')))

    os.makedirs(OUT_DIR, exist_ok=True)

    for name in ['hy-regular.ttf', 'hy-bold.ttf']:
        src = os.path.join(SRC_DIR, name)
        if not os.path.isfile(src):
            print('跳过（不存在）：' + name)
            continue
        dst = os.path.join(OUT_DIR, name)
        cmd = [sys.executable, '-m', 'fontTools.subset', src,
               '--text-file=' + tmp, '--output-file=' + dst, '--no-hinting']
        print('子集化 ' + name + ' ...')
        subprocess.run(cmd, check=True)
        print('   %.0f KB -> %s' % (os.path.getsize(dst) / 1024, dst))

    os.remove(tmp)
    print('完成。重新编译小程序即可生效。')


if __name__ == '__main__':
    main()
