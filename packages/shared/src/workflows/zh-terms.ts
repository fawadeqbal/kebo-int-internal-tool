/**
 * Words people pick or type that have one Chinese (25 Nov 2026): units, how goods are packed, ports and
 * countries. The papers in English + 中文 print them beside the English; the translator (part of the server)
 * takes them as its glossary, so the same word always comes out the same.
 */

/** Units, by their lower-case English (singular and plural). */
const UNITS: Record<string, string> = {
  pc: "件",
  pcs: "件",
  piece: "件",
  pieces: "件",
  set: "套",
  sets: "套",
  unit: "台",
  units: "台",
  machine: "台",
  machines: "台",
  lot: "批",
  lots: "批",
  pair: "双",
  pairs: "双",
  box: "盒",
  boxes: "盒",
  carton: "箱",
  cartons: "箱",
  case: "箱",
  cases: "箱",
  roll: "卷",
  rolls: "卷",
  bag: "袋",
  bags: "袋",
  drum: "桶",
  drums: "桶",
  kg: "千克",
  kgs: "千克",
  g: "克",
  ton: "吨",
  tons: "吨",
  mt: "吨",
  m: "米",
  meter: "米",
  meters: "米",
  metre: "米",
  metres: "米",
  m2: "平方米",
  sqm: "平方米",
  m3: "立方米",
  cbm: "立方米",
  l: "升",
  liter: "升",
  liters: "升",
  litre: "升",
  litres: "升",
  ml: "毫升",
  sheet: "张",
  sheets: "张",
  bottle: "瓶",
  bottles: "瓶",
  pallet: "托",
  pallets: "托",
  job: "项",
  service: "项",
  lump: "项",
  "lump sum": "项",
};

/** How goods are packed and other shipping words (lower case). */
const WORDS: Record<string, string> = {
  carton: "纸箱",
  cartons: "纸箱",
  "wooden case": "木箱",
  "wooden cases": "木箱",
  "wooden box": "木箱",
  "plywood case": "胶合板箱",
  "plywood box": "胶合板箱",
  "fumigated wooden case": "熏蒸木箱",
  "fumigated solid wooden case": "熏蒸实木箱",
  "fumigated solid wooden case (ippc)": "熏蒸实木箱（IPPC）",
  "fumigation-free wooden case": "免熏蒸木箱",
  "steel frame": "钢架",
  "steel crate": "钢架箱",
  crate: "木条箱",
  "wooden crate": "木条箱",
  pallet: "托盘",
  "wooden pallet": "木托盘",
  bundle: "捆",
  "nude packing": "裸装",
  "in bulk": "散装",
  bag: "袋",
  drum: "桶",
  roll: "卷",
  container: "集装箱",
  "20gp": "20尺普柜",
  "40gp": "40尺普柜",
  "40hq": "40尺高柜",
  lcl: "拼箱",
  fcl: "整箱",
  // ports and cities people ship from and to
  qingdao: "青岛",
  "qingdao port": "青岛港",
  shanghai: "上海",
  "shanghai port": "上海港",
  ningbo: "宁波",
  "ningbo port": "宁波港",
  tianjin: "天津",
  "tianjin port": "天津港",
  "tianjin xingang": "天津新港",
  xingang: "新港",
  shenzhen: "深圳",
  shekou: "蛇口",
  yantian: "盐田",
  guangzhou: "广州",
  huangpu: "黄埔",
  nansha: "南沙",
  xiamen: "厦门",
  dalian: "大连",
  lianyungang: "连云港",
  rizhao: "日照",
  yantai: "烟台",
  weihai: "威海",
  jining: "济宁",
  jinan: "济南",
  shandong: "山东",
  beijing: "北京",
  "hong kong": "香港",
  karachi: "卡拉奇",
  "karachi port": "卡拉奇港",
  "port qasim": "卡西姆港",
  "port muhammad bin qasim": "卡西姆港",
  lahore: "拉合尔",
  islamabad: "伊斯兰堡",
  faisalabad: "费萨拉巴德",
  sialkot: "锡亚尔科特",
  peshawar: "白沙瓦",
  "dry port lahore": "拉合尔陆港",
  dubai: "迪拜",
  "jebel ali": "杰贝阿里",
  chittagong: "吉大港",
  dhaka: "达卡",
  colombo: "科伦坡",
  "nhava sheva": "那瓦舍瓦",
  mumbai: "孟买",
  "bandar abbas": "阿巴斯港",
  jeddah: "吉达",
  dammam: "达曼",
  mombasa: "蒙巴萨",
  "dar es salaam": "达累斯萨拉姆",
  lagos: "拉各斯",
  durban: "德班",
  alexandria: "亚历山大",
  istanbul: "伊斯坦布尔",
  tashkent: "塔什干",
  almaty: "阿拉木图",
  kabul: "喀布尔",
  "port klang": "巴生港",
  singapore: "新加坡",
  "ho chi minh": "胡志明",
  jakarta: "雅加达",
  manila: "马尼拉",
  bangkok: "曼谷",
  "laem chabang": "林查班",
  // the machines and parts people quote (pharmaceutical and packing lines): the names the trade uses
  blister: "泡罩",
  "blister packer": "泡罩包装机",
  "blister foil": "泡罩铝箔",
  "blister packing machine": "泡罩包装机",
  "blister machine": "泡罩包装机",
  "cartoning machine": "装盒机",
  "cartoner": "装盒机",
  "filling machine": "灌装机",
  "filling line": "灌装生产线",
  "production line": "生产线",
  "complete line": "整线",
  "juice line": "果汁生产线",
  "liquid filling machine": "液体灌装机",
  "powder filling machine": "粉末灌装机",
  // The words of the client's own packing list (Vision Pharmaceuticals, 25 Nov 2026) where they differ.
  "capping machine": "封盖机",
  "vial capping machine": "小瓶封盖机",
  "complete set": "全套",
  "ffu unit": "FFU单元",
  "unit and accessories": "单元及附件",
  "labeling machine": "贴标机",
  "labelling machine": "贴标机",
  "tablet press": "压片机",
  "rotary tablet press": "旋转式压片机",
  "capsule filling machine": "胶囊填充机",
  "coating machine": "包衣机",
  "granulator": "制粒机",
  "fluid bed dryer": "流化床干燥机",
  "mixer": "混合机",
  "v mixer": "V型混合机",
  "mill": "粉碎机",
  "sieve": "筛分机",
  "washing machine": "洗瓶机",
  "bottle washing machine": "洗瓶机",
  "tunnel": "隧道",
  "sterilizing tunnel": "灭菌隧道",
  "autoclave": "灭菌柜",
  "clean room": "洁净室",
  "ffu": "FFU",
  "laminar air flow": "层流罩",
  "conveyor": "输送机",
  "ampoule": "安瓿",
  "ampoules": "安瓿",
  vial: "小瓶",
  vials: "小瓶",
  "syrup": "糖浆",
  "ointment": "软膏",
  "heads": "头",
  "nozzles": "灌装嘴",
  "spare parts": "备件",
  "accessories": "附件",
  "mould": "模具",
  "moulds": "模具",
  "mold": "模具",
  "change parts": "更换件",
  "stainless steel": "不锈钢",
  "ss304": "SS304不锈钢",
  "ss316l": "SS316L不锈钢",
  "plc": "PLC",
  "hmi": "触摸屏",
  "touch screen": "触摸屏",
  "servo motor": "伺服电机",
  "capacity": "产能",
  "power": "功率",
  "voltage": "电压",
  "weight": "重量",
  "dimensions": "外形尺寸",
  "installation": "安装",
  "commissioning": "调试",
  "training": "培训",
  // trade words
  "lc": "信用证",
  "l/c": "信用证",
  "letter of credit": "信用证",
  "irrevocable lc at sight": "不可撤销即期信用证",
  "irrevocable letter of credit at sight": "不可撤销即期信用证",
  "letter of credit at sight": "即期信用证",
  "at sight": "即期",
  "t/t": "电汇",
  "telegraphic transfer": "电汇",
  "deposit": "定金",
  "advance": "预付款",
  "balance": "余款",
  "before shipment": "发货前",
  "against the shipping documents": "凭装运单据",
  "bill of lading": "提单",
  "b/l": "提单",
  "shipping marks": "唛头",
  "partial shipment": "分批装运",
  "transshipment": "转运",
  "warranty": "质保",
  "lead time": "交货期",
  "working days": "工作日",
  "after receiving the deposit": "收到定金后",
  "any chinese port": "中国任意港口",
  "any port in china": "中国任意港口",
  "china main port": "中国主要港口",
  "main port of china": "中国主要港口",
  port: "港",
  airport: "机场",
};

const key = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** A unit's Chinese (sets → 套), or null. */
export const zhUnit = (unit: string | null | undefined): string | null => (unit ? (UNITS[key(unit).replace(/\.$/, "")] ?? null) : null);

let byName: Map<string, string> | null = null;
/** Every country's English name (and its code) to its Chinese name, from the runtime's own list. */
function countries(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  try {
    const en = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    const zh = new Intl.DisplayNames(["zh-Hans"], { type: "region", fallback: "none" });
    const A = 65;
    for (let i = 0; i < 26; i++)
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        const name = en.of(code);
        const cn = zh.of(code);
        if (!name || !cn || name === code) continue;
        byName.set(code.toLowerCase(), cn);
        byName.set(key(name), cn);
      }
    // The names people also write.
    for (const [n, code] of [
      ["china (mainland)", "CN"],
      ["p.r. china", "CN"],
      ["prc", "CN"],
      ["uae", "AE"],
      ["u.a.e.", "AE"],
      ["usa", "US"],
      ["u.s.a.", "US"],
      ["uk", "GB"],
      ["turkey", "TR"],
    ] as const) {
      const cn = zh.of(code);
      if (cn) byName.set(n, cn);
    }
  } catch {
    // No region names in this runtime: countries print in English only.
  }
  return byName;
}

/** A country's Chinese, by its two-letter code or its English name (PK, Pakistan → 巴基斯坦), or null. */
export const zhCountry = (country: string | null | undefined): string | null => (country ? (countries().get(key(country)) ?? null) : null);

/** A word or a place with one Chinese (Wooden case, Qingdao, Pakistan), or null. */
export function zhTerm(text: string | null | undefined): string | null {
  if (!text) return null;
  const k = key(text).replace(/[.;]$/, "");
  return WORDS[k] ?? zhCountry(k) ?? null;
}

/**
 * A place as typed, part by part ("Qingdao, China" → 青岛，中国; "Karachi Port, Pakistan" → 卡拉奇港，巴基斯坦):
 * null unless every part is known (then it prints in English only, until the translator has it).
 */
export function zhPlace(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const whole = zhTerm(text);
  if (whole) return whole;
  const parts = text.split(/\s*[,，/]\s*/).filter(Boolean);
  if (parts.length < 2) {
    // "Karachi Port": the place, then the word.
    const m = /^(.+?)\s+(port|airport)$/i.exec(text.trim());
    const place = m && zhTerm(m[1]);
    return place ? `${place}${WORDS[m![2]!.toLowerCase()]}` : null;
  }
  const zh = parts.map((p) => zhPlace(p));
  return zh.every(Boolean) ? zh.join("，") : null;
}

/** The glossary the translator keeps to (English → Chinese), the words above. */
export const ZH_GLOSSARY: Readonly<Record<string, string>> = WORDS;
