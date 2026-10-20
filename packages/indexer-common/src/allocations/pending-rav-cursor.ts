import { Op, WhereOptions } from 'sequelize'

// Value DESC, then all primary-key fields ASC. Store raw database values rather
// than address getters (which add 0x/checksum casing). The first field is numeric.
export type PendingRavCursor = [string, string][]

export const afterPendingRavCursor = (cursor: PendingRavCursor): WhereOptions => ({
  [Op.or]: cursor.map(([field, value], index) => ({
    ...Object.fromEntries(cursor.slice(0, index)),
    [field]: { [index === 0 ? Op.lt : Op.gt]: value },
  })),
})
