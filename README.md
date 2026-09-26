# 租赁大亨 Lessor Tycoon

飞机租赁版大富翁。你是一家租赁公司的销售，与 AerCap、SMBC Aviation Capital、Avolon、BOC Aviation 等 AI 出租人竞争，向全球 25 家航司出租飞机。10 年后比公司净资产（NAV）。

## 快速开始

直接用浏览器打开 `dist/lessor-tycoon.html`，无需安装。

## 玩法要点

- 每一轮（所有公司各掷一次骰子）= 一个季度
- 落在未被锁定的航司上可以报价签约：选择飞机来源（现货 / SLB / 自有交付位 / 闲置飞机）、机型与发动机、租期、LRF 报价、融资方式（银行 / 无担保 / ECA / 全现金）与 LTV
- 首个签约者成为该航司的主力出租人；对手落在此格需要支付「竞标失败成本」
- 集齐一个区域成为区域主力出租人；主机厂格 = 火车站（交付位订单），发动机格 = 水电公司（备发平台）
- 硬核规则：固定租金 vs 浮动利率、航司评级迁移与违约收回、保证金与 MR、租约到期续租或退租、杠杆契约、18 张市场事件卡

完整规则见游戏内「规则」标签页和 `PLAN.md`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/data.js` | 机型、航司、棋盘、事件卡等静态数据 |
| `src/engine.js` | 规则引擎（纯逻辑、无 DOM、可种子复现） |
| `src/ai.js` | AI 出租人决策 |
| `src/ui.js` · `src/style.css` · `src/index.html` | 界面 |
| `tools/sim.js` | 批量 AI 对局：不变量检查与平衡统计 |
| `tools/build.js` | 内联生成单文件 `dist/` |

## 开发

需要 Node.js 18+，无第三方依赖。

```bash
node tools/sim.js 200            # 200 局 AI 对战测试
HUMAN=1 node tools/sim.js 200    # 包含人类座位专属路径（收购报价、人类破产提前结束）
node tools/build.js              # 重新生成 dist/lessor-tycoon.html 与 dist/artifact.html
```

航司、主机厂与租赁公司名称仅以文字形式用于游戏情境，与相关公司无关联。
