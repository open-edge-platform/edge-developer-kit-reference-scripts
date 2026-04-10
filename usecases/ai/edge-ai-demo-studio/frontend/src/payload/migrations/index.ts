import * as migration_20260407_015900 from './20260407_015900'

export const migrations = [
  {
    up: migration_20260407_015900.up,
    down: migration_20260407_015900.down,
    name: '20260407_015900',
  },
]
