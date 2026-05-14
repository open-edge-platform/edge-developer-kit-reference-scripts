import * as migration_20260429_025020 from './20260429_025020'

export const migrations = [
  {
    up: migration_20260429_025020.up,
    down: migration_20260429_025020.down,
    name: '20260429_025020',
  },
]
