// バトル用の敵定義・バトルアイテム生成（MVP）
//
// 既存の Boss（domain/types.ts）からバトル用 EnemyDefinition を導出する。
// 敵固有の凝った行動表は将来拡張とし、ここでは種別（ボス/中ボス）に応じた
// 汎用の行動パターン・メッセージを生成する。

import type { Boss, CharacterStats } from '../domain/types';
import type {
  AttackPhase,
  BattleItem,
  BulletPattern,
  BulletShape,
  BulletSpawnSpec,
  EnemyActionPattern,
  EnemyDefinition,
} from '../domain/battle';
import { DEFAULT_ENEMY_STATS } from '../domain/battle';

// ---------------------------------------------------------------------------
// 名前のふりがな（ルビ）
// ---------------------------------------------------------------------------

/** 市町ボス名 → 読み（ひらがな）。 */
const REGION_BOSS_READING: Record<string, string> = {
  '湯守の赤シャツ': 'ゆもりのあかシャツ',
  '黄昏の伊予灘主': 'たそがれのいよなだぬし',
  'カルストの霧鬼': 'カルストのきりおに',
  '木蝋座の影法師': 'もくろうざのかげぼうし',
  '来島の水軍大将': 'くるしまのすいぐんたいしょう',
  '肱川の臥龍': 'ひじかわのがりゅう',
  '石鎚の山神': 'いしづちのやまがみ',
  '別子の銅龍': 'べっしのどうりゅう',
  '宇和島の闘牛王': 'うわじまのとうぎゅうおう',
};

/** スポット名 → 読み（ひらがな）。中ボス名「○○の主」の読みに使う。 */
const SPOT_READING: Record<string, string> = {
  '道後温泉本館': 'どうごおんせんほんかん',
  '道後温泉別館 飛鳥乃湯泉': 'どうごおんせんべっかん あすかのゆ',
  '松山城': 'まつやまじょう',
  '坊っちゃん列車': 'ぼっちゃんれっしゃ',
  '石手寺': 'いしてじ',
  '大観覧車くるりん': 'だいかんらんしゃくるりん',
  '奥道後温泉': 'おくどうごおんせん',
  '下灘駅': 'しもなだえき',
  '四国カルスト': 'しこくカルスト',
  '八日市護国の町並み': 'ようかいちごこくのまちなみ',
  '内子座': 'うちこざ',
  '来島海峡大橋': 'くるしまかいきょうおおはし',
  '大山祇神社': 'おおやまづみじんじゃ',
  '今治城': 'いまばりじょう',
  '亀老山展望公園': 'きろうざんてんぼうこうえん',
  'タオル美術館': 'タオルびじゅつかん',
  '鈍川温泉': 'にぶかわおんせん',
  '青島（猫島）': 'あおしま（ねこじま）',
  '大洲城': 'おおずじょう',
  '石鎚山': 'いしづちさん',
  '別子山・マイントピア別子': 'べっしやま・マイントピアべっし',
  '宇和島城': 'うわじまじょう',
};

/** ボス名から読み（ふりがな）を求める。中ボスは「○○の主」を分解して算出。 */
function readingForName(name: string): string | undefined {
  if (REGION_BOSS_READING[name]) return REGION_BOSS_READING[name];
  if (name.endsWith('の主')) {
    const base = name.slice(0, -2);
    const r = SPOT_READING[base];
    if (r) return `${r}のぬし`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 敵ごとの攻撃パターン（全敵バラバラ）
// ---------------------------------------------------------------------------

/** 行動パターンを簡潔に作るビルダー。 */
function pat(
  id: string,
  message: string,
  pattern: BulletPattern,
  count: number,
  speed: number,
  radius: number,
  opts: { dmg?: number; homing?: number; shape?: BulletShape } = {}
): EnemyActionPattern {
  return {
    id,
    message,
    spawn: {
      count,
      speed,
      radius,
      pattern,
      damageMultiplier: opts.dmg ?? 1,
      homing: opts.homing,
      shape: opts.shape,
    },
    dodgeDurationMs: 4200,
  };
}

type PatternSet = { normal: EnemyActionPattern[]; enraged: EnemyActionPattern[] };

/** 弾生成スペックを簡潔に作るビルダー（多段フェーズ用）。 */
function sp(
  pattern: BulletPattern,
  count: number,
  speed: number,
  radius: number,
  opts: {
    dmg?: number;
    homing?: number;
    shape?: BulletShape;
    ignoreCountSpeed?: boolean;
    spriteUrl?: string;
    spin?: boolean;
  } = {}
): BulletSpawnSpec {
  return {
    count,
    speed,
    radius,
    pattern,
    damageMultiplier: opts.dmg ?? 1,
    homing: opts.homing,
    shape: opts.shape,
    // 手組みの多段攻撃は弾速をそのまま使う（球数補正で意図が崩れないように）。
    ignoreCountSpeed: opts.ignoreCountSpeed ?? true,
    spriteUrl: opts.spriteUrl,
    spin: opts.spin,
  };
}

/** フェーズ（atMs 時点で spawn を出す）を作る。 */
function ph(atMs: number, spawn: BulletSpawnSpec): AttackPhase {
  return { atMs, spawn };
}

/** 多段攻撃パターンを作る。spawn は先頭フェーズのものを代表として持たせる。 */
function phasedPat(id: string, message: string, phases: AttackPhase[]): EnemyActionPattern {
  return {
    id,
    message,
    spawn: phases[0]!.spawn,
    phases,
    dodgeDurationMs: 5200,
  };
}

/** 通常パターンを激化させた版を作る（HP50%以下用）。ボスはより強烈に。 */
function harden(p: EnemyActionPattern, boss: boolean): EnemyActionPattern {
  const cMul = boss ? 1.5 : 1.28;
  const sMul = boss ? 1.3 : 1.16;
  const dMul = boss ? 1.4 : 1.2;
  const hardenSpawn = (s: BulletSpawnSpec): BulletSpawnSpec => ({
    ...s,
    count: Math.max(1, Math.round(s.count * cMul)),
    speed: s.speed * sMul,
    radius: s.radius + 1,
    damageMultiplier: s.damageMultiplier * dMul,
    homing: s.homing ? s.homing * 1.25 : s.homing,
  });
  // 多段攻撃は各フェーズを激化する。
  if (p.phases && p.phases.length > 0) {
    const phases = p.phases.map((f) => ({ atMs: f.atMs, spawn: hardenSpawn(f.spawn) }));
    return { ...p, id: `${p.id}-x`, spawn: phases[0]!.spawn, phases };
  }
  return {
    id: `${p.id}-x`,
    message: p.message,
    spawn: hardenSpawn(p.spawn),
    dodgeDurationMs: p.dodgeDurationMs,
  };
}

/**
 * ボス id → 通常時の攻撃パターン（敵ごとに3種類）。
 * enraged（HP<=50%）は harden で自動生成する。ボスは中ボスより強い。
 */
const BOSS_PATTERNS: Record<string, (name: string) => EnemyActionPattern[]> = {
  // ===== 松山市スポット（中ボス） =====
  'midboss-spot-dogo-honkan': (n) => [
    // ① 湯けむり: 湯気が広がり、見えない場所（壁の外）から温泉弾が飛ぶ。
    phasedPat('dh-yukemuri', `${n}は湯けむりを立ちこめさせた…見えない所から温泉弾！`, [
      ph(0, sp('sides', 6, 0.13, 8)), // 左右の壁の外から
      ph(1200, sp('aimed', 5, 0.16, 7)), // 見えない所からソウルを狙って
      ph(2400, sp('rain', 9, 0.18, 7)), // 追い打ちの温泉弾
    ]),
    // ② 熱湯しぶき: 熱湯を扇状にまき散らす（ウェーブごとに角度が少しずれる）。
    pat('dh-shibuki', `${n}は熱湯を扇状にまき散らした！`, 'fan', 11, 0.19, 8),
    // ③ 刻太鼓: 太鼓のリズムに合わせて衝撃波（すき間あり）が来る。
    phasedPat('dh-taiko', `${n}は刻太鼓を打ち鳴らした！`, [
      ph(0, sp('shockwave', 1, 0.14, 14)), // ドン！
      ph(1100, sp('shockwave', 1, 0.14, 14)), // ドン！
      ph(2200, sp('shockwave', 1, 0.16, 14)), // ドン！
    ]),
  ],
  'midboss-spot-dogo-asuka': (n) => [
    // ② 飛鳥の翼/雅の屏風/飛鳥乱舞
    pat('da-wing', `${n}は飛鳥の翼をブーメランのように飛ばした！`, 'homing', 5, 0.16, 9, { homing: 1.9, shape: 'diamond' }),
    pat('da-byobu', `${n}は雅の屏風を立て、狭い隙間を作った！`, 'rainColumns', 7, 0.18, 10, { shape: 'square' }),
    pat('da-ranbu', `${n}は色鮮やかな光弾を舞わせた！`, 'spiral', 13, 0.18, 8),
  ],
  'midboss-spot-matsuyama-castle': (n) => [
    // ③ 天守砲撃/石垣崩し/城門閉鎖
    pat('mc-cannon', `${n}は天守から大砲を一直線に放った！`, 'aimed', 6, 0.24, 10),
    pat('mc-ishigaki', `${n}は石垣を崩して岩を転がした！`, 'sweepL', 8, 0.2, 11, { shape: 'square' }),
    phasedPat('mc-gate', `${n}は城門を閉ざした！安全地帯が変わる！`, [
      ph(0, sp('shockwave', 1, 0.14, 14)),
      ph(1100, sp('shockwave', 1, 0.15, 14)),
      ph(2200, sp('shockwave', 1, 0.16, 14)),
    ]),
  ],
  'midboss-spot-botchan-train': (n) => [
    // ④ 汽笛突撃/石炭スモーク/レールチェンジ
    pat('bt-charge', `${n}は汽笛とともに一直線に突撃した！`, 'sweepL', 6, 0.26, 11),
    pat('bt-smoke', `${n}は石炭の煙幕で視界を奪った！`, 'random', 9, 0.12, 10),
    phasedPat('bt-rail', `${n}はレールを切り替えた！攻撃方向が変わる！`, [
      ph(0, sp('sweepL', 6, 0.22, 11)),
      ph(1200, sp('sweepR', 6, 0.22, 11)),
      ph(2400, sp('sweepL', 6, 0.24, 11)),
    ]),
  ],
  'midboss-spot-ishiteji': (n) => [
    // ⑤ 仁王の拳/護摩の炎/数珠連弾
    pat('it-fist', `${n}は仁王の拳を振り下ろした！`, 'aimed', 3, 0.18, 16),
    phasedPat('it-goma', `${n}は護摩の炎を順に噴き上げた！`, [
      ph(0, sp('rainColumns', 4, 0.18, 10)),
      ph(1000, sp('rainColumns', 5, 0.19, 10)),
      ph(2000, sp('rainColumns', 6, 0.2, 10)),
    ]),
    pat('it-juzu', `${n}は数珠玉を円に描いて放った！`, 'spiral', 14, 0.18, 8),
  ],
  'midboss-spot-kururin': (n) => [
    // ⑥ ゴンドラ落下/回転リング/大回転
    pat('ku-gondola', `${n}はゴンドラを落とした！`, 'rain', 7, 0.18, 13, { shape: 'square' }),
    phasedPat('ku-ring', `${n}は回転リングを迫らせた！`, [
      ph(0, sp('shockwave', 1, 0.14, 14)),
      ph(1100, sp('shockwave', 1, 0.15, 14)),
      ph(2200, sp('shockwave', 2, 0.16, 14)),
    ]),
    pat('ku-spin', `${n}は大回転を始めた！`, 'spiral', 16, 0.2, 9),
  ],
  'midboss-spot-okudogo': (n) => [
    // ⑦ 温泉滝/岩風呂落石/湯煙渦
    pat('ok-fall', `${n}は温泉の滝を流した！`, 'rainColumns', 8, 0.22, 9),
    pat('ok-rock', `${n}は岩風呂の岩を転がした！`, 'sweepR', 8, 0.2, 11, { shape: 'square' }),
    pat('ok-vortex', `${n}は湯煙の渦で吸い寄せた！`, 'spiral', 14, 0.18, 9),
  ],
  // ===== 伊予市 =====
  'midboss-spot-shimonada': (n) => [
    // ⑧ 夕日レーザー/潮風/通過列車
    pat('sn-laser', `${n}は夕日のレーザーを一直線に放った！`, 'aimed', 5, 0.26, 8),
    pat('sn-wind', `${n}は潮風を横から吹かせた！`, 'sides', 9, 0.2, 10),
    pat('sn-train', `${n}の通過列車が高速で駆け抜けた！`, 'sweepL', 7, 0.3, 12),
  ],
  // ===== 久万高原町 =====
  'midboss-spot-shikoku-karst': (n) => [
    // ⑨ 石灰岩落下/高原疾風/放牧突進
    pat('sk-lime', `${n}は石灰岩を大量に降らせた！`, 'rain', 12, 0.2, 10, { shape: 'square' }),
    pat('sk-gale', `${n}は高原の疾風で弾道を曲げた！`, 'homing', 6, 0.16, 9, { homing: 1.7, shape: 'diamond' }),
    pat('sk-cattle', `${n}は牛を放牧突進させた！`, 'sweepR', 7, 0.26, 12),
  ],
  // ===== 内子町 =====
  'midboss-spot-yokaichi': (n) => [
    // ⑩ 白壁反射/格子迷路/商家の提灯
    pat('yk-wall', `${n}は白壁で弾を反射させた！`, 'sides', 9, 0.2, 9),
    pat('yk-lattice', `${n}は木格子の迷路を作った！`, 'rainColumns', 8, 0.18, 10, { shape: 'square' }),
    phasedPat('yk-lantern', `${n}は提灯を仕掛けて爆発させた！`, [
      ph(0, sp('rain', 4, 0.12, 10)),
      ph(1300, sp('burst', 12, 0.2, 8)),
    ]),
  ],
  'midboss-spot-uchikoza': (n) => [
    // ⑪ 幕開け/紙吹雪/舞台奈落
    pat('uz-maku', `${n}は幕を閉じて視界を遮った！`, 'sides', 8, 0.16, 12),
    pat('uz-kami', `${n}は紙吹雪を大量に飛ばした！`, 'random', 16, 0.16, 6),
    pat('uz-naraku', `${n}は奈落を開いて落下攻撃！`, 'rain', 9, 0.2, 9),
  ],
  // ===== 今治市 =====
  'midboss-spot-kurushima-bridge': (n) => [
    // ⑫ 吊橋ワイヤー/海峡の渦/強風横断
    pat('kb-wire', `${n}は吊橋のワイヤーを斜めに飛ばした！`, 'diagDownR', 8, 0.2, 9),
    pat('kb-vortex', `${n}は渦潮で吸い寄せた！`, 'spiral', 14, 0.18, 9),
    pat('kb-wind', `${n}は強風で横断を妨げた！`, 'sweepL', 8, 0.22, 10),
  ],
  'midboss-spot-oyamazumi': (n) => [
    // ⑬ 神木の根/神鹿突進/神鏡の光
    pat('oy-root', `${n}は神木の根を地から伸ばした！`, 'rainColumns', 7, 0.18, 10),
    pat('oy-deer', `${n}は神鹿を駆け抜けさせた！`, 'sweepR', 7, 0.24, 12),
    pat('oy-mirror', `${n}は神鏡の光を反射させた！`, 'burst', 12, 0.2, 9),
  ],
  'midboss-spot-imabari-castle': (n) => [
    // ⑭ 海水砲/水堀ウェーブ/鉄砲隊
    pat('ic-cannon', `${n}は海水砲を撃った！`, 'aimed', 7, 0.22, 10),
    pat('ic-wave', `${n}は水堀の波を押し寄せた！`, 'sweepL', 9, 0.2, 10),
    pat('ic-volley', `${n}は鉄砲隊の一斉射撃！`, 'rainColumns', 8, 0.2, 10, { shape: 'square' }),
  ],
  'midboss-spot-kirosan': (n) => [
    // ⑮ 展望ビーム/山風/絶景落石
    pat('kr-beam', `${n}は展望ビームを放った！`, 'fan', 10, 0.2, 9),
    pat('kr-wind', `${n}は山風で押し返した！`, 'sweepR', 8, 0.22, 10),
    pat('kr-rock', `${n}は山頂から落石を起こした！`, 'rain', 9, 0.2, 11, { shape: 'square' }),
  ],
  'midboss-spot-towel-museum': (n) => [
    // ⑯ タオルムチ/糸玉弾/タオルブーメラン
    pat('tw-whip', `${n}はタオルのムチを振り回した！`, 'sweepL', 7, 0.2, 11),
    pat('tw-yarn', `${n}は毛糸玉を跳ね回らせた！`, 'random', 12, 0.18, 9),
    pat('tw-boomer', `${n}はタオルブーメランを投げた！`, 'homing', 5, 0.16, 10, { homing: 1.9, shape: 'diamond' }),
  ],
  'midboss-spot-nibukawa': (n) => [
    // ⑰ 湯煙迷彩/岩湯弾/源泉噴出
    pat('nb-camo', `${n}は湯煙で攻撃を隠した！`, 'random', 12, 0.13, 12),
    pat('nb-rock', `${n}は熱い岩湯弾を飛ばした！`, 'aimed', 6, 0.2, 11, { shape: 'square' }),
    pat('nb-spout', `${n}は床から源泉を噴出させた！`, 'rainColumns', 7, 0.18, 10),
  ],
  // ===== 大洲市 =====
  'midboss-spot-aoshima': (n) => [
    // ⑱ 猫パンチ/毛玉乱射/猫じゃらし
    pat('as-punch', `${n}は巨大な猫パンチを繰り出した！`, 'aimed', 3, 0.2, 16),
    pat('as-fur', `${n}は毛玉を乱射した！`, 'burst', 14, 0.18, 8),
    pat('as-chase', `${n}は猫じゃらしを追って突進した！`, 'homing', 5, 0.17, 10, { homing: 2.0, shape: 'diamond' }),
  ],
  'midboss-spot-ozu-castle': (n) => [
    // ⑲ 城壁砲/瓦落とし/城主の号令
    pat('oc-cannon', `${n}は城壁砲を放物線で撃った！`, 'diagDownR', 7, 0.2, 10),
    pat('oc-tile', `${n}は瓦を上から落とした！`, 'rain', 10, 0.2, 9, { shape: 'square' }),
    pat('oc-spear', `${n}は兵士の槍を一斉に突き出した！`, 'sides', 10, 0.22, 9),
  ],
  // ===== 西条市 =====
  'midboss-spot-ishizuchi': (n) => [
    // ⑳ 落雷/岩壁崩壊/天狗旋風
    pat('iz-thunder', `${n}は落雷をランダムに落とした！`, 'rain', 6, 0.26, 8),
    pat('iz-collapse', `${n}は岩壁を崩して大岩を転がした！`, 'sweepL', 5, 0.22, 13, { shape: 'square' }),
    pat('iz-tornado', `${n}は天狗旋風を巻き起こした！`, 'spiral', 13, 0.2, 9),
  ],
  // ===== 新居浜市 =====
  'midboss-spot-besshiyama': (n) => [
    // ㉑ トロッコ暴走/採掘爆破/鉱石シャワー
    pat('bs-cart', `${n}はトロッコを暴走させた！`, 'sweepR', 7, 0.3, 12),
    phasedPat('bs-blast', `${n}はダイナマイトを爆発させた！`, [
      ph(0, sp('aimed', 4, 0.14, 10)),
      ph(1300, sp('burst', 13, 0.2, 9)),
    ]),
    pat('bs-ore', `${n}は鉱石を雨のように降らせた！`, 'rain', 12, 0.2, 9, { shape: 'square' }),
  ],
  // ===== 宇和島市 =====
  'midboss-spot-uwajima-castle': (n) => [
    // ㉒ 鯱砲/天守乱射/海城の波動
    pat('uc-shachi', `${n}は鯱の形をした弾を撃った！`, 'aimed', 6, 0.22, 11, { shape: 'diamond' }),
    pat('uc-volley', `${n}は天守から四方へ乱射した！`, 'burst', 12, 0.2, 9),
    pat('uc-wave', `${n}は海城の波動を横切らせた！`, 'sweepL', 9, 0.2, 10),
  ],

  // ===== 市町ボス（ラスボス：中ボスより難しめ・多段／弾多め／追尾あり） =====
  'boss-region-matsuyama': (n) => [
    // ① 灼熱の湯札: 湯札が並ぶ→赤く光って熱湯柱が真下へ。安全地帯は毎回変わる。
    phasedPat('rm-fuda', `${n}は灼熱の湯札を並べた…熱湯の柱が噴き出す！`, [
      ph(0, sp('rainColumns', 6, 0.04, 9, { shape: 'square' })), // 湯札が並ぶ（ほぼ静止）
      ph(1500, sp('rainColumns', 7, 0.32, 9, { shape: 'square' })), // 熱湯柱が真下へ噴出
    ]),
    // ② 湯桶乱舞: 巨大な木桶を投げ、割れて熱湯・木片・湯気が四方へ。
    phasedPat('rm-oke', `${n}は巨大な湯桶を投げつけた！`, [
      ph(0, sp('aimed', 2, 0.18, 16)), // 木桶
      ph(900, sp('burst', 16, 0.22, 7)), // 割れて四方へ
    ]),
    // ③ 湯守の秘湯（必殺）: 温泉猿が飛び出し、左右から熱湯の波。
    phasedPat('rm-hiyu', `${n}の必殺・湯守の秘湯！エリアがお湯で満たされる！`, [
      ph(0, sp('random', 8, 0.14, 9)), // 猿が顔を出す
      ph(1200, sp('sides', 10, 0.22, 9)), // 熱湯の波
      ph(2400, sp('random', 8, 0.16, 9)), // 飛び出す
      ph(3200, sp('sides', 12, 0.24, 9)), // 大波
    ]),
  ],
  'boss-region-iyo': (n) => [
    // ① 夕焼けレーザー: 回転する光線→最後だけ極太。
    phasedPat('ri-laser', `${n}は夕焼けレーザーを回転発射！`, [
      ph(0, sp('spiral', 14, 0.2, 8)),
      ph(1200, sp('spiral', 16, 0.22, 8)),
      ph(2400, sp('aimed', 3, 0.26, 16)), // 極太レーザー
    ]),
    // ② 海鳥急降下: カモメ群→一羽が赤く光り急降下→羽根が散る。
    phasedPat('ri-bird', `${n}は海鳥を舞わせた…一羽が急降下！`, [
      ph(0, sp('homing', 4, 0.16, 9, { homing: 2.0, shape: 'diamond' })),
      ph(1600, sp('aimed', 1, 0.3, 11)), // 赤い一羽
      ph(2200, sp('burst', 12, 0.22, 6)), // 羽根
    ]),
    // ③ 黄昏の潮流: クラゲ弾を避けつつ、最後は巨大な波。
    phasedPat('ri-tide', `${n}は黄昏の潮流を呼び込んだ！`, [
      ph(0, sp('random', 10, 0.16, 9)), // クラゲ
      ph(1500, sp('sides', 10, 0.2, 9)),
      ph(2800, sp('sweepL', 6, 0.26, 14)), // 巨大な波
    ]),
  ],
  'boss-region-kumakogen': (n) => [
    // ① 濃霧: 霧の中、赤い目の位置から岩弾。
    phasedPat('rk-fog', `${n}は濃霧を立ちこめさせた…赤い目が岩弾を放つ！`, [
      ph(0, sp('random', 12, 0.1, 12)), // 霧
      ph(1500, sp('aimed', 6, 0.22, 10)), // 目から岩弾
    ]),
    // ② 石灰乱撃: 白い石灰岩が落下→割れて8方向へ。
    phasedPat('rk-lime', `${n}は石灰岩を落とし、砕いて飛散させた！`, [
      ph(0, sp('rain', 6, 0.18, 12, { shape: 'square' })),
      ph(1100, sp('burst', 16, 0.22, 6)),
    ]),
    // ③ 霧鬼の咆哮: 音の衝撃波がリング状に広がる（隙間を抜ける）。
    phasedPat('rk-roar', `${n}が咆哮した！音の衝撃波が広がる！`, [
      ph(0, sp('shockwave', 1, 0.15, 14)),
      ph(1000, sp('shockwave', 1, 0.16, 14)),
      ph(2000, sp('shockwave', 2, 0.17, 14)),
    ]),
  ],
  'boss-region-uchiko': (n) => [
    // ① 蝋燭の炎: 四隅の炎が追尾→時間で二つに分裂。
    phasedPat('ru-candle', `${n}は蝋燭の炎を放った…炎が分裂する！`, [
      ph(0, sp('homing', 4, 0.16, 9, { homing: 2.2, shape: 'diamond' })),
      ph(1800, sp('homing', 8, 0.17, 8, { homing: 2.4, shape: 'diamond' })), // 分裂
    ]),
    // ② 影芝居: 影人形がゆっくり歩く→本物になって突進。
    phasedPat('ru-shadow', `${n}は影芝居を始めた…影が本物になって突進！`, [
      ph(0, sp('sweepL', 6, 0.12, 12)), // 影（遅い）
      ph(1600, sp('sweepL', 6, 0.28, 12)), // 突進（速い）
    ]),
    // ③ 溶ける蝋: 天井から熱い蝋が落ちる。
    pat('ru-wax', `${n}は天井から熱い蝋を滴らせた！`, 'rain', 11, 0.18, 8),
  ],
  'boss-region-imabari': (n) => [
    // ① 火矢一斉射: 外から燃える矢が大量→最後だけ巨大火矢。
    phasedPat('rim-arrow', `${n}は火矢を一斉に射た！`, [
      ph(0, sp('sides', 12, 0.22, 8)),
      ph(1200, sp('rain', 14, 0.22, 7)),
      ph(2400, sp('aimed', 1, 0.3, 16)), // 巨大火矢
    ]),
    // ② 軍船突撃: 和船が左右から突進、波が残る。
    phasedPat('rim-ship', `${n}は軍船で突撃した！`, [
      ph(0, sp('sweepL', 4, 0.26, 14)),
      ph(1200, sp('sweepR', 4, 0.26, 14)),
      ph(2200, sp('sides', 8, 0.18, 9)), // 残る波
    ]),
    // ③ 海峡大渦: 渦に引かれながら砲弾を避ける。
    phasedPat('rim-vortex', `${n}は海峡に大渦を発生させた！`, [
      ph(0, sp('spiral', 16, 0.2, 8)),
      ph(1400, sp('aimed', 6, 0.22, 10)),
    ]),
  ],
  'boss-region-ozu': (n) => [
    // ① 龍の爪: 巨大な爪が画面を横切るように斬る。
    pat('ro-claw', `${n}は龍の爪で薙ぎ払った！`, 'sweepL', 4, 0.28, 15),
    // ② 水龍弾: 蛇のように曲がりながら追う。
    pat('ro-dragon', `${n}は水龍弾を放った！`, 'homing', 7, 0.17, 9, { homing: 2.4, shape: 'diamond' }),
    // ③ 龍の咆哮: 音の波が何重にも広がり、水柱も発生。
    phasedPat('ro-roar', `${n}が吠えた！音の波と水柱が押し寄せる！`, [
      ph(0, sp('shockwave', 1, 0.15, 14)),
      ph(1000, sp('shockwave', 2, 0.16, 14)),
      ph(2000, sp('rainColumns', 7, 0.24, 9)), // 水柱
    ]),
  ],
  'boss-region-saijo': (n) => [
    // ① 雷鎖: 落雷地点に印→落雷。
    phasedPat('rs-thunder', `${n}は雷鎖を落とした！印の場所に落雷！`, [
      ph(0, sp('random', 6, 0.04, 8)), // 光る印（ほぼ静止）
      ph(1200, sp('rain', 8, 0.34, 7)), // 落雷
    ]),
    // ② 山神の腕: 岩の巨腕がパンチ・掴み。
    pat('rs-arm', `${n}は岩の巨腕で殴りつけた！`, 'aimed', 3, 0.2, 16),
    // ③ 天狗旋風: 竜巻がエリアを移動。
    pat('rs-tornado', `${n}は天狗旋風を巻き起こした！`, 'spiral', 16, 0.2, 9),
  ],
  'boss-region-niihama': (n) => [
    // ① 銅鉱レーザー: 反射するレーザー（左右から）。
    pat('rn-laser', `${n}は銅鉱レーザーを反射させた！`, 'sides', 11, 0.24, 9),
    // ② トロッコ爆走: トロッコが走り、壊れて鉱石が飛散。
    phasedPat('rn-cart', `${n}はトロッコを爆走させた！`, [
      ph(0, sp('sweepR', 4, 0.28, 13)),
      ph(1100, sp('burst', 14, 0.22, 7)),
    ]),
    // ③ 銅龍覚醒: 溶けた銅が雨のように降る。
    pat('rn-awaken', `${n}が覚醒した！溶けた銅が降り注ぐ！`, 'rain', 14, 0.2, 9, { shape: 'square' }),
  ],
  'boss-region-uwajima': (n) => [
    // ① 闘牛突進: 一直線に突進し、壁で方向転換。
    phasedPat('rw-charge', `${n}は角を下げて突進した！`, [
      ph(0, sp('sweepL', 3, 0.3, 14)),
      ph(1100, sp('sweepR', 3, 0.3, 14)),
      ph(2200, sp('sweepL', 3, 0.32, 14)),
    ]),
    // ② 大地踏み: 衝撃波が左右へ。3回目は二重。
    phasedPat('rw-stomp', `${n}は大地を踏み鳴らした！`, [
      ph(0, sp('shockwave', 1, 0.15, 14)),
      ph(1000, sp('shockwave', 1, 0.16, 14)),
      ph(2000, sp('shockwave', 2, 0.17, 14)), // 二重
    ]),
    // ③ 王者の雄叫び: 闘気が回転→最後に本人が高速突進。
    phasedPat('rw-roar', `${n}の雄叫び！闘気が渦巻き、本人が突進する！`, [
      ph(0, sp('spiral', 16, 0.2, 8)),
      ph(1500, sp('spiral', 18, 0.22, 8)),
      ph(2600, sp('aimed', 2, 0.34, 14)), // 高速突進
    ]),
  ],
};

/** ボスの攻撃パターン（通常＋激化）を返す。未登録なら汎用フォールバック。 */
function getPatterns(bossId: string, name: string): PatternSet {
  const isBoss = bossId.startsWith('boss-');
  const f = BOSS_PATTERNS[bossId];
  const normal: EnemyActionPattern[] = f
    ? f(name)
    : [
        pat('fb-rain', `${name}は弾を降らせた！`, 'rain', 7, 0.18, 10),
        pat('fb-l', `${name}は横から弾を放った！`, 'sweepL', 6, 0.19, 10),
        pat('fb-home', `${name}の弾が追ってくる！`, 'homing', 4, 0.15, 10, { homing: 1.8, shape: 'diamond' }),
      ];
  return { normal, enraged: normal.map((p) => harden(p, isBoss)) };
}

/**
 * Boss からバトル用 EnemyDefinition を導出する。
 * stats 未設定時は既定ステータスへフォールバックする（Req 2.3）。
 */
export function enemyDefinitionFromBoss(boss: Boss): EnemyDefinition {
  const name = boss.name ?? boss.id;
  const stats: CharacterStats = boss.stats ?? DEFAULT_ENEMY_STATS;
  const isMid = boss.kind === 'midBoss';
  const patterns = getPatterns(boss.id, name);

  return {
    id: boss.id,
    name,
    reading: readingForName(name),
    stats,
    normalPatterns: patterns.normal,
    enragedPatterns: patterns.enraged,
    actOptions: [
      { id: 'check', label: 'しらべる', message: `${name} を観察した。弱点を探っている…`, effect: { kind: 'none' } },
      { id: 'talk', label: 'はなしかける', message: `${name} に話しかけた。反応をうかがっている。`, effect: { kind: 'none' } },
    ],
    // 中ボスは逃げやすく、市町ボスは逃げにくい。
    fleeChance: isMid ? 0.6 : 0.35,
    messages: {
      start: `${name} があらわれた！`,
      playerLowHp: 'あなたは追いつめられている…！',
      win: `${name} を倒した！`,
      lose: 'あなたは倒れてしまった…',
    },
  };
}

/** バトル開始時に持ち込むデモ用アイテム（固定回復）。 */
export function createBattleItems(): BattleItem[] {
  return [{ id: 'item-mikan-heal', name: 'みかん', healAmount: 40, usesRemaining: 3 }];
}
