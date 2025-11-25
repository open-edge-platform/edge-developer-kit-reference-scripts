import * as migration_20251124_025521 from './20251124_025521'

export const migrations = [
  {
    up: migration_20251124_025521.up,
    down: migration_20251124_025521.down,
    name: '20251124_025521',
  },
]
