# ボス バトル用画像の配置

バトル画面は **背景・敵キャラ・プレイヤー** の3レイヤーを重ねて描画します（敵は1枚絵・パーツ分割なし、Transform で待機/被弾/攻撃を演出）。

- **敵キャラ画像** … このフォルダ `public/battle/bosses/<bossId>-chara.png`（透過PNG・文字なし推奨。`object-fit: contain` で中央表示）
- **背景画像** … `public/battle/backgrounds/<bossId>-bagground.png`（`object-fit: cover`。無ければ緑グリッドにフォールバック）
- **プレイヤー（ソウル）** … `public/battle/soul.png`（無ければ赤ハートにフォールバック）

各ファイルが無いボスは自動的にフォールバック表示になります。
（注意: 画像内に焼き込まれた文字・HPバー・テキスト欄はアプリ側で別途描画するため、敵キャラ画像には含めず、背景と分けた素材を推奨します。）

例:
- 敵キャラ: `public/battle/bosses/midboss-spot-dogo-honkan-chara.png`
- 背景:     `public/battle/backgrounds/midboss-spot-dogo-honkan-bagground.png`

## ファイル名の対応表（ボス）

### 市町ボス（Region ボス）
| ファイル名 | ボス名 | 参考イラスト |
| --- | --- | --- |
| `boss-region-matsuyama.png` | 湯守の赤シャツ（松山市） | RED SHIRT HOT SPRING GUARDIAN / YUMORI NO AKA-SHATSU |
| `boss-region-iyo.png` | 黄昏の伊予灘主（伊予市） | TWILIGHT IYONADA MASTER / TASOGARE NO IYONADA |
| `boss-region-kumakogen.png` | カルストの霧鬼（久万高原町） | KARST NO KIRIOKI / カルストの霧鬼 |
| `boss-region-uchiko.png` | 木蝋座の影法師（内子町） | MOKUROZA NO KAGEBOSHI / 木蝋座の影法師 |
| `boss-region-imabari.png` | 来島の水軍大将（今治市） | 来島の水軍大将 / KURSHIMA MASTER |
| `boss-region-ozu.png` | 肱川の臥龍（大洲市） | 肱川の臥龍 |
| `boss-region-saijo.png` | 石鎚の山神（西条市） | （未提供） |
| `boss-region-niihama.png` | 別子の銅龍（新居浜市） | （未提供） |
| `boss-region-uwajima.png` | 宇和島の闘牛王（宇和島市） | （未提供） |

### 中ボス（スポット）
| ファイル名 | ボス名 | 参考イラスト |
| --- | --- | --- |
| `midboss-spot-dogo-honkan.png` | 道後温泉本館の主 | DOGO ONSEN MASTER |
| `midboss-spot-dogo-asuka.png` | 道後温泉別館 飛鳥乃湯泉の主 | DOGO ONSEN ANNEX: ASUKA-NO-YU MASTER |
| `midboss-spot-matsuyama-castle.png` | 松山城の主 | MATSUYAMA CASTLE MASTER |
| `midboss-spot-botchan-train.png` | 坊っちゃん列車の主 | BOTCHAN TRAIN MASTER |
| `midboss-spot-ishiteji.png` | 石手寺の主 | ISHITEJI TEMPLE MASTER |
| `midboss-spot-kururin.png` | 大観覧車くるりんの主 | KURURIN FERRIS WHEEL MASTER |
| `midboss-spot-okudogo.png` | 奥道後温泉の主 | OKUDOGO ONSEN MASTER |
| `midboss-spot-shimonada.png` | 下灘駅の主 | SHIMONADA STATION MASTER |
| `midboss-spot-shikoku-karst.png` | 四国カルストの主 | SHIKOKU KARST MASTER |
| `midboss-spot-yokaichi.png` | 八日市護国の町並みの主 | YOKAICHI-GOKOKU TOWNMASTER |
| `midboss-spot-uchikoza.png` | 内子座の主 | UCHIKOZA THEATRE MASTER |
| `midboss-spot-kurushima-bridge.png` | 来島海峡大橋の主 | BRIDGE MASTER |
| `midboss-spot-oyamazumi.png` | 大山祇神社の主 | SHRINE MASTER |
| `midboss-spot-imabari-castle.png` | 今治城の主 | CASTLE MASTER |
| `midboss-spot-kirosan.png` | 亀老山展望公園の主 | OBSERVATORY MASTER |
| `midboss-spot-towel-museum.png` | タオル美術館の主 | タオル美術館の主 / TAKSGWI MASTER |
| `midboss-spot-nibukawa.png` | 鈍川温泉の主 | 鈍川温泉の主 / NIBUKAWA MASTER |
| `midboss-spot-aoshima.png` | 青島（猫島）の主 | （未提供） |
| `midboss-spot-ozu-castle.png` | 大洲城の主 | （未提供） |
| `midboss-spot-ishizuchi.png` | 石鎚山の主 | （未提供） |
| `midboss-spot-besshiyama.png` | 別子山・マイントピア別子の主 | （未提供） |
| `midboss-spot-uwajima-castle.png` | 宇和島城の主 | （未提供） |
