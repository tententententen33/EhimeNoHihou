// Battle_System 公開 API の再エクスポート。

export * from './types';
export { DIFFICULTY, getDifficulty } from './difficulty';
export { computeDamage, type DamageInput } from './damage';
export { selectEnemyAction, generateBullets } from './enemyAI';
export { moveSoul, advanceBullets, detectHit } from './dodge';
export {
  resolveAttack,
  resolveDefend,
  resolveItem,
  resolveAct,
  resolveFlee,
  defendMitigation,
} from './command';
export {
  startBattle,
  availableCommands,
  selectCommand,
  resolveEnemyAction,
  tickDodge,
} from './battle';
