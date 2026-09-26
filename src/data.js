// 《租赁大亨》静态数据：机型、航司、棋盘、事件卡。纯数据，无 DOM。
(function (root) {
  const LT = (root.LT = root.LT || {});

  // 评级阶梯：0=A 1=BBB 2=BB 3=B 4=CCC；D=违约重组中；X=制裁
  const RATINGS = ['A', 'BBB', 'BB', 'B', 'CCC'];
  const CREDIT = {
    // LRF 信用溢价、季度违约概率（正常周期）、SLB 出售意愿
    prem: [-0.06, 0, 0.06, 0.13, 0.22],
    pd: [0.001, 0.003, 0.008, 0.02, 0.045],
    // 二手交易平台带租约出售时，买方对信用的价格调整
    bid: [0.04, 0.02, 0, -0.04, -0.08],
  };

  const CYCLES = [
    { id: 'boom', name: '繁荣', lrf: 1.06, pd: 0.6, spread: -0.0025, drift: 0.008, ext: 0.15, up: 0.25, down: 0.06 },
    { id: 'normal', name: '平稳', lrf: 1.0, pd: 1.0, spread: 0, drift: 0.0, ext: 0, up: 0.12, down: 0.12 },
    { id: 'down', name: '下行', lrf: 0.95, pd: 1.6, spread: 0.0075, drift: -0.012, ext: -0.1, up: 0.06, down: 0.25 },
    { id: 'crisis', name: '危机', lrf: 0.88, pd: 2.5, spread: 0.0175, drift: -0.03, ext: -0.2, up: 0.03, down: 0.4 },
  ];
  // 每季度周期转移概率 [boom, normal, down, crisis]
  const CYCLE_TRANS = [
    [0.85, 0.13, 0.02, 0.0],
    [0.07, 0.86, 0.07, 0.0],
    [0.0, 0.14, 0.8, 0.06],
    [0.0, 0.05, 0.3, 0.65],
  ];

  // newPrice: 新机市场价值 $m；k: 年化价值衰减；age0: 二手机初始机龄；lrf: 月租金率因子
  const TYPES = {
    A320N: { name: 'A320neo', cat: 'NB', oem: 'airbus', newPrice: 52, k: 0.035, age0: 0, lrf: 0.0075, engines: ['LEAP-1A', 'PW1100G'], mr: 0.15, msn: [10200, 12600] },
    A321N: { name: 'A321neo', cat: 'NB', oem: 'airbus', newPrice: 62, k: 0.035, age0: 0, lrf: 0.0074, engines: ['LEAP-1A', 'PW1100G'], mr: 0.15, msn: [10200, 12600] },
    B38M: { name: '737 MAX 8', cat: 'NB', oem: 'boeing', newPrice: 50, k: 0.036, age0: 0, lrf: 0.0076, engines: ['LEAP-1B'], mr: 0.15, msn: [60100, 68900] },
    C919: { name: 'C919', cat: 'NB', oem: 'comac', newPrice: 50, k: 0.05, age0: 0, lrf: 0.0079, engines: ['LEAP-1C'], mr: 0.15, msn: [10010, 10300] },
    E295: { name: 'E195-E2', cat: 'RJ', oem: 'embraer', newPrice: 40, k: 0.045, age0: 0, lrf: 0.0082, engines: ['PW1900G'], mr: 0.15, msn: [19020001, 19020400] },
    AT76: { name: 'ATR 72-600', cat: 'TP', oem: null, newPrice: 25, k: 0.04, age0: 0, lrf: 0.0088, engines: ['PW127M'], mr: 0.18, msn: [1500, 1750] },
    A339: { name: 'A330-900', cat: 'WB', oem: 'airbus', newPrice: 110, k: 0.045, age0: 0, lrf: 0.0068, engines: ['Trent 7000'], mr: 0.12, msn: [1800, 2300] },
    B789: { name: '787-9', cat: 'WB', oem: 'boeing', newPrice: 135, k: 0.045, age0: 0, lrf: 0.0066, engines: ['GEnx-1B', 'Trent 1000'], mr: 0.12, msn: [62000, 67500] },
    A359: { name: 'A350-900', cat: 'WB', oem: 'airbus', newPrice: 145, k: 0.044, age0: 0, lrf: 0.0064, engines: ['Trent XWB-84'], mr: 0.12, msn: [400, 780] },
    B738: { name: '737-800', cat: 'NB', oem: 'boeing', newPrice: 50, k: 0.051, age0: 14, lrf: 0.0105, engines: ['CFM56-7B'], mr: 0.2, msn: [38000, 41900] },
    A20C: { name: 'A320ceo', cat: 'NB', oem: 'airbus', newPrice: 50, k: 0.047, age0: 13, lrf: 0.01, engines: ['CFM56-5B', 'V2527-A5'], mr: 0.2, msn: [5400, 6300] },
    B77W: { name: '777-300ER', cat: 'WB', oem: 'boeing', newPrice: 160, k: 0.0846, age0: 12, lrf: 0.0098, engines: ['GE90-115B'], mr: 0.18, msn: [42000, 44600] },
  };
  const NEW_TYPES = ['A320N', 'A321N', 'B38M', 'C919', 'E295', 'AT76', 'A339', 'B789', 'A359'];
  const GTF = ['PW1100G', 'PW1900G'];

  // 区域（= 大富翁颜色组），fee: 竞标失败成本的区域系数
  const GROUPS = {
    AF: { name: '非洲', fee: 1.0 },
    LA: { name: '拉美', fee: 1.1 },
    EA: { name: '欧亚', fee: 1.2 },
    IN: { name: '印度', fee: 1.3 },
    SE: { name: '东南亚', fee: 1.4 },
    CN: { name: '中国', fee: 1.5 },
    EU: { name: '欧洲', fee: 1.6 },
    NA: { name: '北美', fee: 1.8 },
    ME: { name: '中东', fee: 2.0 },
  };

  // rating: RATINGS 下标；cap: 单一出租人可在该航司放置的飞机上限
  const AIRLINES = {
    KQ: { name: 'Kenya Airways', cn: '肯尼亚航空', g: 'AF', rating: 3, cap: 3, types: ['B38M', 'E295', 'B789', 'B738'] },
    ET: { name: 'Ethiopian', cn: '埃塞俄比亚航空', g: 'AF', rating: 2, cap: 4, types: ['B38M', 'A359', 'B789', 'AT76'] },
    AV: { name: 'Avianca', cn: '哥伦比亚航空', g: 'LA', rating: 3, cap: 3, types: ['A320N', 'A20C'] },
    AM: { name: 'Aeroméxico', cn: '墨西哥航空', g: 'LA', rating: 2, cap: 3, types: ['B38M', 'B789', 'B738'] },
    LA: { name: 'LATAM', cn: '南美航空', g: 'LA', rating: 2, cap: 4, types: ['A320N', 'A321N', 'B789'] },
    SU: { name: 'Aeroflot', cn: '俄罗斯航空', g: 'EA', rating: 2, cap: 4, types: ['A320N', 'A321N', 'A20C', 'B77W'], sanctionRisk: true },
    PC: { name: 'Pegasus', cn: '飞马航空', g: 'EA', rating: 2, cap: 4, types: ['A320N', 'A321N'] },
    TK: { name: 'Turkish Airlines', cn: '土耳其航空', g: 'EA', rating: 1, cap: 5, types: ['A321N', 'B38M', 'A359', 'B789'] },
    SG: { name: 'SpiceJet', cn: '香料航空', g: 'IN', rating: 4, cap: 3, types: ['B38M', 'B738'] },
    AI: { name: 'Air India', cn: '印度航空', g: 'IN', rating: 2, cap: 5, types: ['A320N', 'A321N', 'A359', 'B789', 'B77W'] },
    '6E': { name: 'IndiGo', cn: '靛蓝航空', g: 'IN', rating: 1, cap: 6, types: ['A320N', 'A321N', 'AT76'] },
    GA: { name: 'Garuda Indonesia', cn: '印尼鹰航', g: 'SE', rating: 4, cap: 3, types: ['A339', 'B38M', 'B77W', 'B738'] },
    VJ: { name: 'VietJet', cn: '越捷航空', g: 'SE', rating: 3, cap: 4, types: ['A321N', 'A339', 'B38M'] },
    AK: { name: 'AirAsia', cn: '亚洲航空', g: 'SE', rating: 3, cap: 4, types: ['A320N', 'A321N'] },
    MU: { name: 'China Eastern', cn: '东方航空', g: 'CN', rating: 0, cap: 5, types: ['A320N', 'A321N', 'C919', 'A359', 'B789'] },
    CZ: { name: 'China Southern', cn: '南方航空', g: 'CN', rating: 0, cap: 5, types: ['A320N', 'A321N', 'C919', 'B38M', 'B789'] },
    CA: { name: 'Air China', cn: '中国国航', g: 'CN', rating: 0, cap: 5, types: ['A320N', 'A321N', 'C919', 'A359', 'B77W'] },
    W6: { name: 'Wizz Air', cn: '维兹航空', g: 'EU', rating: 2, cap: 5, types: ['A321N'], engine: 'PW1100G' },
    LH: { name: 'Lufthansa', cn: '汉莎航空', g: 'EU', rating: 1, cap: 5, types: ['A320N', 'A321N', 'A359', 'B789'] },
    FR: { name: 'Ryanair', cn: '瑞安航空', g: 'EU', rating: 0, cap: 6, types: ['B38M'] },
    AA: { name: 'American Airlines', cn: '美国航空', g: 'NA', rating: 2, cap: 6, types: ['A321N', 'B38M', 'B789', 'A20C', 'B738'] },
    UA: { name: 'United Airlines', cn: '美联航', g: 'NA', rating: 2, cap: 6, types: ['A321N', 'B38M', 'B789'] },
    DL: { name: 'Delta Air Lines', cn: '达美航空', g: 'NA', rating: 1, cap: 6, types: ['A321N', 'A339', 'A359', 'A20C'] },
    QR: { name: 'Qatar Airways', cn: '卡塔尔航空', g: 'ME', rating: 0, cap: 5, types: ['A359', 'B77W', 'B789', 'B38M'] },
    EK: { name: 'Emirates', cn: '阿联酋航空', g: 'ME', rating: 0, cap: 5, types: ['B77W', 'A359', 'B789'] },
  };

  const OEMS = {
    airbus: { name: 'Airbus', cn: '空客', slots: 4, price: 8 },
    boeing: { name: 'Boeing', cn: '波音', slots: 4, price: 8 },
    comac: { name: 'COMAC', cn: '中国商飞', slots: 3, price: 4.5 },
    embraer: { name: 'Embraer', cn: '巴航工业', slots: 3, price: 4 },
  };
  const ENGINES = {
    cfm: { name: 'CFM International', cn: 'CFM 备发平台', price: 15, income: 0.5 },
    pw: { name: 'Pratt & Whitney', cn: '普惠备发平台', price: 15, income: 0.5 },
  };

  // 44 格棋盘，四角为 0/11/22/33
  const BOARD = [
    { t: 'go', name: '都柏林', sub: '起点 · 季度路演' },
    { t: 'airline', id: 'KQ' },
    { t: 'cc', name: '公司内部' },
    { t: 'airline', id: 'ET' },
    { t: 'tax', id: 'wht', name: '预提税', sub: 'WHT' },
    { t: 'oem', id: 'airbus' },
    { t: 'airline', id: 'AV' },
    { t: 'ch', name: '市场快讯' },
    { t: 'airline', id: 'AM' },
    { t: 'airline', id: 'LA' },
    { t: 'market', name: '二手交易平台', sub: '买卖飞机' },
    { t: 'jail', name: '合规审查', sub: '仅路过' },
    { t: 'airline', id: 'SU' },
    { t: 'engine', id: 'cfm' },
    { t: 'airline', id: 'PC' },
    { t: 'airline', id: 'TK' },
    { t: 'oem', id: 'boeing' },
    { t: 'airline', id: 'SG' },
    { t: 'cc', name: '公司内部' },
    { t: 'airline', id: 'AI' },
    { t: 'airline', id: '6E' },
    { t: 'ch', name: '市场快讯' },
    { t: 'airshow', name: '航展', sub: '远程签约一次' },
    { t: 'airline', id: 'GA' },
    { t: 'ch', name: '市场快讯' },
    { t: 'airline', id: 'VJ' },
    { t: 'airline', id: 'AK' },
    { t: 'oem', id: 'comac' },
    { t: 'airline', id: 'MU' },
    { t: 'airline', id: 'CZ' },
    { t: 'engine', id: 'pw' },
    { t: 'airline', id: 'CA' },
    { t: 'cc', name: '公司内部' },
    { t: 'gotojail', name: 'KYC 触发', sub: '前往合规审查' },
    { t: 'airline', id: 'W6' },
    { t: 'airline', id: 'LH' },
    { t: 'airline', id: 'FR' },
    { t: 'oem', id: 'embraer' },
    { t: 'airline', id: 'AA' },
    { t: 'airline', id: 'UA' },
    { t: 'airline', id: 'DL' },
    { t: 'airline', id: 'QR' },
    { t: 'tax', id: 'ins', name: '保险续保', sub: 'Contingent Hull' },
    { t: 'airline', id: 'EK' },
  ];

  // 市场快讯（Chance）与公司内部（Community Chest）；效果在 engine.js 里按 id 实现
  const CHANCE = [
    { id: 'pandemic', title: '全球疫情暴发', text: '周期转入危机；接下来 2 个季度租金延付 50%（之后分期补缴）；全部机型价值 −8%；B 级及以下航司下调一档。' },
    { id: 'sanction', title: '对俄制裁生效', text: '俄罗斯航空（Aeroflot）的全部租赁飞机被扣留无法收回。贷款仍需偿还；保险索赔约 6 个季度后赔付机队价值的 55%。' },
    { id: 'gtf', title: 'GTF 粉末冶金召回', text: '装配 PW1100G / PW1900G 的飞机价值 −10%；大量使用 GTF 的航司（IndiGo、Wizz Air）下调一档。' },
    { id: 'max', title: '737 MAX 停飞', text: '737 MAX 8 价值 −15%；波音交付位冻结 4 个季度。' },
    { id: 'hike', title: '美联储加息 75bp', text: 'SOFR 上升 0.75%。浮动利率贷款成本立刻上升，而固定租金不变。' },
    { id: 'cut', title: '美联储降息 50bp', text: 'SOFR 下降 0.50%。' },
    { id: 'nbshort', title: '窄体机供应紧张', text: '主机厂交付延误，全部窄体机价值 +8%。' },
    { id: 'wbsoft', title: '宽体机需求疲软', text: '长航线复苏放缓，全部宽体机价值 −8%。' },
    { id: '777x', title: '777X 再次延误', text: '777-300ER 延寿需求上升，价值 +12%。' },
    { id: 'oil', title: '油价飙升', text: 'B 级及以下航司全部下调一档；周期有 50% 概率恶化一级。' },
    { id: 'recovery', title: '旅游需求强劲复苏', text: '周期改善一级；每家航司有 35% 概率上调一档。' },
    { id: 'c919', title: 'C919 获 EASA 认证推进', text: 'C919 价值 +10%，流动性改善。' },
    { id: 'restructure', title: '航司重组潮', text: '随机一家 B 级及以下的航司立刻申请破产保护（Chapter 11）。' },
    { id: 'capetown', title: '开普敦公约执行强化', text: '此后所有飞机收回成本减半。' },
    { id: 'delay', title: '主机厂交付延误', text: 'A320neo / A321neo / 737 MAX 8 价值 +6%；每个交付位持有者获赔 $1m / 个。' },
    { id: 'usd', title: '美元大幅走强', text: '非洲、拉美、印度、东南亚的航司各有 40% 概率下调一档。' },
    { id: 'saf', title: '欧盟 SAF 与碳税新规', text: '老旧机型（737-800、A320ceo、777-300ER）价值 −10%。' },
    { id: 'appraisal', title: '评估机构上调残值', text: '全部机型价值 +4%。' },
  ];
  const COMMUNITY = [
    { id: 'rcf', title: '信贷委员会批准扩额', text: '循环信用额度（RCF）增加 $20m。' },
    { id: 'advisory', title: '顾问费收入', text: '为航司做 SLB 结构咨询，收入 $2m。' },
    { id: 'legal', title: '法律纠纷', text: '租约条款争议，律师费 $1.5m。' },
    { id: 'records', title: '技术记录缺失', text: '随机一架自有飞机的 back-to-birth 记录不全，价值 −6%。' },
    { id: 'upgrade', title: '惠誉上调公司评级', text: '此后新增贷款利差 −25bp。' },
    { id: 'downgrade', title: '穆迪下调公司评级', text: '此后新增贷款利差 +25bp。' },
    { id: 'jail', title: '触发 KYC 复核', text: '直接前往合规审查，不经过都柏林。' },
    { id: 'dublin', title: '回都柏林总部述职', text: '前进到都柏林，领取路演收入。' },
    { id: 'poached', title: '同事被挖角', text: '交接与招聘成本 $1m。' },
    { id: 'referral', title: '同行转介客户', text: '下一次签约的成交概率 +15%。' },
    { id: 'dividend', title: '股东要求分红', text: '支付现金的 5%（最多 $5m）。' },
    { id: 'equity', title: '股东增资', text: '获得 $10m 新股本。' },
    { id: 'insurance', title: '保险理赔到账', text: '收到 $1.5m。' },
    { id: 'pass', title: '合规通行证', text: '保留此卡，可免费离开合规审查一次。' },
  ];

  const AI_PROFILES = {
    aercap: { name: 'AerCap', cn: '爱尔开普', minRating: 3, lrfRatio: 0.97, ltv: 0.75, reserve: 10, acceptPremium: 1.05, bold: 0.8 },
    smbc: { name: 'SMBC Aviation Capital', cn: '三井住友航空', minRating: 2, lrfRatio: 1.0, ltv: 0.65, reserve: 20, acceptPremium: 1.15, bold: 0.35 },
    avolon: { name: 'Avolon', cn: '阿沃隆', minRating: 2, lrfRatio: 0.99, ltv: 0.72, reserve: 15, acceptPremium: 1.1, bold: 0.55 },
    boca: { name: 'BOC Aviation', cn: '中银航空租赁', minRating: 2, lrfRatio: 0.98, ltv: 0.7, reserve: 15, acceptPremium: 1.1, bold: 0.6, prefer: 'CN' },
  };

  LT.data = { RATINGS, CREDIT, CYCLES, CYCLE_TRANS, TYPES, NEW_TYPES, GTF, GROUPS, AIRLINES, OEMS, ENGINES, BOARD, CHANCE, COMMUNITY, AI_PROFILES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
