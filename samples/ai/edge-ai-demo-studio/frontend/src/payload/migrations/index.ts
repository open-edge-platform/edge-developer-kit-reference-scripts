import * as migration_20260526_010009 from './20260526_010009'

export const migrations = [
  {
    up: migration_20260526_010009.up,
    down: migration_20260526_010009.down,
    name: '20260526_010009',
  },
]
