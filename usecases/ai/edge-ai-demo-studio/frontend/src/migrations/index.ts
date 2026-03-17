import * as migration_20260115_073731 from './20260115_073731'

export const migrations = [
  {
    up: migration_20260115_073731.up,
    down: migration_20260115_073731.down,
    name: '20260115_073731',
  },
]
