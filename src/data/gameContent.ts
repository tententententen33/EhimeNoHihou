// 愛媛県 観光スポット・ゲームコンテンツ定義（楽天トラベル「愛媛県のおすすめ観光スポット22選」準拠）
//
// 本モジュールは MVP のサンプル（sampleContent.ts）を置き換える、より本格的な
// ゲーム定義一式を提供する。出典の22スポットを9市町（Region）に分類し、
// 松山市を中心に距離が近い市町から順に解放する「波紋状」のアンロック順序を組む。
//
// 含まれる定義:
// - REGIONS: 9市町。松山を起点に単一チェーンで波紋状に解放（各市町は直前市町の
//   全スポット訪問で解放, allSpotsVisitedInRegion）。
// - SPOTS: 22スポット（実在地に近い概算座標・入場半径・初回訪問報酬）。
// - ITEM_CATALOG: 市町テーマのショップ装備＋ボス限定アイテム＋スポット記念品（中ボスドロップ）。
// - BOSSES: 各市町のボス（Region 紐付け・限定アイテム）＋各スポットの中ボス（Spot 紐付け・確率ドロップ）。
// - TITLES: 市町制覇・名所到達・ボス撃破の称号。
// - QUEST_DEFINITIONS: 市町ごとの周遊ミッション（地域ゲート）。
// - COLLECTIONS: 全スタンプ・全ボス討伐録。
//
// 座標は出典の住所をもとにした概算（地図表示上ほぼ正確、測量精度ではない）。
// ゲームバランス（報酬・確率・ステータス）はデモ用の暫定値。

import {
  createInitialPlayerState,
  type Boss,
  type CollectionDefinition,
  type ItemCatalog,
  type PlayerState,
  type QuestDefinition,
  type QuestProgress,
  type Region,
  type ShopItem,
  type Spot,
  type TitleDefinition,
} from '../domain/types';
import type { SessionStoreContext } from '../state/store';

// ---------------------------------------------------------------------------
// 地域（市町）とアンロック順序（波紋状）
// ---------------------------------------------------------------------------

export const REGION_MATSUYAMA = 'region-matsuyama';
export const REGION_IYO = 'region-iyo';
export const REGION_KUMAKOGEN = 'region-kumakogen';
export const REGION_UCHIKO = 'region-uchiko';
export const REGION_IMABARI = 'region-imabari';
export const REGION_OZU = 'region-ozu';
export const REGION_SAIJO = 'region-saijo';
export const REGION_NIIHAMA = 'region-niihama';
export const REGION_UWAJIMA = 'region-uwajima';
export const REGION_AINAN = 'region-ainan';
export const REGION_SEIYO = 'region-seiyo';
export const REGION_SHIKOKUCHUO = 'region-shikokuchuo';

/**
 * 松山市を起点に、近い市町から順に解放する単一チェーン（波紋状）。
 * 各市町は「直前の市町の全スポットを訪問」で解放される。
 */
const REGION_CHAIN: { id: string; name: string }[] = [
  { id: REGION_MATSUYAMA, name: '松山市' },
  { id: REGION_IYO, name: '伊予市' },
  { id: REGION_KUMAKOGEN, name: '久万高原町' },
  { id: REGION_UCHIKO, name: '内子町' },
  { id: REGION_IMABARI, name: '今治市' },
  { id: REGION_OZU, name: '大洲市' },
  { id: REGION_SAIJO, name: '西条市' },
  { id: REGION_NIIHAMA, name: '新居浜市' },
  { id: REGION_UWAJIMA, name: '宇和島市' },
  { id: REGION_AINAN, name: '愛南町' },
  { id: REGION_SEIYO, name: '西予市' },
  { id: REGION_SHIKOKUCHUO, name: '四国中央市' },
];

/** Region id の全順序（波紋状アンロック順）。 */
export const UNLOCK_ORDER: string[] = REGION_CHAIN.map((r) => r.id);

// ---------------------------------------------------------------------------
// スポット定義テーブル（id, 名前, 市町, 緯度, 経度, 入場半径m, 初回コイン, 初回経験値）
// ---------------------------------------------------------------------------

type SpotRow = [string, string, string, number, number, number, number, number];

const SPOT_ROWS: SpotRow[] = [
  // 松山市
  ['spot-dogo-honkan', '道後温泉本館', REGION_MATSUYAMA, 33.8519, 132.7866, 60, 50, 120],
  ['spot-dogo-asuka', '道後温泉別館 飛鳥乃湯泉', REGION_MATSUYAMA, 33.8527, 132.7872, 50, 45, 110],
  ['spot-matsuyama-castle', '松山城', REGION_MATSUYAMA, 33.8457, 132.7657, 80, 60, 140],
  ['spot-botchan-train', '坊っちゃん列車', REGION_MATSUYAMA, 33.8417, 132.766, 60, 40, 100],
  ['spot-ishiteji', '石手寺', REGION_MATSUYAMA, 33.8527, 132.7986, 60, 45, 110],
  ['spot-kururin', '大観覧車くるりん', REGION_MATSUYAMA, 33.84, 132.7656, 50, 40, 100],
  ['spot-okudogo', '奥道後温泉', REGION_MATSUYAMA, 33.8686, 132.819, 80, 50, 120],
  // 伊予市
  ['spot-shimonada', '下灘駅', REGION_IYO, 33.69, 132.65, 80, 55, 130],
  // 久万高原町
  ['spot-shikoku-karst', '四国カルスト', REGION_KUMAKOGEN, 33.498, 132.917, 150, 70, 160],
  // 内子町
  ['spot-yokaichi', '八日市護国の町並み', REGION_UCHIKO, 33.5363, 132.656, 80, 55, 130],
  ['spot-uchikoza', '内子座', REGION_UCHIKO, 33.54, 132.6557, 50, 50, 120],
  // 今治市
  ['spot-kurushima-bridge', '来島海峡大橋', REGION_IMABARI, 34.11, 132.993, 120, 70, 160],
  ['spot-oyamazumi', '大山祇神社', REGION_IMABARI, 34.2497, 133.0078, 70, 65, 150],
  ['spot-imabari-castle', '今治城', REGION_IMABARI, 34.0664, 132.9979, 70, 60, 140],
  ['spot-kirosan', '亀老山展望公園', REGION_IMABARI, 34.1077, 132.9966, 80, 60, 140],
  ['spot-towel-museum', 'タオル美術館', REGION_IMABARI, 34.0249, 132.943, 80, 55, 130],
  ['spot-nibukawa', '鈍川温泉', REGION_IMABARI, 34.026, 132.912, 80, 50, 120],
  // 大洲市
  ['spot-aoshima', '青島（猫島）', REGION_OZU, 33.601, 132.487, 120, 65, 150],
  ['spot-ozu-castle', '大洲城', REGION_OZU, 33.507, 132.546, 70, 60, 140],
  // 西条市
  ['spot-ishizuchi', '石鎚山', REGION_SAIJO, 33.7683, 133.1147, 150, 80, 180],
  // 新居浜市
  ['spot-besshiyama', '別子山・マイントピア別子', REGION_NIIHAMA, 33.873, 133.296, 120, 70, 160],
  // 宇和島市
  ['spot-uwajima-castle', '宇和島城', REGION_UWAJIMA, 33.22, 132.565, 70, 70, 160],
];

// ---------------------------------------------------------------------------
// スポット生成（テーブル → Spot[]）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// スポット詳細説明（出典: 楽天トラベル「愛媛県のおすすめ観光スポット22選」を要約・言い換え）
// ※ライセンス配慮のため原文をそのまま転載せず、内容を要約・言い換えして記載。
// ---------------------------------------------------------------------------

const SPOT_DESCRIPTION: Record<string, string> = {
  'spot-dogo-honkan':
    '日本最古級とされる名湯のシンボル。国の重要文化財でありながら現役の公衆浴場として営業。夏目漱石「坊っちゃん」の世界を体感できるレトロな佇まいが魅力。【おすすめ】歴史ある建築と湯めぐりの雰囲気。',
  'spot-dogo-asuka':
    '2017年開業の道後の新湯。飛鳥時代の建築様式を取り入れ、本館にない露天風呂や特別浴室を備える。昔の浴衣「湯帳」を着た入浴体験も。【おすすめ】新しい温泉文化と上質な休憩室。',
  'spot-matsuyama-castle':
    '標高132mの勝山山頂に立つ現存天守。姫路城などと並ぶ日本三大連立式平山城の一つ。ロープウェイで登れ、山頂から松山市街と瀬戸内海を一望。【おすすめ】天守からの大パノラマ。',
  'spot-botchan-train':
    '明治の蒸気機関車を模して復元した観光列車。煙に見立てた蒸気を上げて松山市内を走る。小説「坊っちゃん」の世界を味わえる。【おすすめ】レトロな路面電車の乗車体験。',
  'spot-ishiteji':
    '四国霊場第51番札所。国宝の仁王門や重要文化財の本堂・三重塔が並ぶ。長いマントラ洞窟や子宝石も有名で、ミシュラン・グリーンガイドで星を獲得。【おすすめ】荘厳な伽藍と洞窟巡り。',
  'spot-kururin':
    'いよてつ髙島屋の屋上にある大観覧車。地上85mから松山城や瀬戸内海、市街を望む。夜はイルミネーションが美しく、シースルーゴンドラも人気。【おすすめ】昼夜で表情が変わる空中散歩。',
  'spot-okudogo':
    '道後の奥、石手川渓谷沿いの温泉地。西日本最大級の大露天風呂が自慢で、自然のパノラマに囲まれて湯あみできる。【おすすめ】道後とあわせて巡りたい渓谷の湯。',
  'spot-shimonada':
    '海にとても近い無人駅として名高いJR予讃線の駅。ホームから伊予灘の絶景が広がり、映画やCMの舞台にもなる人気の撮影地。【おすすめ】夕暮れ時の海と空の絶景。',
  'spot-shikoku-karst':
    '愛媛と高知にまたがる日本三大カルストの一つ。「天空の道」と呼ばれる縦断ルートが爽快で、石灰岩と高原のパノラマや星空が楽しめる。【おすすめ】高原ドライブとキャンプ。',
  'spot-yokaichi':
    '木蝋の生産で栄えた内子の伝統的な町並み。約600mの通りに豪商の屋敷や町家が連なり、土壁と白漆喰が美しい。【おすすめ】どこか懐かしいフォトジェニックな散策。',
  'spot-uchikoza':
    '大正5年創建の本格的な芝居小屋。木造2階建てで桟敷席や回り舞台を備え、現役の劇場としても活躍する。【おすすめ】当時の建築技術と芝居文化（※保存修理で休館予定）。',
  'spot-kurushima-bridge':
    '今治と大島を結ぶ世界初の三連吊橋。全長約4kmで徒歩や自転車でも渡れる。日本三大急潮流の来島海峡と橋の眺めは絶景。【おすすめ】サイクリングと展望台からの景色。',
  'spot-oyamazumi':
    '全国に多くの分社を持つ日本総鎮守。樹齢約2,600年の大楠が鎮座し、宝物館には国宝級の武具を多数展示。【おすすめ】海と山の神への信仰と巨木のパワー。',
  'spot-imabari-castle':
    '堀に海水を引いた海城として有名。迫力ある石垣と築城技術が見どころで、天守からは今治の街並みと瀬戸内海を一望できる。【おすすめ】堀越しに見上げる天守閣。',
  'spot-kirosan':
    '標高約301mの展望公園。隈研吾設計の展望台から来島海峡大橋と急潮流を一望。夕景や夜景、橋のライトアップが必見。【おすすめ】マジックアワーの絶景。',
  'spot-towel-museum':
    'タオルの産地・今治ならではの世界唯一のタオル美術館。製造工程の見学やタオルアート、広大なガーデンやショップを楽しめる。【おすすめ】企画展とヨーロピアンガーデン。',
  'spot-nibukawa':
    '美人の湯として親しまれるアルカリ性単純泉。四季折々の鈍川渓谷の景色と、いのぶた料理など地元の味も魅力。【おすすめ】渓谷美と源泉かけ流し。',
  'spot-aoshima':
    '多くの猫が暮らす「猫の楽園」として知られる島。小説「坊っちゃん」にも登場し、釣りなども楽しめる。島内に宿泊施設はないため船の時間に注意。【おすすめ】のんびりした島時間と猫。',
  'spot-ozu-castle':
    '史料をもとに木造で正確に復元された4層4階の天守。観光列車への「歓迎旗振り」体験もできる。【おすすめ】城下町の風情と木造天守の内部見学。',
  'spot-ishizuchi':
    '標高1,982m、西日本最高峰。日本百名山の一つで山岳信仰の霊峰。ロープウェイで中腹まで上がれ、星空観察ツアーも人気。【おすすめ】霊峰登拝と高所からの眺め。',
  'spot-besshiyama':
    '別子銅山の跡地を活かした鉱山観光と温泉のテーマパーク。砂金採り体験や天空の湯など見どころが多い。【おすすめ】産業遺産巡りとドライブ。',
  'spot-uwajima-castle':
    '伊達家ゆかりの現存十二天守の一つ。白壁と御所建築の優雅な姿が美しく、400年の歴史を持つ「上り立ち門」も見どころ。【おすすめ】現存天守と歴史散策。',
};

// すべてのスポットの訪問判定半径（メートル）。スポット中心から 50m 以内に入ると訪問扱い。
export const VISIT_RADIUS_METERS = 50;

const TOURISM_SPOTS: Spot[] = SPOT_ROWS.map(
  ([id, name, regionId, lat, lng, , coins, exp]): Spot => ({
    id,
    name,
    description:
      SPOT_DESCRIPTION[id] ??
      `${name}（${REGION_CHAIN.find((r) => r.id === regionId)?.name ?? ''}）`,
    center: { lat, lng },
    // 訪問判定は一律 50m（Req 1.8 の範囲内）。
    entryRadiusMeters: VISIT_RADIUS_METERS,
    regionId,
    firstVisitReward: { coins, experience: exp, items: [] },
  })
);

// ---------------------------------------------------------------------------
// 四国八十八ヶ所 愛媛の札所（第40〜65番）
// 出典: 四国遍路日本遺産協議会「愛媛遍路マップ」(seichijunrei-shikokuhenro.jp) の
// 札所名・読み・所在地を参照（内容は要約・言い換え）。座標は所在地に基づく概算。
// ［番号, id, 寺名, 市町(Region), 緯度, 経度, 読み, 所在地］
// ---------------------------------------------------------------------------

type HenroRow = [number, string, string, string, number, number, string, string];

const HENRO_ROWS: HenroRow[] = [
  [40, 'henro-40', '観自在寺', REGION_AINAN, 32.9636, 132.561, 'へいじょうざん かんじざいじ', '南宇和郡愛南町御荘平城'],
  [41, 'henro-41', '龍光寺', REGION_UWAJIMA, 33.273, 132.636, 'いなりざん りゅうこうじ', '宇和島市三間町戸雁'],
  [42, 'henro-42', '佛木寺', REGION_UWAJIMA, 33.266, 132.612, 'いっかざん ぶつもくじ', '宇和島市三間町則'],
  [43, 'henro-43', '明石寺', REGION_SEIYO, 33.364, 132.536, 'げんこうざん めいせきじ', '西予市宇和町明石'],
  [44, 'henro-44', '大寶寺', REGION_KUMAKOGEN, 33.654, 132.903, 'すごうさん だいほうじ', '上浮穴郡久万高原町菅生'],
  [45, 'henro-45', '岩屋寺', REGION_KUMAKOGEN, 33.647, 132.833, 'かいがんざん いわやじ', '上浮穴郡久万高原町七鳥'],
  [46, 'henro-46', '浄瑠璃寺', REGION_MATSUYAMA, 33.774, 132.812, 'いおうざん じょうるりじ', '松山市浄瑠璃町'],
  [47, 'henro-47', '八坂寺', REGION_MATSUYAMA, 33.776, 132.806, 'くまのざん やさかじ', '松山市浄瑠璃町八坂'],
  [48, 'henro-48', '西林寺', REGION_MATSUYAMA, 33.792, 132.804, 'せいりゅうざん さいりんじ', '松山市高井町'],
  [49, 'henro-49', '浄土寺', REGION_MATSUYAMA, 33.816, 132.812, 'さいりんざん じょうどじ', '松山市鷹子町'],
  [50, 'henro-50', '繁多寺', REGION_MATSUYAMA, 33.823, 132.806, 'ひがしやま はんたじ', '松山市畑寺町'],
  [51, 'henro-51', '石手寺', REGION_MATSUYAMA, 33.8527, 132.7986, 'くまのざん いしてじ', '松山市石手'],
  [52, 'henro-52', '太山寺', REGION_MATSUYAMA, 33.883, 132.73, 'りゅううんざん たいさんじ', '松山市太山寺町'],
  [53, 'henro-53', '圓明寺', REGION_MATSUYAMA, 33.89, 132.733, 'すがさん えんみょうじ', '松山市和気町'],
  [54, 'henro-54', '延命寺', REGION_IMABARI, 34.043, 132.956, 'ちかみざん えんめいじ', '今治市阿方甲'],
  [55, 'henro-55', '南光坊', REGION_IMABARI, 34.064, 132.996, 'べっくざん なんこうぼう', '今治市別宮町'],
  [56, 'henro-56', '泰山寺', REGION_IMABARI, 34.049, 132.981, 'きんりんざん たいさんじ', '今治市小泉'],
  [57, 'henro-57', '栄福寺', REGION_IMABARI, 34.024, 132.962, 'ふとうざん えいふくじ', '今治市玉川町八幡甲'],
  [58, 'henro-58', '仙遊寺', REGION_IMABARI, 34.015, 132.952, 'されいざん せんゆうじ', '今治市玉川町別所甲'],
  [59, 'henro-59', '国分寺', REGION_IMABARI, 34.043, 133.008, 'こんこうざん こくぶんじ', '今治市国分'],
  [60, 'henro-60', '横峰寺', REGION_SAIJO, 33.833, 133.112, 'いしづちざん よこみねじ', '西条市小松町石鎚'],
  [61, 'henro-61', '香園寺', REGION_SAIJO, 33.823, 133.111, 'せんだんざん こうおんじ', '西条市小松町南川甲'],
  [62, 'henro-62', '宝寿寺', REGION_SAIJO, 33.821, 133.123, 'てんようざん ほうじゅじ', '西条市小松町新屋敷甲'],
  [63, 'henro-63', '吉祥寺', REGION_SAIJO, 33.819, 133.145, 'みっきょうざん きちじょうじ', '西条市氷見乙'],
  [64, 'henro-64', '前神寺', REGION_SAIJO, 33.817, 133.183, 'いしづちざん まえがみじ', '西条市洲之内甲'],
  [65, 'henro-65', '三角寺', REGION_SHIKOKUCHUO, 33.976, 133.531, 'ゆれいざん さんかくじ', '四国中央市金田町三角寺甲'],
];

// 札所参拝の報酬。経験値は「100m 歩行(=10exp)」の約25倍（20〜30倍の範囲）に設定。
// アイテムは参拝の記念品（trophy-<spotId>、アクセサリ）を確実に獲得できる。
const HENRO_VISIT_EXP = 250; // 100m 歩行(10exp) の 25 倍
const HENRO_VISIT_COINS = 60;

const HENRO_SPOTS: Spot[] = HENRO_ROWS.map(
  ([num, id, name, regionId, lat, lng, yomi, address]): Spot => ({
    id,
    name: `第${num}番 ${name}`,
    description: `四国八十八ヶ所 第${num}番札所「${name}」（${yomi}）。所在地：${address}。弘法大師ゆかりの霊場で、四国遍路（お遍路）の巡礼地。【おすすめ】静かな境内の参拝と札所めぐり・御朱印。参拝すると経験値とアイテムが手に入る。`,
    center: { lat, lng },
    entryRadiusMeters: VISIT_RADIUS_METERS,
    regionId,
    // 参拝報酬: 大きな経験値＋コイン＋記念品（アクセサリ）。中ボスは設置しない。
    firstVisitReward: {
      coins: HENRO_VISIT_COINS,
      experience: HENRO_VISIT_EXP,
      items: [`trophy-${id}`],
    },
  })
);

// 観光スポットと札所（お遍路）を統合した全スポット。
export const SPOTS: Spot[] = [...TOURISM_SPOTS, ...HENRO_SPOTS];

/** 札所（お遍路）スポットの id 集合（コレクション等で利用）。 */
export const HENRO_SPOT_IDS: string[] = HENRO_SPOTS.map((s) => s.id);

/** スポット総数（スタンプ集計の分母）。 */
export const TOTAL_SPOTS = SPOTS.length;

/** Region id → 所属スポット id 配列。 */
const SPOT_IDS_BY_REGION: Record<string, string[]> = SPOTS.reduce<Record<string, string[]>>(
  (acc, spot) => {
    (acc[spot.regionId] ??= []).push(spot.id);
    return acc;
  },
  {}
);

// ---------------------------------------------------------------------------
// 地域（Region）定義：波紋状の単一チェーン
// ---------------------------------------------------------------------------

export const REGIONS: Region[] = REGION_CHAIN.map((r, i): Region => {
  if (i === 0) {
    // 起点（松山市）。初期解放のため条件は名目上（評価対象にならない）。
    return {
      id: r.id,
      name: r.name,
      predecessorId: null,
      unlockCondition: { kind: 'stampCount', requiredCount: 0 },
    };
  }
  const predecessor = REGION_CHAIN[i - 1]!;
  // 直前市町の全スポット訪問で解放（波紋状）。
  return {
    id: r.id,
    name: r.name,
    predecessorId: predecessor.id,
    unlockCondition: {
      kind: 'allSpotsVisitedInRegion',
      regionId: predecessor.id,
    },
  };
});

// ---------------------------------------------------------------------------
// アイテムカタログ
// ---------------------------------------------------------------------------

const catalog: ItemCatalog = {};
function addItem(item: ShopItem): void {
  catalog[item.id] = item;
}

// 市町テーマのショップ装備（id, 名前, 市町, スロット, 効果説明, 効果, 価格）
type ShopRow = [
  string,
  string,
  string,
  ShopItem['slot'],
  string,
  Partial<ShopItem['statEffects']>,
  number,
];

const SHOP_ROWS: ShopRow[] = [
  // 松山市
  ['item-mikan-sword', 'みかんの剣', REGION_MATSUYAMA, 'weapon', '愛媛の太陽を浴びた一振り。攻撃が上がる。', { attack: 8 }, 120],
  ['item-botchan-dango-shield', '坊っちゃん団子の盾', REGION_MATSUYAMA, 'armor', '三色団子の堅い守り。防御とHPが上がる。', { defense: 10, hp: 25 }, 150],
  ['item-dogo-incense', '道後の湯けむり香', REGION_MATSUYAMA, 'accessory', '癒やしの湯けむり。素早さとHPが上がる。', { speed: 6, hp: 15 }, 90],
  // 伊予市
  ['item-shimonada-pendant', '下灘の夕陽ペンダント', REGION_IYO, 'accessory', '伊予灘の夕陽を宿す。素早さが上がる。', { speed: 8, hp: 10 }, 130],
  ['item-iyo-kasuri-happi', '伊予かすりの法被', REGION_IYO, 'armor', '伝統絣の丈夫な法被。防御が上がる。', { defense: 9, hp: 18 }, 140],
  // 久万高原町
  ['item-karst-flute', 'カルストの石笛', REGION_KUMAKOGEN, 'accessory', '高原に響く石灰の笛。素早さが上がる。', { speed: 7, attack: 3 }, 130],
  ['item-highland-hat', '高原の霧笠', REGION_KUMAKOGEN, 'armor', '霧を払う笠。防御が上がる。', { defense: 11, hp: 16 }, 150],
  // 内子町
  ['item-warousoku-lantern', '和蝋燭のランタン', REGION_UCHIKO, 'accessory', '木蝋の柔らかな灯り。HPが上がる。', { hp: 30, speed: 3 }, 120],
  ['item-uchikoza-fan', '内子座の見得扇', REGION_UCHIKO, 'weapon', '芝居の見得を切る扇。攻撃が上がる。', { attack: 9 }, 140],
  // 今治市
  ['item-towel-armor', '今治タオルの鎧', REGION_IMABARI, 'armor', 'ふわふわで丈夫な今治タオル製。防御とHPが上がる。', { defense: 12, hp: 28 }, 170],
  ['item-kurushima-anchor', '来島の潮風アンカー', REGION_IMABARI, 'accessory', '急潮を制す錨。素早さが上がる。', { speed: 7, defense: 4 }, 130],
  ['item-yakibuta-gauntlet', '焼豚玉子飯の小手', REGION_IMABARI, 'weapon', '今治名物の力。攻撃が上がる。', { attack: 10, hp: 10 }, 150],
  // 大洲市
  ['item-ozu-baton', '大洲城の采配', REGION_OZU, 'weapon', '城主の采配。攻撃が上がる。', { attack: 11 }, 160],
  ['item-ukai-lantern', '鵜飼の篝火提灯', REGION_OZU, 'accessory', '肱川の鵜飼の灯。HPと素早さが上がる。', { hp: 20, speed: 5 }, 120],
  // 西条市
  ['item-ishizuchi-staff', '石鎚の霊峰杖', REGION_SAIJO, 'weapon', '霊峰の力を宿す杖。攻撃が上がる。', { attack: 12, defense: 3 }, 180],
  ['item-uchinuki-charm', 'うちぬきの護符', REGION_SAIJO, 'accessory', '名水うちぬきの護り。HPが上がる。', { hp: 28, speed: 4 }, 140],
  // 新居浜市
  ['item-besshi-pickaxe', '別子のつるはし', REGION_NIIHAMA, 'weapon', '銅山を掘った相棒。攻撃が上がる。', { attack: 13 }, 180],
  ['item-akagane-helm', 'あかがね兜', REGION_NIIHAMA, 'armor', '銅の輝きの兜。防御が上がる。', { defense: 14, hp: 22 }, 190],
  // 宇和島市
  ['item-date-saihai', '伊達の采配刀', REGION_UWAJIMA, 'weapon', '伊達家の威光。攻撃が上がる。', { attack: 14 }, 200],
  ['item-jakoten-shield', 'じゃこ天の盾', REGION_UWAJIMA, 'armor', '揚げたての守り。防御とHPが上がる。', { defense: 13, hp: 26 }, 180],
  ['item-togyu-horn', '闘牛の角飾り', REGION_UWAJIMA, 'accessory', '宇和島闘牛の闘志。攻撃と素早さが上がる。', { attack: 5, speed: 6 }, 150],
  // 愛南町
  ['item-ainan-pearl', '御荘湾の真珠のお守り', REGION_AINAN, 'accessory', '真珠養殖の海の恵み。HPと素早さが上がる。', { hp: 22, speed: 5 }, 150],
  ['item-ainan-shiden', '紫電改の翼章', REGION_AINAN, 'weapon', '海中から蘇った戦闘機の意匠。攻撃が上がる。', { attack: 12, speed: 3 }, 170],
  // 西予市
  ['item-seiyo-kagura-bell', 'どろん亭の神楽鈴', REGION_SEIYO, 'accessory', '宇和の伝統神楽の鈴。HPが上がる。', { hp: 26, speed: 3 }, 140],
  ['item-seiyo-karst-stone', '穴神の鍾乳石', REGION_SEIYO, 'armor', '鍾乳洞の守り。防御が上がる。', { defense: 12, hp: 18 }, 160],
  // 四国中央市
  ['item-shikokuchuo-paper-charm', '紙のまちの護符', REGION_SHIKOKUCHUO, 'accessory', '製紙の町の護符。素早さとHPが上がる。', { speed: 7, hp: 14 }, 150],
  ['item-shikokuchuo-brush', '書道の大筆', REGION_SHIKOKUCHUO, 'weapon', '書道パフォーマンスの大筆。攻撃が上がる。', { attack: 13 }, 180],
];

for (const [id, name, regionId, slot, desc, effects, price] of SHOP_ROWS) {
  addItem({
    id,
    name,
    priceCoins: price,
    effectDescription: desc,
    slot,
    statEffects: effects,
    isLimited: false,
    regionId,
  });
}

// ボス限定アイテム（id, 名前, 市町, スロット, 効果説明, 効果）
type LimitedRow = [string, string, string, ShopItem['slot'], string, Partial<ShopItem['statEffects']>];

const LIMITED_ROWS: LimitedRow[] = [
  ['limited-botchan-pen', '坊っちゃんの万年筆', REGION_MATSUYAMA, 'weapon', '文豪の筆致。攻撃が大きく上がる限定品。', { attack: 22, speed: 5 }],
  ['limited-twilight-stone', '黄昏の双海石', REGION_IYO, 'accessory', '夕陽を封じた限定石。素早さが大きく上がる。', { speed: 16, hp: 20 }],
  ['limited-karst-crystal', '天空のカルスト結晶', REGION_KUMAKOGEN, 'weapon', '高原の結晶。攻撃が大きく上がる限定品。', { attack: 20, defense: 8 }],
  ['limited-mokuro-candle', '木蝋の黄金燭台', REGION_UCHIKO, 'accessory', '黄金の灯火。HPが大きく上がる限定品。', { hp: 60, speed: 6 }],
  ['limited-suigun-baton', '村上水軍の采配', REGION_IMABARI, 'weapon', '水軍を率いる采配。攻撃が大きく上がる限定品。', { attack: 24, hp: 20 }],
  ['limited-garyu-brush', '臥龍の山水筆', REGION_OZU, 'weapon', '名勝臥龍の筆。攻撃と防御が上がる限定品。', { attack: 21, defense: 10 }],
  ['limited-ishizuchi-mirror', '石鎚権現の御鏡', REGION_SAIJO, 'accessory', '霊峰の御鏡。全能力を底上げする限定品。', { attack: 8, defense: 8, hp: 30, speed: 8 }],
  ['limited-bessi-hammer', '別子銅龍の大槌', REGION_NIIHAMA, 'weapon', '銅龍の大槌。攻撃が極めて高い限定品。', { attack: 28 }],
  ['limited-date-helm', '伊達龍の兜', REGION_UWAJIMA, 'armor', '伊達龍の兜。防御とHPが大きく上がる限定品。', { defense: 22, hp: 70 }],
  ['limited-ainan-staff', '観自在の錫杖', REGION_AINAN, 'weapon', '南の霊場の錫杖。攻撃と素早さが上がる限定品。', { attack: 20, speed: 8 }],
  ['limited-seiyo-mirror', '明石の霊鏡', REGION_SEIYO, 'accessory', '宇和の霊鏡。全能力をやや底上げする限定品。', { attack: 6, defense: 6, hp: 30, speed: 6 }],
  ['limited-shikokuchuo-vajra', '三角寺の独鈷杵', REGION_SHIKOKUCHUO, 'weapon', '結願前の霊地の法具。攻撃が大きく上がる限定品。', { attack: 24, defense: 6 }],
];

for (const [id, name, regionId, slot, desc, effects] of LIMITED_ROWS) {
  addItem({
    id,
    name,
    priceCoins: 999_999_999, // 限定品はショップ非表示（価格は名目）
    effectDescription: desc,
    slot,
    statEffects: effects,
    isLimited: true,
    regionId,
  });
}

// スポット記念品（中ボスの確率ドロップ）。各スポットから自動生成（アクセサリ）。
for (const spot of SPOTS) {
  addItem({
    id: `trophy-${spot.id}`,
    name: `${spot.name}の記念品`,
    priceCoins: 999_999_999, // ドロップ専用（ショップ非表示）
    effectDescription: `${spot.name}を訪れた証の記念品。小さなステータス上昇。`,
    slot: 'accessory',
    statEffects: { hp: 8, speed: 2 },
    isLimited: true,
    regionId: spot.regionId,
  });
}

export const ITEM_CATALOG: ItemCatalog = catalog;

// ---------------------------------------------------------------------------
// ボス（市町ボス）と中ボス（各スポット）
// ---------------------------------------------------------------------------

// 市町ボス（regionId → ボス名）。限定アイテムは LIMITED_ROWS と対応させる。
const REGION_BOSS_NAME: Record<string, string> = {
  [REGION_MATSUYAMA]: '湯守の赤シャツ',
  [REGION_IYO]: '黄昏の伊予灘主',
  [REGION_KUMAKOGEN]: 'カルストの霧鬼',
  [REGION_UCHIKO]: '木蝋座の影法師',
  [REGION_IMABARI]: '来島の水軍大将',
  [REGION_OZU]: '肱川の臥龍',
  [REGION_SAIJO]: '石鎚の山神',
  [REGION_NIIHAMA]: '別子の銅龍',
  [REGION_UWAJIMA]: '宇和島の闘牛王',
  [REGION_AINAN]: '御荘湾の海王',
  [REGION_SEIYO]: '宇和盆地の霧将',
  [REGION_SHIKOKUCHUO]: '法皇山の結願鬼',
};

const REGION_LIMITED_BY_REGION: Record<string, string> = Object.fromEntries(
  LIMITED_ROWS.map(([id, , regionId]) => [regionId, id])
);

/** 市町ボス id を導出する。 */
export function regionBossId(regionId: string): string {
  return `boss-${regionId}`;
}

// 市町ボス（Region 紐付け）。チェーン順が後ろの市町ほど報酬・強さを厚くする。
const regionBosses: Boss[] = REGION_CHAIN.map((r, i): Boss => {
  const tier = i + 1;
  return {
    id: regionBossId(r.id),
    name: REGION_BOSS_NAME[r.id] ?? `${r.name}のボス`,
    kind: 'boss',
    bind: { kind: 'region', regionId: r.id },
    // 市町ボスは中ボスより明確に強い。tier に応じてスケールする。
    stats: {
      hp: 220 + tier * 70,
      attack: 22 + tier * 4,
      defense: 12 + tier * 3,
      speed: 8 + tier,
    },
    reward: {
      coins: 100 + tier * 40,
      experience: 250 + tier * 80,
      items: [],
      limitedItemIds: [REGION_LIMITED_BY_REGION[r.id] ?? ''],
    },
  };
});

// 中ボス（各スポット紐付け）。確率で記念品をドロップする。
// 札所（お遍路）には中ボスを設置しない（参拝報酬で経験値・アイテムを得る方式）。
const midBosses: Boss[] = TOURISM_SPOTS.map((spot): Boss => {
  // スポットの所属市町の tier を強さの目安にする（後半市町の中ボスほど強い）。
  const tier = Math.max(1, UNLOCK_ORDER.indexOf(spot.regionId) + 1);
  return {
    id: `midboss-${spot.id}`,
    name: `${spot.name}の主`,
    kind: 'midBoss',
    bind: { kind: 'spot', spotId: spot.id },
    // 中ボスは控えめ。序盤は倒しやすく、後半市町でやや手応えが出る。
    stats: {
      hp: 80 + tier * 22,
      attack: 12 + tier * 3,
      defense: 6 + tier * 2,
      speed: 6 + tier,
    },
    reward: {
      coins: 25,
      experience: 60,
      items: [],
      limitedItemIds: [],
    },
    // 45% でそのスポット固有の記念品をドロップ。
    dropTable: [{ itemId: `trophy-${spot.id}`, probability: 0.45 }],
  };
});

export const REGION_BOSSES: Boss[] = regionBosses;
export const MID_BOSSES: Boss[] = midBosses;
export const BOSSES: Boss[] = [...regionBosses, ...midBosses];

// ---------------------------------------------------------------------------
// 称号
// ---------------------------------------------------------------------------

const titles: TitleDefinition[] = [];

// 市町制覇の称号（その市町の全スポット訪問）。
for (const r of REGION_CHAIN) {
  const spotIds = SPOT_IDS_BY_REGION[r.id] ?? [];
  titles.push({
    id: `title-clear-${r.id}`,
    name: `${r.name}マスター`,
    description: `${r.name}の全スポットを巡った証。`,
    condition: { kind: 'allSpotsVisitedInRegion', regionId: r.id, spotIds },
  });
}

// 市町ボス撃破の称号。
for (const r of REGION_CHAIN) {
  titles.push({
    id: `title-boss-${r.id}`,
    name: `${REGION_BOSS_NAME[r.id] ?? r.name}討伐者`,
    description: `${r.name}のボス「${REGION_BOSS_NAME[r.id] ?? ''}」を撃破した証。`,
    condition: {
      kind: 'allBossesDefeatedInRegion',
      regionId: r.id,
      bossIds: [regionBossId(r.id)],
    },
  });
}

// 名所到達の称号（各市町の代表スポット1つ）。
const FLAGSHIP_SPOT: { spotId: string; regionId: string; title: string; desc: string }[] = [
  { spotId: 'spot-dogo-honkan', regionId: REGION_MATSUYAMA, title: '道後の湯入り', desc: '日本最古級の名湯・道後温泉本館に浸かった証。' },
  { spotId: 'spot-shimonada', regionId: REGION_IYO, title: '夕陽の旅人', desc: '海に一番近い駅・下灘駅で夕景を眺めた証。' },
  { spotId: 'spot-shikoku-karst', regionId: REGION_KUMAKOGEN, title: '天空の道踏破', desc: '四国カルストの天空の道を歩いた証。' },
  { spotId: 'spot-uchikoza', regionId: REGION_UCHIKO, title: '芝居小屋の通', desc: '大正の芝居小屋・内子座を訪れた証。' },
  { spotId: 'spot-kurushima-bridge', regionId: REGION_IMABARI, title: 'しまなみの風', desc: '世界初の三連吊橋・来島海峡大橋を渡った証。' },
  { spotId: 'spot-ozu-castle', regionId: REGION_OZU, title: '木造天守の主', desc: '木造復元天守・大洲城を訪れた証。' },
  { spotId: 'spot-ishizuchi', regionId: REGION_SAIJO, title: '霊峰登拝', desc: '西日本最高峰・石鎚山に挑んだ証。' },
  { spotId: 'spot-besshiyama', regionId: REGION_NIIHAMA, title: '銅山の探検者', desc: '別子銅山の遺産を巡った証。' },
  { spotId: 'spot-uwajima-castle', regionId: REGION_UWAJIMA, title: '現存天守の城主', desc: '現存十二天守・宇和島城を訪れた証。' },
];

for (const f of FLAGSHIP_SPOT) {
  titles.push({
    id: `title-spot-${f.spotId}`,
    name: f.title,
    description: f.desc,
    condition: { kind: 'allSpotsVisitedInRegion', regionId: f.regionId, spotIds: [f.spotId] },
  });
}

// お遍路（四国遍路 愛媛の札所）専用の称号。
// regionId はメタ情報で、判定は spotIds（全札所訪問）で行う（複数市町にまたがる）。
titles.push({
  id: 'title-henro-ehime-complete',
  name: '菩提の道場 結願',
  description: '愛媛の札所（第40〜65番）全26ヶ所を巡拝した証。',
  condition: {
    kind: 'allSpotsVisitedInRegion',
    regionId: 'henro-ehime',
    spotIds: HENRO_SPOT_IDS,
  },
});
// 難所として知られる札所の到達称号。
titles.push({
  id: 'title-henro-iwayaji',
  name: '山岳霊場の巡礼者',
  description: '断崖の霊場・第45番 岩屋寺に参拝した証。',
  condition: { kind: 'allSpotsVisitedInRegion', regionId: REGION_KUMAKOGEN, spotIds: ['henro-45'] },
});
titles.push({
  id: 'title-henro-yokomineji',
  name: '遍路ころがし踏破',
  description: '難所として名高い第60番 横峰寺に到達した証。',
  condition: { kind: 'allSpotsVisitedInRegion', regionId: REGION_SAIJO, spotIds: ['henro-60'] },
});

export const TITLES: TitleDefinition[] = titles;

// ---------------------------------------------------------------------------
// クエスト（市町ごとの周遊ミッション・地域ゲート）
// ---------------------------------------------------------------------------

export const QUEST_DEFINITIONS: QuestDefinition[] = REGION_CHAIN.map((r): QuestDefinition => {
  const spotIds = SPOT_IDS_BY_REGION[r.id] ?? [];
  return {
    id: `quest-tour-${r.id}`,
    name: `${r.name}周遊`,
    regionId: r.id,
    condition: { kind: 'spots', requiredSpotIds: spotIds },
    reward: { coins: 60 + spotIds.length * 20, experience: 150 + spotIds.length * 40, items: [] },
  };
});

// ---------------------------------------------------------------------------
// コレクション
// ---------------------------------------------------------------------------

export const COLLECTIONS: CollectionDefinition[] = [
  {
    id: 'collection-all-stamps',
    name: '全スタンプ',
    kind: 'stamp',
    entryIds: SPOTS.map((s) => s.id),
  },
  {
    id: 'collection-henro',
    name: '四国遍路 愛媛の札所（40〜65番）',
    kind: 'stamp',
    entryIds: HENRO_SPOT_IDS,
  },
  {
    id: 'collection-region-bosses',
    name: '市町ボス討伐録',
    kind: 'boss',
    entryIds: regionBosses.map((b) => b.id),
  },
  {
    id: 'collection-midbosses',
    name: '中ボス討伐録',
    kind: 'boss',
    entryIds: midBosses.map((b) => b.id),
  },
];

// ---------------------------------------------------------------------------
// 状態管理層へ渡すコンテキストと初期プレイヤー状態
// ---------------------------------------------------------------------------

/** SessionStore に渡す静的コンテキスト（カタログ群）を組み立てる。 */
export function createGameContext(): SessionStoreContext {
  return {
    spots: SPOTS,
    regions: REGIONS,
    bosses: BOSSES,
    titles: TITLES,
    itemCatalog: ITEM_CATALOG,
    unlockOrder: UNLOCK_ORDER,
    // regionUnlockContext は store が spots の regionId から自動導出する。
  };
}

/** クエスト定義から初期のクエスト進行（未着手）を生成する。 */
export function createGameInitialQuests(): QuestProgress[] {
  return QUEST_DEFINITIONS.map((definition) => ({
    definition,
    satisfiedSpotIds: [],
    satisfiedCount: 0,
    complete: false,
    rewardGranted: false,
  }));
}

/** 新規プレイヤーの初期状態（松山市のみ解放・全周遊ミッション付与）。 */
export function createGameInitialState(playerId: string): PlayerState {
  return createInitialPlayerState(playerId, REGION_MATSUYAMA, createGameInitialQuests());
}

/** spotId → 記念品（trophy）itemId。 */
export function trophyItemId(spotId: string): string {
  return `trophy-${spotId}`;
}
