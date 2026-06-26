import * as migration_20260622_065620 from './20260622_065620'

export const migrations = [
  {
    up: migration_20260622_065620.up,
    down: migration_20260622_065620.down,
    name: '20260622_065620',
  },
]
